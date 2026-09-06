// SNS 用の素材収録 — オンライン対戦を 2 画面ぶん録る (開発用)
//   PORT=5181 OUT=<dir> node tools/capture_online.mjs
//
// ヘッドレス Chrome でも実 GPU が使えるので (ANGLE/D3D11)、60fps で録れる。
// ロビー → スタート → レースまでを両方の画面で録画し、切り出し用の
// 経過秒を marks.json に書き出す。
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT ?? 'data/shots/capture';
const RACE_SECONDS = Number(process.env.RACE_SECONDS ?? 26);
const BASE = `http://localhost:${process.env.PORT ?? 5180}/`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
});

const marks = {};
const t0 = () => Date.now();
let started = 0;

async function open(query, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: path.join(OUT, label), size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${label} pageerror] ${e.message}`));
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const b = document.getElementById('startBtn');
    return b && !b.disabled;
  }, null, { timeout: 300000 });
  console.log(`${label}: 読み込み完了`);
  return { ctx, page, label };
}

const A = await open('?ai=1&nofps=1&q=high', 'host');
A.start = t0();
await A.page.fill('#playerName', 'ヒロシマ');
await A.page.click('#createBtn');
await A.page.waitForFunction(() => (document.getElementById('roomCode')?.textContent ?? '').length === 5, null, { timeout: 60000 });
const code = await A.page.textContent('#roomCode');
console.log('あいことば:', code);

const B = await open(`?ai=1&nofps=1&q=high&room=${code}`, 'guest');
B.start = t0();
await B.page.fill('#playerName', 'カープ');
await B.page.fill('#roomInput', code);
await B.page.click('#joinBtn');

for (const p of [A, B]) {
  await p.page.waitForFunction(() => document.querySelectorAll('#playerList li').length >= 2, null, { timeout: 120000 })
    .catch(() => console.log(`${p.label}: ロビーに 2 人そろいませんでした`));
}
// ロビーが 2 人並んだ状態を少し見せる
marks.lobbyHost = (Date.now() - A.start) / 1000;
marks.lobbyGuest = (Date.now() - B.start) / 1000;
await A.page.waitForTimeout(5000);

await A.page.click('#goBtn');
started = Date.now();
marks.goHost = (started - A.start) / 1000;
marks.goGuest = (started - B.start) / 1000;
console.log('レース開始');
await A.page.waitForTimeout(RACE_SECONDS * 1000);

marks.code = code;
marks.raceSeconds = RACE_SECONDS;
writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
console.log(JSON.stringify(marks));

for (const p of [A, B]) {
  const v = p.page.video();
  await p.ctx.close();
  const src = await v.path();
  console.log(`${p.label}: ${src}`);
}
await browser.close();
