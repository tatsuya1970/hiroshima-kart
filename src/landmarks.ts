// 実在ランドマークの立体モデル
//   原爆ドーム (旧広島県産業奨励館) — 実際の位置・向き・寸法にもとづく
import * as THREE from 'three';
import railData from '../data/rail.json';
import { llToXZ } from './geo';
import type { Terrain } from './terrain';
import { makeDomeBrickTexture, makeRuinStoneTexture, makeCastleWallTexture, makeCastleRoofTexture, makeStoneWallTexture, makeStadiumFacadeTexture, makeStadiumSeatTexture } from './textures';

/**
 * ランドマークの専用モデルと重なる PLATEAU 建物を除く。
 *
 * tools/convert_citygml.mjs も同じ除外を行うが、あちらはデータ生成時にしか効かない。
 * エディオンピースウィングは public/data/ の生成後に追加したため、実行時にも判定する。
 */
export function landmarkBlocksBuilding(ring: number[]): boolean {
  for (const info of Object.values((railData as any).landmarks) as any[]) {
    if (!info.excludeRadius) continue;
    const [lx, lz] = llToXZ(info.lat, info.lon);
    const r2 = info.excludeRadius * info.excludeRadius;
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const dx = ring[k] - lx, dz = ring[k + 1] - lz;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
}

/**
 * 敷地の基準高さ。中心が水面判定になる場所があるので、半径 r の外周から
 * 陸地の点だけを拾って中央値を取る。
 */
function siteLevel(terrain: Terrain, x: number, z: number, r: number): number {
  const hs: number[] = [];
  for (let a = 0; a < 360; a += 15) {
    const px = x + Math.cos((a * Math.PI) / 180) * r, pz = z + Math.sin((a * Math.PI) / 180) * r;
    if (!terrain.isWater(px, pz)) hs.push(terrain.groundHeight(px, pz));
  }
  if (!hs.length) return terrain.groundHeight(x, z);
  hs.sort((p, q) => p - q);
  return hs[Math.floor(hs.length / 2)];
}

/** 角の丸い長方形 (超楕円)。p が小さいほど角ばる。 */
function superellipse(rx: number, rz: number, steps: number, p = 0.55): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([rx * Math.sign(c) * Math.abs(c) ** p, rz * Math.sign(s) * Math.abs(s) ** p]);
  }
  return pts;
}

/**
 * 2 本の閉パスの間を帯で張る。スタジアムは外からも内からも見えるので
 * DoubleSide で作り、面の向きに依存しないようにする。
 */
function ribbon(
  a: [number, number][], ay: number, b: [number, number][], by: number,
  mat: THREE.Material, uRepeat: number, vRepeat: number,
): THREE.Mesh {
  const n = a.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    pos.push(a[k][0], ay, a[k][1]);
    pos.push(b[k][0], by, b[k][1]);
    const u = (i / n) * uRepeat;
    uv.push(u, 0, u, vRepeat);
    if (i < n) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/**
 * エディオンピースウィング広島 (2024年2月開業のサッカー専用スタジアム)。
 *
 * PLATEAU 広島市 2024年度の建築物モデルには含まれていない。該当メッシュの
 * CityGML を確認したところ、この位置の半径 250m 以内で最大の建物は 54m x 64m で、
 * スタジアム (約 200m x 160m) は存在しなかった。測量時点が開業前と思われる。
 * そのため原爆ドーム・広島城と同じく独自にモデリングしている。寸法は概略値。
 */
export function buildPeaceWing(terrain: Terrain): THREE.Group {
  const info = (railData as any).landmarks.peaceWing;
  const [x, z] = llToXZ(info.lat, info.lon);
  // 中央公園のこの一帯は平坦で標高が低く、terrain が河川と誤判定する
  // (DEM の低標高部を水面として扱っているため)。そのまま置くと足元が水面に
  // なるので、高さは周囲の陸地から取り、下に敷地の板を敷いて隠す。
  const base = siteLevel(terrain, x, z, 130);
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.rotation.y = -(info.headingDeg * Math.PI) / 180;

  // 敷地 (スタジアムより一回り大きい平場)
  const siteShape = new THREE.Shape();
  superellipse(150, 124, 64, 0.75).forEach(([px, pz], i) => i ? siteShape.lineTo(px, pz) : siteShape.moveTo(px, pz));
  siteShape.closePath();
  // 中央公園なので芝寄りの色にして、誤判定された水面をまたいでも浮かないようにする
  const site = new THREE.Mesh(new THREE.ShapeGeometry(siteShape), new THREE.MeshLambertMaterial({ color: 0x7f8a63 }));
  site.rotation.x = -Math.PI / 2; // +π/2 だと法線が下を向いて上から見えなくなる
  site.position.y = 0.15;
  site.receiveShadow = true;
  g.add(site);

  const N = 96;
  const facadeMat = new THREE.MeshLambertMaterial({ map: makeStadiumFacadeTexture(), side: THREE.DoubleSide });
  const seatMat = new THREE.MeshLambertMaterial({ map: makeStadiumSeatTexture(), side: THREE.DoubleSide });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xd6d9dc, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x54585c, side: THREE.DoubleSide });

  // 外周 (ルーバーの壁) / スタンド上端 / ピッチ際
  const outer = superellipse(98, 78, N);
  const roofIn = superellipse(74, 56, N);
  const standTop = superellipse(64, 46, N);
  const pitchEdge = superellipse(57, 39, N);

  const H_FACADE = 30, H_STAND = 23, H_PITCH = 1.2, H_ROOF = 31.5;

  // 外周のルーバー壁
  g.add(ribbon(outer, 0, outer, H_FACADE, facadeMat, 26, 4));
  // 屋根 (外周から内側へ張り出す) と、その先端の見切り
  g.add(ribbon(outer, H_ROOF, roofIn, H_ROOF, roofMat, 1, 1));
  g.add(ribbon(outer, H_FACADE, outer, H_ROOF, trimMat, 1, 1));
  g.add(ribbon(roofIn, H_ROOF, roofIn, H_ROOF - 1.6, trimMat, 1, 1));
  // スタンド (ピッチ際から上端まで登る客席)
  g.add(ribbon(pitchEdge, H_PITCH, standTop, H_STAND, seatMat, 40, 8));
  // スタンド上端から外周壁の内側へ渡るコンコースの天井
  g.add(ribbon(standTop, H_STAND, outer, H_STAND + 2.5, trimMat, 1, 1));

  // ピッチ
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(105, 68),
    new THREE.MeshLambertMaterial({ color: 0x3f8f43 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = H_PITCH;
  pitch.receiveShadow = true;
  g.add(pitch);
  // 芝のストライプ
  for (let i = 0; i < 8; i++) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(105 / 8, 68),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0x469a4b : 0x38833c }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-52.5 + (i + 0.5) * (105 / 8), H_PITCH + 0.02, 0);
    g.add(stripe);
  }

  // 照明塔 (屋根の四隅)
  const lampMat = new THREE.MeshPhongMaterial({ color: 0xf2f4f6, emissive: 0x2a2a22, shininess: 60 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 3), lampMat);
    lamp.position.set(sx * 44, H_ROOF - 1.2, sz * 34);
    lamp.rotation.y = sx * sz > 0 ? 0.5 : -0.5;
    lamp.castShadow = true;
    g.add(lamp);
  }

  return g;
}

/**
 * 原爆ドーム。
 * 旧広島県産業奨励館 (1915年竣工, ヤン・レツル設計) の被爆後の姿。
 * 中央に円筒の階段室があり、その上に楕円ドームの鉄骨が残る。全高およそ25m。
 * 建物の長辺は元安川に沿ってほぼ北北東-南南西を向く。
 */
export function buildGenbakuDome(terrain: Terrain): THREE.Group {
  const info = (railData as any).landmarks.genbakuDome;
  const [x, z] = llToXZ(info.lat, info.lon);
  const base = terrain.groundHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, base - 0.3, z);
  g.rotation.y = -(info.headingDeg * Math.PI) / 180;

  const brick = makeDomeBrickTexture();
  const stone = makeRuinStoneTexture();
  const brickMat = new THREE.MeshLambertMaterial({ map: brick });
  const stoneMat = new THREE.MeshLambertMaterial({ map: stone });
  const steelMat = new THREE.MeshPhongMaterial({ color: 0x5d5148, shininess: 25 });

  // ---- 基壇 ----
  const podium = new THREE.Mesh(new THREE.BoxGeometry(38, 1.0, 21), stoneMat);
  podium.position.y = 0.5;
  podium.receiveShadow = true;
  g.add(podium);

  // ---- 主屋 (3階建て・煉瓦) 崩落を高さの差で表す ----
  // 中央棟 (階段室の周り) は最も高く残り、両翼は崩れて低い
  const wings: [number, number, number, number][] = [
    // [中心z, 長さ, 高さ, 幅]
    [-13.5, 9.0, 6.4, 17.5],
    [-6.5, 5.5, 9.6, 18.5],
    [0, 9.0, 13.2, 19.5],
    [6.5, 5.5, 9.2, 18.5],
    [13.0, 8.5, 5.8, 17.0],
  ];
  for (const [cz, len, h, w] of wings) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), brickMat);
    m.position.set(0, 1.0 + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    // 床スラブの断面 (崩落面) を薄い板で表現
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, len + 0.3), stoneMat);
    slab.position.set(0, 1.0 + h, cz);
    slab.castShadow = true;
    g.add(slab);
  }
  // 窓の抜け (縦に並ぶ開口を暗い板で表す)
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x1b1713 });
  for (const [cz, len, h, w] of wings) {
    const rows = Math.max(1, Math.floor((h - 2.4) / 3.6));
    const cols = Math.max(1, Math.floor(len / 3.2));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const zz = cz - len / 2 + (len / cols) * (c + 0.5);
        const yy = 1.0 + 2.2 + r * 3.6;
        for (const side of [1, -1]) {
          const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), holeMat);
          hole.position.set(side * (w / 2 + 0.02), yy, zz);
          hole.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          g.add(hole);
        }
      }
    }
    // 妻側の窓
    for (const zs of [cz - len / 2 - 0.02, cz + len / 2 + 0.02]) void zs;
  }

  // ---- 中央の円筒 (階段室) ----
  const drumR = 5.4, drumTop = 18.6;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(drumR, drumR, drumTop - 12.6, 24, 1, true), brickMat);
  drum.position.y = 1.0 + (12.6 + drumTop - 12.6 / 2) / 2 + 2.2;
  drum.position.y = 1.0 + 12.6 + (drumTop - 12.6) / 2;
  drum.castShadow = true;
  g.add(drum);
  // 円筒上端のコーニス
  const cornice = new THREE.Mesh(new THREE.CylinderGeometry(drumR + 0.45, drumR + 0.45, 0.6, 24), stoneMat);
  cornice.position.y = 1.0 + drumTop;
  cornice.castShadow = true;
  g.add(cornice);
  // 円筒の窓 (縦長のアーチ窓が並ぶ)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.0), holeMat);
    hole.position.set(Math.sin(a) * (drumR + 0.02), 1.0 + 14.6, Math.cos(a) * (drumR + 0.02));
    hole.rotation.y = a;
    g.add(hole);
  }

  // ---- ドームの鉄骨 ----
  const domeBase = 1.0 + drumTop + 0.3;
  const domeH = 6.2, domeR = drumR - 0.15;
  // 経線リブ (16 本) — 楕円弧を細い管で描く
  const ribCount = 16;
  for (let i = 0; i < ribCount; i++) {
    const a = (i / ribCount) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    const seg = 12;
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * (Math.PI / 2);
      const r = Math.cos(t) * domeR;
      const y = Math.sin(t) * domeH;
      pts.push(new THREE.Vector3(Math.sin(a) * r, domeBase + y, Math.cos(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.11, 6, false), steelMat);
    tube.castShadow = true;
    g.add(tube);
  }
  // 緯線リング (4 本)
  for (const t of [0.06, 0.3, 0.56, 0.8]) {
    const ang = t * (Math.PI / 2);
    const r = Math.cos(ang) * domeR, y = Math.sin(ang) * domeH;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.085, 6, 28), steelMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = domeBase + y;
    ring.castShadow = true;
    g.add(ring);
  }
  // 頂部の小さな環
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.09, 6, 14), steelMat);
  top.rotation.x = Math.PI / 2;
  top.position.y = domeBase + domeH;
  g.add(top);

  // ---- 前面 (川側) の崩れた壁と瓦礫 ----
  const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x8a7f72 });
  const rubble: [number, number, number, number, number][] = [
    [11.5, 0.6, -12.0, 2.4, 1.2],
    [-11.8, 0.5, 9.5, 1.9, 1.0],
    [12.2, 0.4, 5.0, 1.5, 0.9],
    [-12.5, 0.5, -4.0, 2.1, 1.1],
  ];
  for (const [rx, ry, rz, s, h] of rubble) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s * 1.3), rubbleMat);
    m.position.set(rx, 1.0 + ry + h / 2, rz);
    m.rotation.y = rx * 0.3;
    m.castShadow = true;
    g.add(m);
  }
  // 立ち残った壁の一部 (象徴的な西面)
  const stub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.5, 5.0), brickMat);
  stub.position.set(-10.0, 1.0 + 4.25, -17.0);
  stub.castShadow = true;
  g.add(stub);

  // ---- 説明板 ----
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.5),
    new THREE.MeshBasicMaterial({ map: makeDomeSignTexture(), transparent: true, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 2.4, 15.5);
  g.add(sign);
  return g;
}

/**
 * 広島城 天守閣。
 * 毛利輝元が築いた広島城の天守（1958年再建、五層五階）。白漆喰の上部と
 * 黒い下見板張りの下部、本瓦葺きの屋根が特徴。石垣の天守台の上に建つ。
 * 天守の高さはおよそ 26.6m、石垣を含めると 39m ほど。
 */
export function buildHiroshimaCastle(terrain: Terrain): THREE.Group {
  const info = (railData as any).landmarks.hiroshimaCastle;
  const [x, z] = llToXZ(info.lat, info.lon);
  const base = terrain.groundHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, base - 0.3, z);
  g.rotation.y = -(info.headingDeg * Math.PI) / 180;

  const stoneMat = new THREE.MeshLambertMaterial({ map: makeStoneWallTexture() });
  const wallTex = makeCastleWallTexture();
  const roofTex = makeCastleRoofTexture();
  const roofMat = new THREE.MeshLambertMaterial({ map: roofTex });
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const goldMat = new THREE.MeshPhongMaterial({ color: 0xc8a03a, shininess: 90, specular: 0xfff0b0 });

  // ---- 天守台 (石垣)。上へすぼまる四角錐台 ----
  const BASE_H = 11.5;
  const b0 = 26, b1 = 21; // 下端 / 上端の一辺
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(b1 / Math.SQRT2, b0 / Math.SQRT2, BASE_H, 4, 1), stoneMat);
  stone.rotation.y = Math.PI / 4;
  stone.position.y = BASE_H / 2;
  stone.castShadow = true; stone.receiveShadow = true;
  g.add(stone);
  // 天守台の上面
  const top = new THREE.Mesh(new THREE.BoxGeometry(b1, 0.5, b1 * 0.9), new THREE.MeshLambertMaterial({ color: 0x8d8778 }));
  top.position.y = BASE_H + 0.25;
  top.receiveShadow = true;
  g.add(top);

  // ---- 天守 (五層) ----
  // [幅, 奥行, 壁高]
  const tiers: [number, number, number][] = [
    [17.0, 15.0, 5.0],
    [15.0, 13.2, 4.2],
    [13.0, 11.4, 3.8],
    [11.0, 9.6, 3.4],
    [9.0, 7.8, 3.2],
  ];
  let y = BASE_H + 0.5;
  const roofOf = (w: number, d: number, yy: number, h: number, over: number) => {
    // 入母屋風: 下が広く上が狭い四角錐台
    const r = new THREE.Mesh(new THREE.CylinderGeometry(
      Math.max(0.4, (w * 0.32) / Math.SQRT2), (w / 2 + over) / Math.SQRT2, h, 4, 1), roofMat);
    r.rotation.y = Math.PI / 4;
    r.scale.z = d / w;
    r.position.y = yy + h / 2;
    r.castShadow = true; r.receiveShadow = true;
    return r;
  };
  tiers.forEach(([w, d, wh], i) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
    wall.position.y = y + wh / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
    // 各層の腰屋根
    const over = i === tiers.length - 1 ? 1.9 : 1.5;
    const rh = i === tiers.length - 1 ? 3.2 : 1.7;
    g.add(roofOf(w, d, y + wh, rh, over));
    // 最上階は高欄 (廻縁)
    if (i === tiers.length - 1) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 2.6, 0.18, d + 2.6), new THREE.MeshLambertMaterial({ color: 0x3a3128 }));
      rail.position.y = y + wh - 0.5;
      g.add(rail);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, d + 2.6), new THREE.MeshLambertMaterial({ color: 0x3a3128 }));
        side.position.set(sx * (w / 2 + 1.3), y + wh - 0.1, 0);
        g.add(side);
      }
      for (const sz of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(w + 2.6, 0.9, 0.16), new THREE.MeshLambertMaterial({ color: 0x3a3128 }));
        side.position.set(0, y + wh - 0.1, sz * (d / 2 + 1.3));
        g.add(side);
      }
    }
    // 千鳥破風 (妻側の小さな切妻)
    if (i === 1 || i === 3) {
      for (const sz of [-1, 1]) {
        const gable = new THREE.Mesh(new THREE.ConeGeometry(w * 0.22, 1.9, 3), roofMat);
        gable.rotation.y = Math.PI / 2;
        gable.rotation.x = sz > 0 ? Math.PI / 2 : -Math.PI / 2;
        gable.position.set(0, y + wh + 0.8, sz * (d / 2 + 0.9));
        gable.castShadow = true;
        g.add(gable);
      }
    }
    y += wh + rh * 0.62;
  });

  // ---- 鯱 (しゃちほこ) ----
  for (const sx of [-1, 1]) {
    const shachi = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.9, 8), goldMat);
    body.rotation.z = sx * 0.35;
    body.position.y = 0.95;
    shachi.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 6), goldMat);
    tail.position.set(sx * -0.45, 1.85, 0);
    tail.rotation.z = sx * 1.4;
    shachi.add(tail);
    shachi.position.set(sx * 3.0, y + 0.4, 0);
    shachi.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    g.add(shachi);
  }

  // ---- 説明板 ----
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 1.75),
    new THREE.MeshBasicMaterial({ map: makeCastleSignTexture(), transparent: true, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 2.6, b0 / 2 + 1.5);
  g.add(sign);
  return g;
}

function makeCastleSignTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(28,24,20,0.92)';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#c8a03a'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 1008, 240);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 100px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('広島城', 512, 96);
  ctx.font = '40px sans-serif';
  ctx.fillStyle = '#c8a03a';
  ctx.fillText('Hiroshima Castle', 512, 180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeDomeSignTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,28,38,0.92)';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#d8c07a'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 1008, 240);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 96px "Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('原爆ドーム', 512, 96);
  ctx.font = '40px sans-serif';
  ctx.fillStyle = '#d8c07a';
  ctx.fillText('Hiroshima Peace Memorial', 512, 180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
