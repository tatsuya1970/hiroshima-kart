// プロモ動画の素材を一括で撮る（福山版 tools/record_promo.mjs と同じ作り）。
//   PORT=5180 node tools/record_promo.mjs [クリップ名...]
// 名前を省くと全部撮る。撮り終わったら tools/clips_to_mp4.mjs で mp4 にする。
//   node tools/clips_to_mp4.mjs videos/assets
//
// warm は「撮り始める前に空回しするコマ数」。?idx= で置いた車は速度 0 から始まり、
// 120 コマでおよそ 61 点 (1 点 = 2m) 進んで巡航 (約 0.96 点/コマ) に乗る。
// 見せ場の到達コマは tools/_probe_idx.mjs で実測した値から逆算してある。
// idx は data/course_path.json の通し番号。コースを引き直したらここも直すこと。
import { spawnSync } from 'node:child_process';

const OUT = process.env.OUT ?? 'videos/clips';
const extraFor = name => process.env[`Q_${name}`] ?? '';

const BASE = 'rec=1&nohud=1&nofps=1&debug=1&q=high';
const CLIPS = [
  // 広島駅のスタート。ライバルを前に並べて 8 台が画に入るようにする
  { name: 'grid', secs: 3.5, warm: 16, q: `${BASE}&ai=1&ahead=1&idx=14&cam=1` },
  // 相生通りを西へ。八丁堀〜紙屋町の市街地
  { name: 'city', secs: 4.0, warm: 120, q: `${BASE}&ai=1&ahead=1&idx=820&cam=0` },
  // 原爆ドーム前の看板ゲート (idx 1168) を 50 コマ目に通す。idx 1215 付近で AI が壁に当たるので 3.3 秒で切る
  { name: 'dome', secs: 3.3, warm: 120, q: `${BASE}&ai=1&ahead=1&idx=1062&cam=0` },
  // 原爆ドームを空から。撮影カメラを 7度/秒 で回す
  { name: 'dome_air', secs: 5.0, warm: 2, q: `${BASE}&wp=8&photo=34.39551,132.45364,14,90,200&orbit=7` },
  // エディオンピースウィング (idx 1929) の横を抜ける
  { name: 'peacewing', secs: 4.0, warm: 120, q: `${BASE}&ai=1&ahead=1&idx=1811&cam=0` },
];

const want = process.argv.slice(2);
for (const c of CLIPS) {
  if (want.length && !want.includes(c.name)) continue;
  console.log(`=== ${c.name} (${c.secs}s)`);
  const r = spawnSync(process.execPath, ['tools/record_clip.mjs', `${OUT}/${c.name}`, String(c.secs), c.q + extraFor(c.name)],
    { stdio: 'inherit', env: { ...process.env, WARM: String(c.warm) } });
  if (r.status !== 0) { console.error(`${c.name} で失敗しました`); process.exit(1); }
}
console.log('done');
