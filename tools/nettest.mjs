// オンライン対戦の疎通確認 (開発用)
//   PORT=5181 node tools/nettest.mjs
// ブラウザを 2 つ立ち上げて片方が部屋を作り、もう片方が参加し、
// レースを開始してから相手のカートが動いて見えるかを調べる。
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.PORT ?? 5180}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(query, label) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', e => console.log(`[${label} pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') console.log(`[${label} error] ${m.text()}`); });
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const b = document.getElementById('startBtn');
    return b && !b.disabled;
  }, null, { timeout: 240000 });
  console.log(`${label}: 読み込み完了`);
  return page;
}

const STEPS = process.env.STEPS ?? '20';
const a = await open(`?ai=1&nofps=1&q=low&nolod2=1&steps=${STEPS}`, 'A');
await a.fill('#playerName', 'ホスト');
await a.click('#createBtn');
await a.waitForFunction(() => (document.getElementById('roomCode')?.textContent ?? '').length === 5, null, { timeout: 60000 });
const code = await a.textContent('#roomCode');
console.log('あいことば:', code);

const b = await open(`?ai=1&nofps=1&q=low&nolod2=1&steps=${STEPS}&room=${code}`, 'B');
try {
  await b.waitForSelector('#playerName', { state: 'visible', timeout: 60000 });
  await b.fill('#playerName', 'ゲスト');
} catch (e) {
  const html = await b.evaluate(() => document.getElementById('online')?.outerHTML.slice(0, 400) ?? 'なし');
  console.log('B の online パネル:', html);
  throw e;
}
await b.fill('#roomInput', code);
await b.click('#joinBtn');

// 双方のロビーに 2 人そろうまで待つ
for (const [p, label] of [[a, 'A'], [b, 'B']]) {
  await p.waitForFunction(() => document.querySelectorAll('#playerList li').length >= 2, null, { timeout: 120000 })
    .catch(() => console.log(`${label}: ロビーに 2 人そろいませんでした`));
  const n = await p.evaluate(() => document.querySelectorAll('#playerList li').length);
  console.log(`${label}: ロビー ${n} 人`);
}

await a.click('#goBtn');
console.log('レース開始');
// スタート直後にグリッドを俯瞰して、名前の吹き出しが出ているか見る
await b.waitForTimeout(9000);
for (let i = 0; i < 3; i++) { await b.keyboard.press('c'); await b.waitForTimeout(400); }
await b.waitForTimeout(2000);
await b.screenshot({ path: `${process.env.OUT ?? 'data/shots'}/net_grid.png` });
for (let i = 0; i < 1; i++) await b.keyboard.press('c');
const snap = async () => {
  const out = {};
  for (const [p, label] of [[a, 'A'], [b, 'B']]) out[label] = await p.evaluate(() => (window.__net ? window.__net() : null));
  return out;
};
await a.waitForTimeout(30000);
const s1 = await snap();
await a.waitForTimeout(30000);
const s2 = await snap();
console.log('--- 30 秒間の移動量 ---');
for (const label of ['A','B']) {
  if (!s1[label] || !s2[label]) continue;
  console.log(label + ': ' + s2[label].karts.map((k,i) => k.name+' '+Math.round(Math.hypot(k.x-s1[label].karts[i].x, k.z-s1[label].karts[i].z))+'m').join(', '));
}
console.log('--- A と B が見ている位置の差 ---');
if (s2.A && s2.B) console.log(s2.A.karts.map((k,i) => k.name+' '+Math.round(Math.hypot(k.x-s2.B.karts[i].x, k.z-s2.B.karts[i].z))+'m').join(', '));

for (const [p, label] of [[a, 'A'], [b, 'B']]) {
  const s = await p.evaluate(() => (window.__net ? window.__net() : null));
  if (!s) { console.log(`${label}: __net が取れません`); continue; }
  console.log(`${label}: 自分の枠 ${s.slot} / ホスト ${s.host} / 開始 ${s.started} / 席 ${s.order.length} / 名前の吹き出し ${s.labels}`);
  for (const k of s.karts) console.log(`   ${k.i} ${k.name} (${k.x},${k.z}) lap${k.lap} ${k.fromNet ? '受信' : '自前'}`);
}
await a.screenshot({ path: process.env.OUT ? `${process.env.OUT}/net_a.png` : 'data/shots/net_a.png' });
await b.screenshot({ path: process.env.OUT ? `${process.env.OUT}/net_b.png` : 'data/shots/net_b.png' });
await browser.close();
