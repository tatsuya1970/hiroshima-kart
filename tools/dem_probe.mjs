// DEMを10mグリッドにラスタライズし、標高の分布をASCIIで確認する
import { createReadStream } from 'node:fs';
import { writeFileSync } from 'node:fs';

const file = 'data/citygml/513243_dem_55.gml';
const latMin = 34.386, latMax = 34.410, lonMin = 132.444, lonMax = 132.490;
const cell = 10; // m
const mPerLat = 110950, mPerLon = 111320 * Math.cos(34.397 * Math.PI / 180);
const W = Math.ceil((lonMax - lonMin) * mPerLon / cell), H = Math.ceil((latMax - latMin) * mPerLat / cell);
const sum = new Float64Array(W * H), cnt = new Uint32Array(W * H);

let rest = '';
const re = /<gml:posList>([^<]*)<\/gml:posList>/g;
await new Promise((res, rej) => {
  const s = createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 22 });
  s.on('data', chunk => {
    let buf = rest + chunk;
    const last = buf.lastIndexOf('</gml:posList>');
    if (last < 0) { rest = buf; return; }
    rest = buf.slice(last + 14); buf = buf.slice(0, last + 14);
    let m;
    while ((m = re.exec(buf))) {
      const v = m[1].trim().split(/\s+/).map(Number);
      // 三角形の重心に代表値を置く
      let la = 0, lo = 0, z = 0; const n = v.length / 3 - 1;
      for (let i = 0; i < n; i++) { la += v[i * 3]; lo += v[i * 3 + 1]; z += v[i * 3 + 2]; }
      la /= n; lo /= n; z /= n;
      if (la < latMin || la > latMax || lo < lonMin || lo > lonMax) continue;
      const x = Math.floor((lo - lonMin) * mPerLon / cell), y = Math.floor((latMax - la) * mPerLat / cell);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      sum[y * W + x] += z; cnt[y * W + x]++;
    }
  });
  s.on('end', res); s.on('error', rej);
});
const lines = [];
for (let y = 0; y < H; y += 2) {
  let line = '';
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    if (!cnt[i]) { line += ' '; continue; }
    const z = sum[i] / cnt[i];
    line += z < 0.5 ? '~' : z < 1.5 ? '-' : z < 3 ? '.' : z < 6 ? ':' : z < 12 ? '+' : '#';
  }
  lines.push(line);
}
writeFileSync('data/dem_probe.txt', lines.join('\n'));
console.log('W', W, 'H', H);
