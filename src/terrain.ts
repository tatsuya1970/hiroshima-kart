// 地形 (PLATEAU DEM) と地面テクスチャ (PLATEAU 道路面をラスタライズ)
import * as THREE from 'three';

export interface TerrainMeta {
  w: number;
  h: number;
  cell: number;
  x0: number;
  z0: number;
  water: number;
  scale: number;
}

export class Terrain {
  meta: TerrainMeta;
  data: Int16Array;
  mesh!: THREE.Mesh;
  waterMesh!: THREE.Mesh;
  readonly WATER_LEVEL = -0.4;

  constructor(meta: TerrainMeta, data: Int16Array) {
    this.meta = meta;
    this.data = data;
  }

  get xMin() { return this.meta.x0; }
  get zMin() { return this.meta.z0; }
  get xMax() { return this.meta.x0 + (this.meta.w - 1) * this.meta.cell; }
  get zMax() { return this.meta.z0 + (this.meta.h - 1) * this.meta.cell; }

  /** セル値 (水面は null) */
  cell(i: number, j: number): number | null {
    const { w, h, water, scale } = this.meta;
    if (i < 0 || j < 0 || i >= w || j >= h) return null;
    const v = this.data[j * w + i];
    return v === water ? null : v * scale;
  }

  isWater(x: number, z: number): boolean {
    const { cell, x0, z0 } = this.meta;
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
    return this.cell(i, j) === null;
  }

  /** バイリニア補間した標高。水面セルは null */
  heightAt(x: number, z: number): number | null {
    const { cell, x0, z0 } = this.meta;
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = this.cell(i, j), b = this.cell(i + 1, j), c = this.cell(i, j + 1), d = this.cell(i + 1, j + 1);
    if (a === null || b === null || c === null || d === null) {
      const vals = [a, b, c, d].filter((v): v is number => v !== null);
      if (vals.length === 0) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    }
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** 陸地の標高 (水面上なら近傍の陸地から推定) */
  groundHeight(x: number, z: number): number {
    const h = this.heightAt(x, z);
    if (h !== null) return h;
    const { cell, x0, z0 } = this.meta;
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
    for (let r = 1; r < 60; r++) {
      let s = 0, n = 0;
      for (let dj = -r; dj <= r; dj += r) for (let di = -r; di <= r; di += r) {
        const v = this.cell(i + di, j + dj);
        if (v !== null) { s += v; n++; }
      }
      if (n) return s / n;
    }
    return 2;
  }

  /** 地形メッシュを生成。roads は地面テクスチャに描画する道路ポリゴン */
  build(roads: number[][], trackMask: (ctx: CanvasRenderingContext2D, sx: number, sz: number) => void): THREE.Group {
    const { w, h, cell, x0, z0, water, scale } = this.meta;
    const group = new THREE.Group();

    // ---- 地面テクスチャ ----
    const worldW = (w - 1) * cell, worldH = (h - 1) * cell;
    const texW = Math.min(4096, Math.round(worldW)), texH = Math.min(4096, Math.round(worldH));
    const cv = document.createElement('canvas');
    cv.width = texW; cv.height = texH;
    const ctx = cv.getContext('2d')!;
    const sx = texW / worldW, sz = texH / worldH;
    // 街区のベース色
    ctx.fillStyle = '#b9b3a6';
    ctx.fillRect(0, 0, texW, texH);
    // 微妙なノイズ (街区のバリエーション)
    for (let k = 0; k < 4000; k++) {
      const px = Math.random() * texW, py = Math.random() * texH, r = 8 + Math.random() * 40;
      ctx.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${150 + Math.random() * 50 | 0},${130 + Math.random() * 40 | 0},0.25)`;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
    // 道路 (PLATEAU tran)
    ctx.fillStyle = '#5c5d61';
    ctx.strokeStyle = '#8b8c90';
    ctx.lineWidth = 1.2;
    for (const poly of roads) {
      ctx.beginPath();
      for (let i = 1; i < poly.length; i += 2) {
        const px = (poly[i] - x0) * sx, py = (poly[i + 1] - z0) * sz;
        if (i === 1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    trackMask(ctx, sx, sz);
    (window as any).__groundCanvas = cv; // デバッグ用
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.flipY = false;

    // ---- 地形ジオメトリ ----
    const geo = new THREE.PlaneGeometry(worldW, worldH, w - 1, h - 1);
    geo.rotateX(-Math.PI / 2); // XZ平面, 法線 +Y
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const raw = this.data[k];
        const isWater = raw === water;
        const y = isWater ? -1.8 : raw * scale;
        pos.setXYZ(k, x0 + i * cell, y, z0 + j * cell);
        uv.setXY(k, i / (w - 1), j / (h - 1));
        if (isWater) c.setRGB(0.35, 0.4, 0.42);
        else if (y > 25) c.setRGB(0.42, 0.6, 0.35);
        else if (y > 9) { const t = (y - 9) / 16; c.setRGB(1 - 0.55 * t, 1 - 0.35 * t, 1 - 0.6 * t); }
        else c.setRGB(1, 1, 1);
        colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    group.add(this.mesh);

    // ---- 水面 ----
    const wgeo = new THREE.PlaneGeometry(worldW + 2000, worldH + 2000);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshPhongMaterial({ color: 0x2f7fb8, shininess: 25, specular: 0x334f66, transparent: true, opacity: 0.85 });
    this.waterMesh = new THREE.Mesh(wgeo, wmat);
    this.waterMesh.position.set(x0 + worldW / 2, this.WATER_LEVEL, z0 + worldH / 2);
    group.add(this.waterMesh);
    return group;
  }
}

export async function loadTerrain(onProgress?: (p: number) => void): Promise<Terrain> {
  const meta: TerrainMeta = await (await fetch('/data/terrain.json')).json();
  onProgress?.(0.5);
  const buf = await (await fetch('/data/terrain.bin')).arrayBuffer();
  onProgress?.(1);
  return new Terrain(meta, new Int16Array(buf));
}
