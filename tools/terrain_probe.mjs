// terrain.bin の一部を ASCII で表示 (開発用): node tools/terrain_probe.mjs lat0 lat1 lon0 lon1
import { readFileSync } from 'node:fs';
const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const buf = readFileSync('public/data/terrain.bin');
const data = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const course = JSON.parse(readFileSync('data/course.json', 'utf8'));
const lat0 = course.origin.lat, lon0 = course.origin.lon;
const mPerLat = 110950, mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const [aLat, bLat, aLon, bLon] = process.argv.slice(2).map(Number);
const x0 = (aLon - lon0) * mPerLon, x1 = (bLon - lon0) * mPerLon;
const z0 = -(bLat - lat0) * mPerLat, z1 = -(aLat - lat0) * mPerLat;
for (let z = z0; z <= z1; z += meta.cell * 2) {
  let line = '';
  for (let x = x0; x <= x1; x += meta.cell) {
    const i = Math.round((x - meta.x0) / meta.cell), j = Math.round((z - meta.z0) / meta.cell);
    const v = data[j * meta.w + i];
    if (v === meta.water) { line += '~'; continue; }
    const h = v * meta.scale;
    line += h < 0.6 ? '0' : h < 1.0 ? '1' : h < 1.5 ? '2' : h < 2.0 ? '3' : h < 3 ? '.' : h < 5 ? ':' : '#';
  }
  console.log(line);
}
