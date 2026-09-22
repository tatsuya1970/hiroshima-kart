// 連番 PNG (tools/record_clip.mjs の出力) を mp4 にする。
//   [SRC=<連番PNGのある所>] node tools/clips_to_mp4.mjs <出力ディレクトリ> [クリップ名...]
//   例: node tools/clips_to_mp4.mjs videos/fukuyama-kart-promo/assets
//
// HyperFrames はレンダリング時に動画を任意の時刻へシークするので、
// GOP を短く (-g 5) して全フレームを正確に取り出せるようにする。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// 読み込み元。縦型は SRC=videos/clips9x16 のように渡す
//   SRC=videos/clips9x16 node tools/clips_to_mp4.mjs videos/fukuyama-kart-promo-9x16/assets
const SRC = process.env.SRC ?? 'videos/clips';
const outDir = process.argv[2];
if (!outDir) { console.error('使い方: node tools/clips_to_mp4.mjs <出力ディレクトリ> [クリップ名...]'); process.exit(1); }
const want = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

const names = readdirSync(SRC, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_'))
  .map(d => d.name)
  .filter(n => !want.length || want.includes(n));

for (const name of names) {
  const dir = path.join(SRC, name);
  const frames = readdirSync(dir).filter(f => f.endsWith('.png')).length;
  if (!frames) { console.log(`${name}: コマが無いので飛ばします`); continue; }
  const out = path.join(outDir, `${name}.mp4`);
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', '30', '-i', path.join(dir, '%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-g', '5', '-keyint_min', '1', '-sc_threshold', '0',
    '-movflags', '+faststart', out,
  ], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${name} の変換に失敗しました`); process.exit(1); }
  console.log(`${name}: ${frames} コマ → ${out} (${(frames / 30).toFixed(1)}s)`);
}
if (!existsSync(outDir)) process.exit(1);
console.log('done');
