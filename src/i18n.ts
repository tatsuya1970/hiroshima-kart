// 日本語 / 英語の切り替え。
//
// 判定は ?lang= → localStorage → navigator.language の順。IP から国を見るには
// サーバーが要るので、この構成 (GitHub Pages の静的配信) では使えない。
// 日本語環境から英語で見たい人もいるので、手動の切り替えも必ず出す。
//
// index.html の固定文言は data-en / data-en-html 属性に英語を持たせ、
// applyDomLang() がまとめて差し替える。日本語がソースに残るので読みやすい。

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'hk.lang';

function resolve(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'ja' || q === 'en') return q;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'ja' || saved === 'en') return saved;
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export const lang: Lang = resolve();
export const isJa = lang === 'ja';

/** 言語を変えて読み込み直す (アトラスや地名の描き直しが要るため) */
export function setLang(l: Lang): void {
  localStorage.setItem(STORAGE_KEY, l);
  const url = new URL(location.href);
  url.searchParams.delete('lang'); // ?lang= が残っていると localStorage より優先される
  location.replace(url.toString());
}

type Dict = Record<string, string>;

const JA: Dict = {
  'load.terrain': '地形データ読み込み中...',
  'load.buildings': '建物データ読み込み中...',
  'load.parks': '公園・濠を整地中...',
  'load.course': 'コース生成中...',
  'load.ground': '地形生成中...',
  'load.rail': '鉄道・軌道を敷設中...',
  'load.bldg': '建物 {0} 棟を生成中...',
  'load.bldgDone': '建物 {0} 棟を配置 (コース上 {1} 棟を除去)',
  'load.landmarks': '原爆ドーム・広島城を配置中...',
  'load.lod2Shape': 'LOD2 形状を読み込み中...',
  'load.lod2Tex': 'LOD2 テクスチャ {0}/{1}',
  'load.error': 'エラー: {0}',

  'btn.solo': '1人PLAY',
  'btn.online': '対戦PLAY',
  'btn.again': 'もう一度走る',
  'btn.startNow': 'すぐ始める',
  'btn.leave': 'やめる',

  'lobby.countLabel': '発走まで',
  'lobby.connecting': '接続中...',
  'lobby.you': 'あなた',
  'lobby.host': 'ホスト',
  'lobby.status': 'いま {0} 人。空いた {1} 台は AI が走ります。',
  'lobby.waitHost': ' 発走はホストの合図で揃えます。',
  'net.failed': '接続できませんでした: {0}',

  'race.finalLap': 'ファイナルラップ!',
  'race.finish': 'FINISH!',
  'race.go': 'GO!',
  'race.tram': '路面電車に注意!',
  'race.soloFallback': '接続が間に合わないので 1 人で走ります',

  'q.high': '高 (専用GPU向け)',
  'q.medium': '中 (内蔵GPU向け)',
  'q.low': '低 (最軽量)',

  'item.mushroom': 'キノコ',
  'item.banana': 'バナナ',
  'item.shell': 'ミドリこうら',
  'item.star': 'スター',

  'lang.other': 'English',
};

const EN: Dict = {
  'load.terrain': 'Loading terrain data...',
  'load.buildings': 'Loading building data...',
  'load.parks': 'Shaping parks and the castle moat...',
  'load.course': 'Building the course...',
  'load.ground': 'Building the ground...',
  'load.rail': 'Laying the railways...',
  'load.bldg': 'Building {0} structures...',
  'load.bldgDone': 'Placed {0} buildings ({1} removed from the course)',
  'load.landmarks': 'Placing the A-Bomb Dome and Hiroshima Castle...',
  'load.lod2Shape': 'Loading LOD2 geometry...',
  'load.lod2Tex': 'LOD2 textures {0}/{1}',
  'load.error': 'Error: {0}',

  'btn.solo': 'SOLO PLAY',
  'btn.online': 'ONLINE PLAY',
  'btn.again': 'Race again',
  'btn.startNow': 'Start now',
  'btn.leave': 'Leave',

  'lobby.countLabel': 'Starts in',
  'lobby.connecting': 'connecting...',
  'lobby.you': 'you',
  'lobby.host': 'host',
  'lobby.status': '{0} here. The other {1} karts are AI.',
  'lobby.waitHost': ' The host gives the start signal.',
  'net.failed': 'Could not connect: {0}',

  'race.finalLap': 'FINAL LAP!',
  'race.finish': 'FINISH!',
  'race.go': 'GO!',
  'race.tram': 'Watch out for the tram!',
  'race.soloFallback': 'Could not connect in time. Racing solo.',

  'q.high': 'High (discrete GPU)',
  'q.medium': 'Medium (integrated GPU)',
  'q.low': 'Low (lightest)',

  'item.mushroom': 'Mushroom',
  'item.banana': 'Banana',
  'item.shell': 'Green Shell',
  'item.star': 'Star',

  'lang.other': '日本語',
};

const DICT = isJa ? JA : EN;

/** {0} {1} ... を差し替える */
export function t(key: string, ...args: (string | number)[]): string {
  const s = DICT[key] ?? JA[key] ?? key;
  return s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

/**
 * index.html の固定文言を差し替える。日本語をそのまま置き、英語は
 * data-en (テキスト) / data-en-html (HTML) に持たせておく。
 * placeholder は data-en-placeholder。
 */
export function applyDomLang(): void {
  if (isJa) return;
  document.documentElement.lang = 'en';
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-en]'))) {
    el.textContent = el.dataset.en!;
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-en-html]'))) {
    el.innerHTML = el.dataset.enHtml!;
  }
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('[data-en-placeholder]'))) {
    el.placeholder = el.dataset.enPlaceholder!;
  }
}
