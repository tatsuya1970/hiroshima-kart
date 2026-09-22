// 指定 idx に到達するコマ数を測る (スクショなしなので速い)。
//   node tools/_probe_idx.mjs <開始idx> <コマ数> <目標idx>
import { chromium } from 'playwright';

const startIdx = process.argv[2];
const steps = Number(process.argv[3] ?? 300);
const target = Number(process.argv[4] ?? -1);
const PORT = process.env.PORT ?? '5180';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${PORT}/?rec=1&nohud=1&nofps=1&debug=1&q=low&ai=1&ahead=1&idx=${startIdx}&cam=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug && window.__recStep, null, { timeout: 600000 });
await page.waitForTimeout(1500);

const read = () => page.evaluate(() => {
  const k = window.__debug.karts[0];
  return { idx: k.trackIdx, speed: Math.round(k.speed), finished: !!k.finished };
});
let hit = -1;
for (let i = 1; i <= steps; i++) {
  await page.evaluate(() => window.__recStep(1));
  const s = await read();
  if (hit < 0 && target > 0 && s.idx >= target) { hit = i; console.log(`>>> idx ${target} 到達: ${i} コマ目 (${(i/30).toFixed(2)}s) speed ${s.speed}`); }
  if (i % 20 === 0) console.log(i, JSON.stringify(s));
}
if (target > 0 && hit < 0) console.log(`>>> ${steps} コマでは ${target} に届きませんでした`);
await browser.close();
