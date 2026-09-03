// PLATEAU (国土交通省) 広島市 2024 CityGML ダウンロードスクリプト
// 対象: 広島駅〜紙屋町〜横川〜マツダスタジアム周辺の 3次メッシュ
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://assets.cms.plateau.reearth.io/assets/cc/d28a0b-63c2-4da8-a8e2-2dc20fc263dc/34100_hiroshima-shi_city_2024_citygml_1_op/udx';
const OUT = path.resolve('data/citygml');

// 3次メッシュ: 行 6..9 (緯度 34.383-34.417), 列 5..9 (経度 132.4375-132.5)
const meshes = [];
for (let r = 6; r <= 9; r++) for (let c = 5; c <= 9; c++) meshes.push(`513243${r}${c}`);

const jobs = [];
for (const m of meshes) {
  jobs.push({ type: 'bldg', url: `${BASE}/bldg/${m}_bldg_6697_op.gml`, file: `${m}_bldg.gml` });
  jobs.push({ type: 'tran', url: `${BASE}/tran/${m}_tran_6697_op.gml`, file: `${m}_tran.gml` });
}
jobs.push({ type: 'luse', url: `${BASE}/luse/513243_luse_6697_op.gml`, file: `513243_luse.gml` });

await mkdir(OUT, { recursive: true });

async function download(job) {
  const dest = path.join(OUT, job.file);
  try {
    const s = await stat(dest);
    if (s.size > 1000) { console.log(`skip (exists) ${job.file} ${(s.size / 1e6).toFixed(1)}MB`); return; }
  } catch {}
  const res = await fetch(job.url);
  if (!res.ok) { console.log(`MISSING ${job.file} (${res.status})`); return; }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`ok ${job.file} ${(buf.length / 1e6).toFixed(1)}MB`);
}

// 4並列
let i = 0;
async function worker() { while (i < jobs.length) { const j = jobs[i++]; try { await download(j); } catch (e) { console.log(`ERR ${j.file}: ${e.message}`); } } }
await Promise.all([worker(), worker(), worker(), worker()]);
console.log('done');
