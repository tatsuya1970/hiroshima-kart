// 地図スクリーンショットに描かれた線を読み取り、緯度経度の折れ線にする。
//   1. 画像から「赤 (既存コース)」と「青 (指示された経路)」の画素を拾う
//   2. 赤の画素が既知のコース (course_path.json) に重なるよう、画像→世界座標の
//      変換 (等倍・平行移動) を探索で求める
//   3. 青の画素をその変換で世界座標へ移し、順につないで折れ線にする
//   4. data/drawn_route.json に緯度経度で書き出す
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const imgPath = process.argv[2];
if (!imgPath) throw new Error('使い方: node tools/trace_drawn_route.mjs <画像パス>');

const cp = JSON.parse(readFileSync('data/course_path.json', 'utf8'));
const lat0 = cp.origin.lat, lon0 = cp.origin.lon;
const mPerLat = 110950, mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);

// ---------------- 画素の抽出 ----------------
const b64 = readFileSync(imgPath).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div></div>');
const px = await page.evaluate(async (b64) => {
  const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
  const cv = document.createElement('canvas');
  cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const red = [], blue = [];
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // 既存コースの赤 (#e63946 を 0.9 の不透明度で重ねた色)
      if (r > 195 && g > 30 && g < 120 && b > 40 && b < 135 && r - g > 105 && Math.abs(g - b) < 45) red.push([x, y]);
      // 指示された線の青 (実測 rgb(40,88,152) 前後)
      else if (b > 118 && b < 215 && r < 105 && b - r > 60 && b - g > 40) blue.push([x, y]);
    }
  }
  return { w: cv.width, h: cv.height, red, blue };
}, b64);
await browser.close();
console.log(`画像 ${px.w}x${px.h} / 赤 ${px.red.length} 画素 / 青 ${px.blue.length} 画素`);

// ---------------- 変換の推定 ----------------
const known = cp.points;
const bnds = a => [Math.min(...a), Math.max(...a)];
const [kMinX, kMaxX] = bnds(known.map(p => p[0]));
const [kMinZ, kMaxZ] = bnds(known.map(p => p[1]));
const [rMinX, rMaxX] = bnds(px.red.map(p => p[0]));
const [rMinY, rMaxY] = bnds(px.red.map(p => p[1]));
let scale = ((kMaxX - kMinX) / (rMaxX - rMinX) + (kMaxZ - kMinZ) / (rMaxY - rMinY)) / 2;
let tx = kMinX - rMinX * scale, tz = kMinZ - rMinY * scale;

const GRID = 20;
const grid = new Map();
known.forEach(([x, z], i) => {
  const k = `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
  let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
});
const nearestKnown = (x, z) => {
  let best = Infinity;
  const ci = Math.floor(x / GRID), cj = Math.floor(z / GRID);
  for (let r = 0; r <= 5; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = grid.get(`${ci + di},${cj + dj}`);
      if (!a) continue;
      for (const i of a) best = Math.min(best, Math.hypot(known[i][0] - x, known[i][1] - z));
    }
    if (best < (r - 1) * GRID) break;
  }
  return best;
};
const sample = px.red.filter((_, i) => i % 5 === 0);
const cost = (s, ox, oz) => {
  let sum = 0;
  for (const [ix, iy] of sample) sum += Math.min(nearestKnown(ix * s + ox, iy * s + oz), 80);
  return sum / sample.length;
};
let bestCost = cost(scale, tx, tz);
for (let iter = 0; iter < 120; iter++) {
  const stepS = scale * 0.006 * Math.pow(0.95, iter);
  const stepT = 20 * Math.pow(0.95, iter);
  let improved = false;
  for (const [ds, dx, dz] of [[stepS, 0, 0], [-stepS, 0, 0], [0, stepT, 0], [0, -stepT, 0], [0, 0, stepT], [0, 0, -stepT],
    [stepS, stepT, 0], [stepS, -stepT, 0], [-stepS, stepT, 0], [-stepS, -stepT, 0]]) {
    const c = cost(scale + ds, tx + dx, tz + dz);
    if (c < bestCost - 1e-4) { bestCost = c; scale += ds; tx += dx; tz += dz; improved = true; }
  }
  if (!improved && iter > 40) break;
}
console.log(`変換: 1画素 = ${scale.toFixed(3)}m / 赤画素の平均ずれ ${bestCost.toFixed(1)}m`);

const toWorld = ([ix, iy]) => [ix * scale + tx, iy * scale + tz];

// ---------------- 青線を折れ線に ----------------
const BINPX = 3;
const bins = new Map();
for (const p of px.blue) {
  const k = `${Math.floor(p[0] / BINPX)},${Math.floor(p[1] / BINPX)}`;
  let a = bins.get(k); if (!a) { a = [0, 0, 0]; bins.set(k, a); }
  a[0] += p[0]; a[1] += p[1]; a[2]++;
}
const nodes = [...bins.values()].filter(a => a[2] >= 2).map(a => toWorld([a[0] / a[2], a[1] / a[2]]));
console.log(`青の代表点 ${nodes.length} (画素 ${BINPX}px でまとめ)`);

// 閉ループなので、重心まわりの角度で並べる (太い線でも順序が壊れない)
let cx = 0, cz = 0;
for (const [x, z] of nodes) { cx += x; cz += z; }
cx /= nodes.length; cz /= nodes.length;
const BINS = 720;
const buckets = Array.from({ length: BINS }, () => []);
for (const [x, z] of nodes) {
  let a = Math.atan2(z - cz, x - cx);
  if (a < 0) a += Math.PI * 2;
  buckets[Math.min(BINS - 1, Math.floor((a / (Math.PI * 2)) * BINS))].push([x, z]);
}
let poly = [];
for (const b of buckets) {
  if (!b.length) continue;
  // 半径の中央値の点を代表にする (はみ出した画素を落とす)
  b.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
  poly.push(b[Math.floor(b.length / 2)]);
}
console.log(`角度で並べた点 ${poly.length} / 空の角度 ${BINS - poly.length}`);

// 平滑化 → 等間隔 (30m)
const smooth = (p, r, passes) => {
  let cur = p;
  for (let t = 0; t < passes; t++) {
    cur = cur.map((_, i) => {
      let sx = 0, sz = 0, c = 0;
      for (let d = -r; d <= r; d++) { const q = cur[Math.min(cur.length - 1, Math.max(0, i + d))]; sx += q[0]; sz += q[1]; c++; }
      return [sx / c, sz / c];
    });
  }
  return cur;
};
poly = smooth(poly, 4, 3);
poly.push(poly[0]); // 閉じる
const out = [];
let acc = 0;
for (let i = 0; i + 1 < poly.length; i++) {
  const a = poly[i], b = poly[i + 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) continue;
  let t = acc;
  while (t < len) { out.push([a[0] + (b[0] - a[0]) * (t / len), a[1] + (b[1] - a[1]) * (t / len)]); t += 30; }
  acc = t - len;
}
const toLL = ([x, z]) => [+(lat0 - z / mPerLat).toFixed(6), +(lon0 + x / mPerLon).toFixed(6)];
let total = 0;
for (let i = 0; i + 1 < out.length; i++) total += Math.hypot(out[i + 1][0] - out[i][0], out[i + 1][1] - out[i][1]);
console.log(`描かれた線: ${out.length} 点 / 全長 約 ${Math.round(total)}m / 端点間 ${Math.round(Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]))}m`);

writeFileSync('data/drawn_route.json', JSON.stringify({
  source: imgPath, scale: +scale.toFixed(4), fitError: +bestCost.toFixed(2),
  points: out.map(toLL).map(([la, lo]) => ({ lat: la, lon: lo })),
}, null, 1));
console.log('data/drawn_route.json を書き出しました');
