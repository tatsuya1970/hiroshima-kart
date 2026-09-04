// 広島の鉄道・軌道 — 実在位置の線路と、実際に走る車両
//   路面電車: 広島電鉄 本線・横川線 (コース上を走るため接触するとスピン)
//   JR:       山陽本線 (広島 - 新白島 - 横川) 盛土上、河川は桁橋
//   新幹線:   山陽新幹線 (広島駅) 高架上
import * as THREE from 'three';
import railData from '../data/rail.json';
import { llToXZ, lerp } from './geo';
import type { Terrain } from './terrain';
import type { Track } from './track';
import { makeTrainSideTexture, makeBallastTexture, makeConcreteTexture } from './textures';

export interface RailPoint { x: number; z: number; y: number; tx: number; tz: number; s: number; }

type Kind = 'tram' | 'jr' | 'shinkansen';

/** 緯度経度の折れ線を Catmull-Rom で滑らかにして等間隔サンプル */
function samplePath(pts: { lat: number; lon: number }[], step: number, closed = false): THREE.Vector3[] {
  const v = pts.map(p => { const [x, z] = llToXZ(p.lat, p.lon); return new THREE.Vector3(x, 0, z); });
  const curve = new THREE.CatmullRomCurve3(v, closed, 'centripetal', 0.5);
  const len = curve.getLength();
  const n = Math.max(2, Math.floor(len / step));
  return curve.getSpacedPoints(n);
}

/**
 * コース上の 2 点を結ぶ点列の添字を返す。コースは閉ループなので短い側を辿る。
 * 端点は含まない (呼び出し側が停留場の座標を入れるため)。
 */
function courseArc(track: Track, i0: number, i1: number): number[] {
  const n = track.n;
  const fwd = (i1 - i0 + n) % n;
  const back = (i0 - i1 + n) % n;
  const step = fwd <= back ? 1 : -1;
  const len = Math.min(fwd, back);
  const out: number[] = [];
  for (let k = 1; k < len; k++) out.push((i0 + step * k + n) % n);
  return out;
}

export class RailLine {
  kind: Kind;
  pts: RailPoint[] = [];
  length = 0;

  constructor(kind: Kind, raw: THREE.Vector3[], heightAt: (x: number, z: number, i: number, n: number) => number) {
    this.kind = kind;
    const n = raw.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = raw[i];
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      this.pts.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z, i, n), tx, tz, s });
      if (i < n - 1) s += Math.hypot(raw[i + 1].x - p.x, raw[i + 1].z - p.z);
    }
    this.length = s;
    // 高さを平滑化 (地形のノイズを消す)
    const R = this.kind === 'tram' ? 3 : 10;
    const src = this.pts.map(p => p.y);
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let d = -R; d <= R; d++) { const j = i + d; if (j < 0 || j >= n) continue; sum += src[j]; c++; }
      this.pts[i].y = sum / c;
    }
  }

  /** 距離 s の位置と向き */
  at(s: number): RailPoint {
    const n = this.pts.length;
    if (s <= 0) return this.pts[0];
    if (s >= this.length) return this.pts[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.pts[m].s <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return {
      x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: lerp(a.y, b.y, t),
      tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t), s,
    };
  }

  /** 中心線からの距離 (建物除去・接触判定用) */
  nearest(x: number, z: number): { dist: number; lateral: number } {
    let best = Infinity, lat = Infinity;
    for (const p of this.pts) {
      const dx = x - p.x, dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; lat = dx * p.tz - dz * p.tx; }
    }
    return { dist: Math.sqrt(best), lateral: lat };
  }
}

/** 1 両の車体 */
function buildCar(kind: Kind, len: number, width: number, height: number, nose: 'none' | 'front' | 'back', sideTex: THREE.Texture, roofColor: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ map: sideTex, shininess: 55 });
  const roofMat = new THREE.MeshPhongMaterial({ color: roofColor, shininess: 20 });
  const skirtMat = new THREE.MeshPhongMaterial({ color: 0x2b2f34, shininess: 10 });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x1d2b38, shininess: 110, specular: 0x99bbdd });

  const bodyLen = nose === 'none' ? len : len - (kind === 'shinkansen' ? 5.5 : 1.2);
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, bodyLen), bodyMat);
  body.position.y = height / 2;
  body.position.z = nose === 'front' ? -(len - bodyLen) / 2 : nose === 'back' ? (len - bodyLen) / 2 : 0;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.35, bodyLen * 0.99), roofMat);
  roof.position.set(0, height + 0.12, body.position.z);
  g.add(roof);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, 0.55, bodyLen * 0.92), skirtMat);
  skirt.position.set(0, 0.28, body.position.z);
  g.add(skirt);
  if (nose !== 'none') {
    const sgn = nose === 'front' ? -1 : 1;
    const zEdge = body.position.z + sgn * bodyLen / 2;
    if (kind === 'shinkansen') {
      const noseLen = len - bodyLen;
      const geo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.scale(width / 2, noseLen, height / 2);
      geo.rotateX(sgn * Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xf4f6f8, shininess: 90 }));
      m.position.set(0, height / 2, zEdge);
      g.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(width * 1.002, 0.5, noseLen * 0.8), new THREE.MeshPhongMaterial({ color: 0x1b4f9c }));
      band.position.set(0, height * 0.42, zEdge + sgn * noseLen * 0.36);
      g.add(band);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, 0.7, 1.4), glassMat);
      wind.position.set(0, height * 0.78, zEdge + sgn * 1.1);
      g.add(wind);
    } else {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(width, height, len - bodyLen), new THREE.MeshPhongMaterial({ color: 0xf2f4f5, shininess: 60 }));
      cap.position.set(0, height / 2, zEdge + sgn * (len - bodyLen) / 2);
      g.add(cap);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, height * 0.42, 0.12), glassMat);
      wind.position.set(0, height * 0.66, zEdge + sgn * ((len - bodyLen) - 0.03));
      g.add(wind);
      for (const sx of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
        l.position.set(sx * width * 0.32, height * 0.3, zEdge + sgn * ((len - bodyLen) - 0.02));
        g.add(l);
      }
    }
  }
  if (kind !== 'shinkansen') {
    const pmat = new THREE.MeshPhongMaterial({ color: 0x6b7076 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), pmat);
    arm.position.set(0, height + 0.75, body.position.z + bodyLen * 0.25);
    arm.rotation.x = 0.5;
    g.add(arm);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.07, 0.12), pmat);
    bar.position.set(0, height + 1.2, body.position.z + bodyLen * 0.25 + 0.2);
    g.add(bar);
  }
  const wheelMat = new THREE.MeshPhongMaterial({ color: 0x14161a });
  for (const zz of [-bodyLen * 0.32, bodyLen * 0.32]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.18, 12), wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * width * 0.42, 0.42, body.position.z + zz);
      g.add(w);
    }
  }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

interface TrainDef { cars: number; carLen: number; width: number; height: number; speed: number; gap: number; }
const TRAIN: Record<Kind, TrainDef> = {
  tram: { cars: 3, carLen: 9.5, width: 2.5, height: 3.0, speed: 11, gap: 0.35 },
  jr: { cars: 4, carLen: 20, width: 2.95, height: 3.5, speed: 22, gap: 0.7 },
  shinkansen: { cars: 6, carLen: 25, width: 3.35, height: 3.6, speed: 55, gap: 0.6 },
};

class Train {
  group = new THREE.Group();
  s: number;
  dir: number;
  speed: number;
  private carGroups: THREE.Group[] = [];
  private line: RailLine;
  private def: TrainDef;
  private trackOffset: number;
  private dwell = 0;

  constructor(line: RailLine, def: TrainDef, sideTex: THREE.Texture, roofColor: number, s0: number, dir: number, trackOffset: number) {
    this.line = line; this.def = def; this.s = s0; this.dir = dir; this.speed = def.speed;
    this.trackOffset = trackOffset;
    for (let i = 0; i < def.cars; i++) {
      const nose = i === 0 ? (dir > 0 ? 'back' : 'front') : i === def.cars - 1 ? (dir > 0 ? 'front' : 'back') : 'none';
      const car = buildCar(line.kind, def.carLen, def.width, def.height, nose as 'none' | 'front' | 'back', sideTex, roofColor);
      this.carGroups.push(car);
      this.group.add(car);
    }
  }

  get totalLength() { return this.def.cars * (this.def.carLen + this.def.gap); }

  update(dt: number) {
    if (this.dwell > 0) this.dwell -= dt;
    else this.s += this.speed * this.dir * dt;
    const L = this.line.length, tl = this.totalLength;
    if (this.dir > 0 && this.s > L - tl * 0.6) { this.dir = -1; this.dwell = 2.5; }
    else if (this.dir < 0 && this.s < tl * 0.6) { this.dir = 1; this.dwell = 2.5; }
    const step = this.def.carLen + this.def.gap;
    for (let i = 0; i < this.carGroups.length; i++) {
      const cs = this.s - this.dir * (i - (this.carGroups.length - 1) / 2) * step;
      const p = this.line.at(Math.max(0, Math.min(L, cs)));
      const off = this.trackOffset;
      this.carGroups[i].position.set(p.x + p.tz * off, p.y, p.z - p.tx * off);
      this.carGroups[i].rotation.y = Math.atan2(p.tx, p.tz);
    }
  }

  /** 車体のおおよその占有 (接触判定用) */
  *segments(): Generator<{ x: number; z: number; halfLen: number; halfWid: number; ang: number }> {
    for (const c of this.carGroups) {
      yield { x: c.position.x, z: c.position.z, halfLen: this.def.carLen / 2, halfWid: this.def.width / 2, ang: c.rotation.y };
    }
  }
}

export interface RailSystem {
  group: THREE.Group;
  lines: { tram: RailLine; jr: RailLine; shinkansen: RailLine };
  update(dt: number): void;
  /** 路面電車に接触したか (コース上を走るため) */
  hitTram(x: number, z: number, r: number): boolean;
  /** 建物を除去すべき軌道敷か */
  blocksBuilding(ring: number[]): boolean;
}

export function buildRail(terrain: Terrain, track: Track): RailSystem {
  const group = new THREE.Group();
  const d = railData as any;

  // ---- 路面電車 ----
  // 広電は本コースと同じ通りを走る。停留場の座標は概略値なので、コース (PLATEAU の
  // 道路面に載せた走行線) の近くにある停留場は走行線上へ寄せてから線形を作る。
  const tramStops = (d.tram.stops as { name: string; lat: number; lon: number }[]).map(st => {
    const [x, z] = llToXZ(st.lat, st.lon);
    const nr = track.nearest(x, z);
    if (nr.dist < 130) {
      const i = nr.idx;
      return { ...st, x: track.px[i], z: track.pz[i], idx: i, onCourse: true };
    }
    return { ...st, x, z, idx: -1, onCourse: false };
  });
  const tramRaw = (() => {
    // 停留場だけを通る曲線にすると、停留場の間でカーブの内側を突っ切って道路の
    // 中央から外れる。両端がコース上にある区間は、コースの点列 (PLATEAU の道路面に
    // 載せた 2m 間隔の走行線 = 道路の中央) をそのまま制御点として辿る。
    const v: THREE.Vector3[] = [];
    for (let s = 0; s < tramStops.length; s++) {
      const cur = tramStops[s];
      v.push(new THREE.Vector3(cur.x, 0, cur.z));
      const nxt = tramStops[s + 1];
      if (!nxt) break;
      if (!cur.onCourse || !nxt.onCourse) continue;
      const arc = courseArc(track, cur.idx, nxt.idx);
      // コースが遠回りしている区間 (実際の軌道は別の道を通る) では使わない
      const straight = Math.hypot(nxt.x - cur.x, nxt.z - cur.z);
      if (arc.length * 2 > Math.max(60, straight * 2.2)) continue;
      for (const i of arc) v.push(new THREE.Vector3(track.px[i], 0, track.pz[i]));
    }
    const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
    const n = Math.max(2, Math.floor(curve.getLength() / 5));
    return curve.getSpacedPoints(n);
  })();
  const tramLine = new RailLine('tram', tramRaw, (x, z) => {
    const nr = track.nearest(x, z);
    if (nr.dist < 60 && Math.abs(nr.lateral) < track.halfWidth + 6) return track.py[nr.idx] + 0.02;
    return terrain.groundHeight(x, z) + 0.15;
  });
  // ---- JR: 盛土 ----
  const jrRaw = samplePath(d.jr.path, 8);
  const jrLine = new RailLine('jr', jrRaw, (x, z) => Math.max(terrain.groundHeight(x, z), 0.5) + d.jr.embankment);
  // ---- 新幹線: 高架 ----
  const skRaw = samplePath(d.shinkansen.path, 8);
  const skLine = new RailLine('shinkansen', skRaw, (x, z) => Math.max(terrain.groundHeight(x, z), 0.5) + d.shinkansen.viaductHeight);

  const ballastTex = makeBallastTexture();
  const concreteTex = makeConcreteTexture();

  // ---- 軌道 ----
  group.add(buildTramTrack(tramLine, d.tram.trackSpacing));
  // 橋脚がコース上に立たないようにする (実際の高架も道路をまたぐ)
  const clearOfCourse = (x: number, z: number) => {
    const nr = track.nearest(x, z);
    return !(Math.abs(nr.lateral) < track.halfWidth + 3 && nr.dist < track.halfWidth + 8);
  };
  group.add(buildBallastTrack(jrLine, d.jr.trackSpacing, ballastTex, terrain, d.jr.embankment, clearOfCourse));
  group.add(buildViaduct(skLine, d.shinkansen.trackSpacing, concreteTex, terrain, clearOfCourse));

  // ---- 駅・停留場 ----
  for (const st of tramStops) group.add(tramStop(st, tramLine, track));
  group.add(station(d.jr.stations, jrLine, 0x2b6cb0, 5.5, 90));
  group.add(station(d.shinkansen.stations, skLine, 0x1b4f9c, 6.5, 140));

  // ---- 車両 ----
  const tramTex = makeTrainSideTexture('tram');
  const jrTex = makeTrainSideTexture('jr');
  const skTex = makeTrainSideTexture('shinkansen');
  const trams: Train[] = [];
  const trains: Train[] = [];
  const half = d.tram.trackSpacing / 2;
  for (const [f, dir] of [[0.08, 1], [0.3, -1], [0.52, 1], [0.72, -1], [0.9, 1]] as [number, number][]) {
    const t = new Train(tramLine, TRAIN.tram, tramTex, 0x2f6b46, tramLine.length * f, dir, dir > 0 ? -half : half);
    trams.push(t); trains.push(t); group.add(t.group);
  }
  const jrHalf = d.jr.trackSpacing / 2;
  for (const [f, dir] of [[0.12, 1], [0.55, -1], [0.85, 1]] as [number, number][]) {
    const t = new Train(jrLine, TRAIN.jr, jrTex, 0xb9c0c7, jrLine.length * f, dir, dir > 0 ? -jrHalf : jrHalf);
    trains.push(t); group.add(t.group);
  }
  const skHalf = d.shinkansen.trackSpacing / 2;
  for (const [f, dir] of [[0.15, 1], [0.7, -1]] as [number, number][]) {
    const t = new Train(skLine, TRAIN.shinkansen, skTex, 0xdfe4e8, skLine.length * f, dir, dir > 0 ? -skHalf : skHalf);
    trains.push(t); group.add(t.group);
  }

  const lines = { tram: tramLine, jr: jrLine, shinkansen: skLine };
  return {
    group, lines,
    update(dt: number) { for (const t of trains) t.update(dt); },
    hitTram(x: number, z: number, r: number) {
      for (const t of trams) {
        for (const seg of t.segments()) {
          const dx = x - seg.x, dz = z - seg.z;
          if (dx * dx + dz * dz > (seg.halfLen + r) ** 2) continue;
          const c = Math.cos(seg.ang), s = Math.sin(seg.ang);
          const lz = dx * s + dz * c, lx = dx * c - dz * s;
          if (Math.abs(lz) < seg.halfLen + r && Math.abs(lx) < seg.halfWid + r) return true;
        }
      }
      return false;
    },
    blocksBuilding(ring: number[]) {
      let cx = 0, cz = 0;
      const m = ring.length / 2;
      for (let k = 0; k < ring.length; k += 2) { cx += ring[k]; cz += ring[k + 1]; }
      cx /= m; cz /= m;
      for (const [line, margin] of [[jrLine, 9], [skLine, 8]] as [RailLine, number][]) {
        if (line.nearest(cx, cz).dist < margin) return true;
        for (let k = 0; k < ring.length; k += 2) {
          if (line.nearest(ring[k], ring[k + 1]).dist < margin) return true;
        }
      }
      return false;
    },
  };
}

/** 路面電車の軌道: レール 2 対 + 軌道敷 */
function buildTramTrack(line: RailLine, spacing: number): THREE.Group {
  const g = new THREE.Group();
  const half = spacing / 2;
  g.add(strip(line, -half - 1.6, half + 1.6, 0.015, new THREE.MeshLambertMaterial({ color: 0x7c7f84 })));
  const railMat = new THREE.MeshPhongMaterial({ color: 0x8e9399, shininess: 120, specular: 0xffffff });
  for (const center of [-half, half]) {
    for (const o of [-0.7175, 0.7175]) {
      g.add(strip(line, center + o - 0.045, center + o + 0.045, 0.055, railMat));
    }
  }
  return g;
}

/** JR: バラスト盛土 + レール。河川は桁橋で渡る。 */
function buildBallastTrack(line: RailLine, spacing: number, tex: THREE.Texture, terrain: Terrain, emb: number, pierOk: (x: number, z: number) => boolean): THREE.Group {
  const g = new THREE.Group();
  const half = spacing / 2;
  const w = half + 2.6;
  const rawWater = line.pts.map(p => terrain.isWater(p.x, p.z));
  const water = rawWater.map((_, i) => rawWater[i] || rawWater[i - 1] || rawWater[i + 1] || rawWater[i - 2] || rawWater[i + 2]);
  const onLand = (i: number) => !water[i];
  const onWater = (i: number) => water[i];
  g.add(skirt(line, w, terrain, emb, new THREE.MeshLambertMaterial({ color: 0x6f6a5e }), onLand));
  g.add(strip(line, -w, w, 0.02, new THREE.MeshLambertMaterial({ map: tex })));
  // 橋 (桁 + 橋脚)
  const bridgeMat = new THREE.MeshLambertMaterial({ color: 0x8d9298 });
  g.add(partialStrip(line, -w, w, -1.3, bridgeMat, onWater));
  for (const side of [1, -1]) g.add(partialVertical(line, side * w, -1.3, 1.3, bridgeMat, onWater));
  const piers: THREE.Matrix4[] = [];
  for (let i = 0; i < line.pts.length; i++) {
    const p = line.pts[i];
    if (!water[i] || p.s % 28 > 0.9 || !pierOk(p.x, p.z)) continue;
    const ph = p.y - 1.3 + 2.5;
    piers.push(new THREE.Matrix4()
      .makeTranslation(p.x, p.y - 1.3 - ph / 2, p.z)
      .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(p.tx, p.tz)))
      .multiply(new THREE.Matrix4().makeScale(1, ph / 10, 1)));
  }
  if (piers.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 10, 2.0), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }), piers.length);
    piers.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true; inst.receiveShadow = true;
    g.add(inst);
  }
  const railMat = new THREE.MeshPhongMaterial({ color: 0x9aa0a6, shininess: 120, specular: 0xffffff });
  const tieMat = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
  for (const center of [-half, half]) {
    for (const o of [-0.7175, 0.7175]) g.add(strip(line, center + o - 0.05, center + o + 0.05, 0.16, railMat));
    g.add(strip(line, center - 1.25, center + 1.25, 0.06, tieMat));
  }
  return g;
}

/** 新幹線: 高架橋 (桁 + 橋脚 + 防音壁) + 軌道 */
function buildViaduct(line: RailLine, spacing: number, tex: THREE.Texture, terrain: Terrain, pierOk: (x: number, z: number) => boolean): THREE.Group {
  const g = new THREE.Group();
  const half = spacing / 2;
  const w = half + 2.4;
  const deckMat = new THREE.MeshLambertMaterial({ map: tex });
  g.add(strip(line, -w, w, 0.05, deckMat));
  g.add(box3(line, w, -2.2, deckMat));
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xb7bcc2 });
  for (const side of [1, -1]) g.add(vertical(line, side * w, 0.05, 2.0, wallMat));
  const pierMat = new THREE.MeshLambertMaterial({ color: 0xa9aeb4 });
  const piers: THREE.Matrix4[] = [];
  for (const p of line.pts) {
    if (p.s % 30 > 0.9 || !pierOk(p.x, p.z)) continue;
    const ground = Math.max(terrain.groundHeight(p.x, p.z), -1);
    const ph = p.y - 2.2 - ground;
    if (ph < 1) continue;
    piers.push(new THREE.Matrix4()
      .makeTranslation(p.x, ground + ph / 2, p.z)
      .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(p.tx, p.tz)))
      .multiply(new THREE.Matrix4().makeScale(1, ph / 10, 1)));
  }
  if (piers.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 10, 2.2), pierMat, piers.length);
    piers.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true; inst.receiveShadow = true;
    g.add(inst);
  }
  const railMat = new THREE.MeshPhongMaterial({ color: 0x9aa0a6, shininess: 120, specular: 0xffffff });
  for (const center of [-half, half]) for (const o of [-0.7175, 0.7175]) g.add(strip(line, center + o - 0.05, center + o + 0.05, 0.14, railMat));
  return g;
}

/** 横方向 a..b の水平な帯 (高さ dy だけ持ち上げる) */
function strip(line: RailLine, a: number, b: number, dy: number, mat: THREE.Material, faceDown = false): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = line.pts.length;
  for (let i = 0; i < n; i++) {
    const p = line.pts[i];
    pos.push(p.x + p.tz * a, p.y + dy, p.z - p.tx * a);
    pos.push(p.x + p.tz * b, p.y + dy, p.z - p.tx * b);
    const v = p.s / 6;
    uv.push(0, v, 1, v);
    // 巻き順で法線の向きが決まる。軌道敷・レール・床版は上から見るので上向き
    // (法線 +Y)。桁の底面だけ faceDown で下向きにする。
    if (i < n - 1) {
      const q = i * 2;
      if (faceDown) idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      else idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** 条件を満たす区間だけの水平な帯 */
function partialStrip(line: RailLine, a: number, b: number, dy: number, mat: THREE.Material, pred: (i: number) => boolean): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = line.pts.length;
  let vi = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (!pred(i) || !pred(i + 1)) continue;
    for (const k of [i, i + 1]) {
      const p = line.pts[k];
      pos.push(p.x + p.tz * a, p.y + dy, p.z - p.tx * a);
      pos.push(p.x + p.tz * b, p.y + dy, p.z - p.tx * b);
      const v = p.s / 6;
      uv.push(0, v, 1, v);
    }
    idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

/** 縦の板 (防音壁など) */
function vertical(line: RailLine, off: number, y0: number, h: number, mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  const n = line.pts.length;
  for (let i = 0; i < n; i++) {
    const p = line.pts[i];
    pos.push(p.x + p.tz * off, p.y + y0, p.z - p.tx * off);
    pos.push(p.x + p.tz * off, p.y + y0 + h, p.z - p.tx * off);
    if (i < n - 1) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}

/** 条件を満たす区間だけの縦板 */
function partialVertical(line: RailLine, off: number, y0: number, h: number, mat: THREE.Material, pred: (i: number) => boolean): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  const n = line.pts.length;
  let vi = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (!pred(i) || !pred(i + 1)) continue;
    for (const k of [i, i + 1]) {
      const p = line.pts[k];
      pos.push(p.x + p.tz * off, p.y + y0, p.z - p.tx * off);
      pos.push(p.x + p.tz * off, p.y + y0 + h, p.z - p.tx * off);
    }
    idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}

/** 桁の側面 + 底面 */
function box3(line: RailLine, w: number, yBottom: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const side of [1, -1]) g.add(vertical(line, side * w, yBottom, -yBottom, mat));
  g.add(strip(line, -w, w, yBottom, mat, true));
  return g;
}

/** 盛土の斜面 */
function skirt(line: RailLine, w: number, terrain: Terrain, emb: number, mat: THREE.Material, pred: (i: number) => boolean = () => true): THREE.Group {
  const g = new THREE.Group();
  const pos: number[] = [], idx: number[] = [];
  const n = line.pts.length;
  let vi = 0;
  for (const side of [1, -1]) {
    for (let i = 0; i + 1 < n; i++) {
      if (!pred(i) || !pred(i + 1)) continue;
      for (const k of [i, i + 1]) {
        const p = line.pts[k];
        const topX = p.x + p.tz * side * w, topZ = p.z - p.tx * side * w;
        const footOff = w + emb * 1.5;
        const fx = p.x + p.tz * side * footOff, fz = p.z - p.tx * side * footOff;
        pos.push(topX, p.y - 0.04, topZ);
        pos.push(fx, Math.max(terrain.groundHeight(fx, fz), -1.2), fz);
      }
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  g.add(mesh);
  return g;
}

/**
 * 路面電車の安全島。
 * 実際の停留場はコースにしている道路の中央にあるため、走行面上に来る場合は
 * 路面と同じ高さの島だけを描き、上屋や柱は置かない (走行の妨げにしないため)。
 */
function tramStop(st: { name: string; lat: number; lon: number }, line: RailLine, track: Track): THREE.Group {
  const g = new THREE.Group();
  const [x, z] = llToXZ(st.lat, st.lon);
  let best = line.pts[0], bd = Infinity;
  for (const p of line.pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
  g.position.set(best.x, best.y, best.z);
  g.rotation.y = Math.atan2(best.tx, best.tz);
  const nr = track.nearest(best.x, best.z);
  const onCourse = Math.abs(nr.lateral) < track.halfWidth + 2 && nr.dist < track.halfWidth + 6;

  const platMat = new THREE.MeshLambertMaterial({ color: 0xc9ccd0 });
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xe8c33a });
  for (const side of [1, -1]) {
    if (onCourse) {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 20), platMat);
      plat.position.set(side * 3.2, 0.03, 0);
      plat.receiveShadow = true;
      g.add(plat);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 20), stripeMat);
      edge.position.set(side * (3.2 + 0.95), 0.035, 0);
      g.add(edge);
    } else {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 22), platMat);
      plat.position.set(side * 3.2, 0.11, 0);
      plat.receiveShadow = true;
      g.add(plat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 9), new THREE.MeshLambertMaterial({ color: 0x3f7d5a }));
      roof.position.set(side * 3.2, 2.6, 0);
      roof.castShadow = true;
      g.add(roof);
      for (const zz of [-3.8, 3.8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8), new THREE.MeshLambertMaterial({ color: 0x8b9196 }));
        post.position.set(side * 3.7, 1.3, zz);
        g.add(post);
      }
    }
  }
  return g;
}

/** 駅 (ホーム + 上屋) */
function station(stations: { name: string; lat: number; lon: number }[], line: RailLine, roofColor: number, halfW: number, len: number): THREE.Group {
  const g = new THREE.Group();
  for (const st of stations) {
    const [x, z] = llToXZ(st.lat, st.lon);
    let best = line.pts[0], bd = Infinity;
    for (const p of line.pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
    const s = new THREE.Group();
    s.position.set(best.x, best.y, best.z);
    s.rotation.y = Math.atan2(best.tx, best.tz);
    const platMat = new THREE.MeshLambertMaterial({ color: 0xbfc4c9 });
    for (const side of [1, -1]) {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(halfW, 1.0, len), platMat);
      plat.position.set(side * (halfW / 2 + 2.2), 0.5, 0);
      plat.receiveShadow = true;
      s.add(plat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(halfW + 1.4, 0.35, len * 0.85), new THREE.MeshLambertMaterial({ color: roofColor }));
      roof.position.set(side * (halfW / 2 + 2.2), 5.2, 0);
      roof.castShadow = true;
      s.add(roof);
      for (let k = -3; k <= 3; k++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.2, 8), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
        post.position.set(side * (halfW / 2 + 2.2), 2.6, (k * len) / 7.5);
        s.add(post);
      }
    }
    g.add(s);
  }
  return g;
}
