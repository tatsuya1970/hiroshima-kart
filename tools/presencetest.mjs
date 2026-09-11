// トップ画面の「対戦待ち」表示と、待っている人の部屋へ即座に入れるかの確認 (開発用)
//   PORT=5181 node tools/presencetest.mjs
// ブラウザを 2 つ立ち上げ、A はトップ画面に残し、B が対戦PLAY を押す。
//   1. A のトップ画面に「いま 1 人が対戦待ち（ゲスト）発走まで N 秒」が出るか
//   2. 締切 8 秒前に A が対戦PLAY を押しても、B と同じ部屋に数秒以内に席が決まるか
//      (presence で接続が共有済みなので、リレー経由の 8〜19 秒を待たずに済むはず)
//   3. そのまま発走して、2 人の席が食い違っていないか
import { chromium } from 'playwright';

const BASE = `http://localhost:${process.env.PORT ?? 5180}/`;
const QUERY = `?ai=1&nofps=1&q=low&nolod2=1&steps=${process.env.STEPS ?? '20'}`;
const OUT = process.env.OUT ?? 'data/shots';
/** A が押すときの残り秒数。OPEN_MIN_WAIT (12) より短くして、待っている人の部屋へ入る経路を通す */
const PRESS_AT = Number(process.env.PRESS_AT ?? 8);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(label, name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => console.log(`[${label} pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') console.log(`[${label} error] ${m.text()}`); });
  await page.goto(BASE + QUERY, { waitUntil: 'load' });
  await page.waitForFunction(() => { const b = document.getElementById('startBtn'); return b && !b.disabled; }, null, { timeout: 300000 });
  await page.fill('#playerName', name);
  console.log(`${label}: 読み込み完了`);
  return page;
}
const text = (p, sel) => p.evaluate(s => document.querySelector(s)?.textContent ?? '', sel);
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';

const [a, b] = await Promise.all([open('A', 'みるひと'), open('B', 'ゲスト')]);

// 1. presence でつながるのを待つ (相手が見えるまで)
const okPresence = await a.waitForFunction(() => window.__presence && window.__presence().others >= 1, null, { timeout: 120000 })
  .then(() => true).catch(() => false);
console.log(`[${since()}] A から相手が${okPresence ? '見えました' : '見えません'}: ${await text(a, '#presenceMain')} / ${await text(a, '#presenceSub')}`);

// 2. B が対戦PLAY を押す。A が入るゆとりを残すため枠の頭で押す
const ms = Date.now() % 30000;
if (ms > 2000) { console.log(`枠の頭まで ${((30000 - ms) / 1000).toFixed(1)} 秒待ちます`); await a.waitForTimeout(30000 - ms + 500); }
await b.click('#openBtn');
const bRoom = await b.evaluate(() => window.__net().code);
const clickedB = Date.now();
console.log(`[${since()}] B が対戦PLAY (部屋 ${bRoom})`);

const okLive = await a.waitForFunction(() => document.getElementById('presence')?.classList.contains('live'), null, { timeout: 15000 })
  .then(() => true).catch(() => false);
console.log(`[${since()}] A に対戦待ちが${okLive ? '出ました' : '出ません'} (B が押してから ${((Date.now() - clickedB) / 1000).toFixed(1)} 秒): ${await text(a, '#presenceMain')} / ${await text(a, '#presenceSub')}`);
console.log(`[${since()}] B のロビー側: ${await text(b, '#presence2')}`);
await a.screenshot({ path: `${OUT}/presence_a.png` });

// 3. 締切 PRESS_AT 秒前に A が押すと、B と同じ部屋に即座に席が決まるか
const deadline = await a.evaluate(() => window.__presence().waiting[0]?.deadline ?? 0);
const wait = deadline - PRESS_AT * 1000 - Date.now();
if (wait > 0) { console.log(`[${since()}] 締切 ${PRESS_AT} 秒前まで待ちます (${(wait / 1000).toFixed(1)} 秒)`); await a.waitForTimeout(wait); }
console.log(`[${since()}] 押す直前の A の表示: ${await text(a, '#presenceMain')} / ${await text(a, '#presenceSub')}`);
await a.click('#openBtn');
const clickedA = Date.now();
const aRoom = await a.evaluate(() => window.__net().code);
console.log(`[${since()}] A が対戦PLAY (部屋 ${aRoom}) ${aRoom === bRoom ? '= B と同じ部屋' : '≠ B と違う部屋!'}`);
for (const [p, label] of [[a, 'A'], [b, 'B']]) {
  const ok = await p.waitForFunction(() => document.querySelectorAll('#playerList li').length >= 2, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  const n = await p.evaluate(() => document.querySelectorAll('#playerList li').length);
  console.log(`[${since()}] ${label}: ロビー ${n} 人 ${ok ? '' : '(そろいませんでした)'} A が押してから ${((Date.now() - clickedA) / 1000).toFixed(1)} 秒 / 発走まで ${await text(p, '#countNum')} 秒`);
}
await a.screenshot({ path: `${OUT}/presence_a_lobby.png` });

// 4. 発走して席が食い違っていないか
for (const [p, label] of [[a, 'A'], [b, 'B']]) {
  await p.waitForFunction(() => window.__net && window.__net().started, null, { timeout: 60000 }).catch(() => console.log(`${label}: 発走しませんでした`));
}
await a.waitForTimeout(3000);
for (const [p, label] of [[a, 'A'], [b, 'B']]) {
  const s = await p.evaluate(() => window.__net());
  console.log(`[${since()}] ${label}: 部屋 ${s.code} / 自分の枠 ${s.slot} / ホスト ${s.host} / 開始 ${s.started} / 席 ${s.order.length} 人`);
}
console.log(`[${since()}] A から見た状況: ${JSON.stringify(await a.evaluate(() => window.__presence()))}`);
await browser.close();
