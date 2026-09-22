// プロモ動画の素材撮り。実時間に依存せず 1/30 秒ずつ進めて連番 PNG を撮る。
//   node tools/record_clip.mjs <出力ディレクトリ> <秒数> <クエリ>
//   例: node tools/record_clip.mjs videos/clips/castle 4 "rec=1&nohud=1&photo=34.49104,133.36113,16,150,150&orbit=6"
//
// ゲーム側は src/main.ts の ?rec=1 で window.__recStep(n) を生やす。描画が 1〜8fps しか
// 出ない環境 (swiftshader) でも、コマごとに進めて撮るので出力は滑らかになる。
// 撮り終わったら tools/clips_to_mp4.mjs で mp4 にする。
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const [outDir, secsArg, query] = process.argv.slice(2);
if (!outDir || !secsArg || !query) {
  console.error('使い方: node tools/record_clip.mjs <出力ディレクトリ> <秒数> <クエリ>');
  process.exit(1);
}
const FPS = 30;
const frames = Math.round(Number(secsArg) * FPS);
const WARM = Number(process.env.WARM ?? 30);   // 撮り始める前に進めるコマ数
const PORT = process.env.PORT ?? '5180';
const W = Number(process.env.W ?? 1920), H = Number(process.env.H ?? 1080);
const SHOT_TIMEOUT = 300000;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${PORT}/?${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__recStep, null, { timeout: 600000 });
await page.waitForTimeout(1500);

/** 1 コマ進めて、合成が終わるまで待つ。swiftshader では描き込みが遅れて
 *  途中の画面を撮ってしまうので、rAF を 2 回またいでから撮る。 */
const stepAndSettle = (n = 1) => page.evaluate(k => {
  window.__recStep(k);
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}, n);

// 空回しは小分けにする。一度に何百コマも回すと描画スレッドが詰まり、
// 直後の 1 枚目のスクショがタイムアウトすることがある。
for (let done = 0; done < WARM; done += 10) await stepAndSettle(Math.min(10, WARM - done));
if (WARM > 0) await page.waitForTimeout(1000);

for (let i = 0; i < frames; i++) {
  await stepAndSettle();
  const file = `${outDir}/${String(i).padStart(4, '0')}.png`;
  try {
    await page.screenshot({ path: file, timeout: SHOT_TIMEOUT });
  } catch (e) {
    // swiftshader がたまに 1 枚だけ詰まる。少し待ってもう一度だけ試す。
    console.log(`${outDir}: ${i} コマ目でつまずいたので撮り直します (${e.name})`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: file, timeout: SHOT_TIMEOUT });
  }
  if (i % 30 === 0) console.log(`${outDir}: ${i}/${frames}`);
}
console.log(`${outDir}: ${frames} コマ (${(frames / FPS).toFixed(1)}s)`);
await browser.close();
