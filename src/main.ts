// Hiroshima Kart — メイン
import * as THREE from 'three';
import { loadTerrain, type Terrain } from './terrain';
import { Track } from './track';
import { buildBuildings, type BuildingsData } from './buildings';
import { Kart, type RacerDef } from './kart';
import { ItemSystem } from './items';
import { Hud } from './hud';
import { InputManager } from './input';
import { AudioSystem } from './audio';
import { buildRail, type RailSystem } from './rail';
import { buildGenbakuDome, buildHiroshimaCastle } from './landmarks';
import { loadLod2 } from './lod2';
import { rng, lerp, clamp, WAYPOINTS, llToXZ } from './geo';

const LAPS = 2;
const RACERS: RacerDef[] = [
  { name: 'あなた', color: 0xe63946, accent: 0xffffff, isPlayer: true, skill: 1 },
  { name: 'もみじ', color: 0xd7263d, accent: 0xffd166, isPlayer: false, skill: 0.95 },
  { name: 'カキ', color: 0x3a86ff, accent: 0xffffff, isPlayer: false, skill: 0.85 },
  { name: 'おこのみ', color: 0xff9f1c, accent: 0x2b2d42, isPlayer: false, skill: 0.75 },
  { name: 'レモン', color: 0xffd60a, accent: 0x1b4332, isPlayer: false, skill: 0.7 },
  { name: 'しゃもじ', color: 0x9b5de5, accent: 0xf1faee, isPlayer: false, skill: 0.6 },
  { name: 'でんしゃ', color: 0x2a9d8f, accent: 0xe9c46a, isPlayer: false, skill: 0.55 },
  { name: 'あなご', color: 0x6c757d, accent: 0xf4a261, isPlayer: false, skill: 0.45 },
];

type State = 'loading' | 'title' | 'countdown' | 'race' | 'finish';

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const overlay = document.getElementById('overlay')!;
  const progressBar = document.getElementById('progressBar')!;
  const results = document.getElementById('results')!;
  const resultTable = document.getElementById('resultTable')!;
  const setProgress = (p: number, label?: string) => { progressBar.style.width = `${Math.round(p * 100)}%`; if (label) startBtn.textContent = label; };

  // ---- レンダラー / シーン ----
  const dbg = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !dbg.get('noshadow');
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x9fd3f5);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(0xbfdcf0, 400, 4200);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 6000);
  window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7f6a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(-300, 500, -200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
  sun.shadow.camera.left = -160; sun.shadow.camera.right = 160; sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.5;
  scene.add(sun); scene.add(sun.target);
  // 空 (グラデーションドーム)
  const skyGeo = new THREE.SphereGeometry(5000, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f8fd6) }, bottom: { value: new THREE.Color(0xd9ecf8) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ float t = clamp(h*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(t,0.7)),1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // ---- データ読み込み ----
  setProgress(0.05, '地形データ読み込み中...');
  const terrain: Terrain = await loadTerrain(p => setProgress(0.05 + p * 0.15));
  setProgress(0.2, '建物データ読み込み中...');
  const [bData, rData] = await Promise.all([
    (await fetch('/data/buildings.json')).json() as Promise<BuildingsData>,
    (await fetch('/data/roads.json')).json() as Promise<{ items: number[][] }>,
  ]);
  setProgress(0.4, 'コース生成中...');
  await nextFrame();
  const track = new Track(terrain);
  setProgress(0.44, '地形生成中...');
  await nextFrame();
  scene.add(terrain.build(rData.items, (ctx, sx, sz) => track.drawMask(ctx, sx, sz, terrain.xMin, terrain.zMin)));
  scene.add(makeHills(terrain));
  // デバッグ用トグル: ?norail=1 / ?nolod2=1 / ?nodome=1 / ?nobldg=1
  const params = new URLSearchParams(location.search);
  setProgress(0.5, '鉄道・軌道を敷設中...');
  await nextFrame();
  const rail: RailSystem = buildRail(terrain, track);
  if (!params.get('norail')) scene.add(rail.group);
  setProgress(0.56, `建物 ${bData.count} 棟を生成中...`);
  await nextFrame();
  let stat = '';
  const bldgGroup = buildBuildings(bData, track, terrain, s => (stat = s), ring => rail.blocksBuilding(ring));
  if (!params.get('nobldg')) scene.add(bldgGroup);
  setProgress(0.68, stat);
  await nextFrame();
  // PLATEAU LOD2 (実写テクスチャ)
  if (!params.get('nolod2')) {
    try {
      const lod2 = await loadLod2((p, label) => setProgress(0.68 + p * 0.24, label));
      scene.add(lod2.group);
      console.log(`LOD2: ${lod2.triangles} 三角形 / アトラス ${lod2.meta.atlases.length} 枚`);
    } catch (e) {
      console.warn('LOD2 の読み込みに失敗しました', e);
    }
  }
  setProgress(0.94, '原爆ドーム・広島城を配置中...');
  await nextFrame();
  if (!params.get('nodome')) {
    scene.add(buildGenbakuDome(terrain));
    scene.add(buildHiroshimaCastle(terrain));
  }
  scene.add(track.buildMesh());

  // ---- カート / アイテム ----
  const rand = rng(20240803);
  const karts = RACERS.map(d => new Kart(d));
  const player = karts[0];
  const startOrder = [3, 1, 0, 2, 4, 5, 6, 7]; // グリッド順 (index of karts)
  startOrder.forEach((ki, slot) => {
    const row = Math.floor(slot / 2), col = slot % 2;
    const idx = track.n - 8 - row * 5;
    karts[ki].placeAt(track, idx, col === 0 ? -3.5 : 3.5);
    scene.add(karts[ki].mesh);
  });
  const items = new ItemSystem(track, rand);
  scene.add(items.group);
  const hud = new Hud(track, LAPS);
  const input = new InputManager();
  const audio = new AudioSystem();
  input.onMute = () => audio.toggleMute();
  let camMode = 0;
  input.onCamera = () => { camMode = (camMode + 1) % 4; };

  // ---- イベント ----
  const kartEvents = {
    onLap: (k: Kart) => {
      if (!k.def.isPlayer) { if (k.lap > LAPS && !k.finished) { k.finished = true; k.finishTime = raceTime; } return; }
      if (k.lap > LAPS) { if (!k.finished) finishRace(); }
      else if (k.lap >= 2) { hud.showCenter(`LAP ${k.lap}`, 1.2); audio.lap(); if (k.lap === LAPS) hud.showLandmark('ファイナルラップ!'); }
    },
    onBoost: (k: Kart) => { if (k.def.isPlayer) audio.boost(); },
    onBump: (k: Kart, f: number) => { if (k.def.isPlayer && f > 8) audio.bump(); },
    onRouletteDone: (k: Kart) => { k.item = items.roll(k.rank, karts.length); },
  };
  const itemEvents = {
    onPickup: (k: Kart) => { if (k.def.isPlayer) audio.pickup(); },
    onCoin: (k: Kart) => { if (k.def.isPlayer) audio.coin(); },
    onHit: (v: Kart, _by: Kart | null) => { if (v.def.isPlayer) { audio.hit(); v.coins = Math.max(0, v.coins - 2); } },
    onUse: (k: Kart) => { if (k.def.isPlayer) audio.useItem(); },
    onBoost: (k: Kart) => { if (k.def.isPlayer) audio.boost(); },
  };

  // ---- レース状態 ----
  let state: State = 'title';
  let raceTime = 0;
  let countdown = 0;
  let lastLabel = -1;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camFov = 70;

  function finishRace() {
    player.finished = true; player.finishTime = raceTime;
    state = 'finish';
    audio.finish();
    hud.showCenter('FINISH!', 3);
    setTimeout(showResults, 2500);
  }
  function showResults() {
    const sorted = [...karts].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress);
    resultTable.innerHTML = sorted.map((k, i) => {
      const t = k.finished ? fmt(k.finishTime) : '--:--.--';
      return `<tr style="${k.def.isPlayer ? 'color:#ffd83d;font-weight:800' : ''}"><td>${i + 1}</td><td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#${k.def.color.toString(16).padStart(6, '0')}"></span></td><td>${k.def.name}</td><td>${t}</td></tr>`;
    }).join('');
    results.style.display = 'block';
    overlay.style.display = 'flex';
    startBtn.textContent = 'もう一度走る';
    startBtn.disabled = false;
    startBtn.onclick = () => location.reload();
  }
  const fmt = (t: number) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; };

  startBtn.disabled = false;
  startBtn.textContent = 'スタート!';
  startBtn.onclick = () => {
    overlay.style.display = 'none';
    audio.start();
    state = 'countdown'; countdown = 3.999;
    audio.countdown();
  };
  input.onAny = () => audio.start();

  // デバッグ: ?debug=1&idx=<サンプル番号>&wp=<経由地>&cam=<0..3> でカウントダウン無しに任意地点から開始
  if (params.get('debug')) {
    overlay.style.display = 'none';
    let idx = Number(params.get('idx') ?? 0);
    const wp = params.get('wp');
    if (wp !== null) { const w = WAYPOINTS[Number(wp)]; const [wx, wz] = llToXZ(w.lat, w.lon); idx = track.nearest(wx, wz).idx; }
    player.placeAt(track, idx - 3, 0);
    const f0 = new THREE.Vector3(Math.cos(player.heading), 0, Math.sin(player.heading));
    camPos.set(player.x - f0.x * 7.5, player.y + 3.2, player.z - f0.z * 7.5);
    camLook.set(player.x + f0.x * 6, player.y + 1.2, player.z + f0.z * 6);
    karts.forEach((k, i) => { if (i > 0) k.placeAt(track, idx - 3 - 6 * i, (i % 2 ? 3.5 : -3.5)); });
    camMode = Number(params.get('cam') ?? 0);
    state = 'race';
    (window as any).__debug = { track, karts, terrain, scene, camera, rail, THREE };
  }

  // 初期カメラ (タイトル: 上空から)
  const p0 = track.pointAt(0, 0);
  camera.position.set(p0.x + 60, p0.y + 90, p0.z + 120);
  camera.lookAt(p0);

  // ---- ループ ----
  let last = performance.now();
  let titleAngle = 0;
  // デバッグ: steps=N で 1 フレームに N 回 (1/60s) 物理更新, ai=1 でプレイヤーも AI 操作
  const debugSteps = Number(params.get('steps') ?? 0);
  const debugAi = params.get('ai') === '1';
  const idleInput = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false };
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dtRaw = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = dtRaw;
    if (state === 'title') {
      titleAngle += dt * 0.15;
      const r = 140;
      camera.position.set(p0.x + Math.cos(titleAngle) * r, p0.y + 70 + Math.sin(titleAngle * 0.7) * 15, p0.z + Math.sin(titleAngle) * r);
      camera.lookAt(p0.x, p0.y + 10, p0.z);
      updateSun(camera.position);
      renderer.render(scene, camera);
      return;
    }
    if (state === 'countdown') {
      const prev = Math.ceil(countdown);
      countdown -= dt;
      const cur = Math.ceil(countdown);
      if (cur !== prev) {
        if (cur >= 1) { hud.showCenter(String(cur), 0.9); audio.countdown(); }
        else { hud.showCenter('GO!', 1, '#7cff5a'); audio.countdown(true); state = 'race'; raceTime = 0; }
      } else if (prev === 4 && countdown < 3) { /* noop */ }
      if (countdown > 3) { /* 表示待ち */ } else if (cur >= 1 && hud) { /* number shown on change */ }
    }
    const racing = state === 'race' || state === 'finish';
    const pin = racing ? input.read() : (input.read(), idleInput);
    if (debugSteps > 0 && racing) { for (let i = 0; i < debugSteps; i++) simulate(1 / 60, pin, racing); }
    else simulate(dt, pin, racing);
    // カメラ
    updateCamera(dt, pin.lookBack);
    updateSun(player.mesh.position);
    hud.update(dt, player, karts, raceTime, track, track.labels);
    audio.engineUpdate(Math.abs(player.speed), pin.throttle, player.boostTimer > 0);
    renderer.render(scene, camera);
  }

  function simulate(dt: number, pin: typeof idleInput, racing: boolean) {
    if (racing) raceTime += dt;
    rail.update(dt);
    for (const k of karts) {
      let inp = pin;
      if (!k.def.isPlayer || k.finished || debugAi) inp = racing ? k.aiInput(dt, track, karts, player, rand) : idleInput;
      if (inp.item && racing) items.use(k, itemEvents);
      k.update(dt, racing ? inp : idleInput, track, kartEvents);
    }
    // カート同士の衝突
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.3 * 2.3 && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (2.3 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        if (a.invincible && !b.invincible && b.spinTimer <= 0) { b.spinTimer = 1.2; itemEvents.onHit(b, a); }
        if (b.invincible && !a.invincible && a.spinTimer <= 0) { a.spinTimer = 1.2; itemEvents.onHit(a, b); }
        const avg = (a.speed + b.speed) / 2;
        a.speed = lerp(a.speed, avg, 0.3); b.speed = lerp(b.speed, avg, 0.3);
        if (a.def.isPlayer || b.def.isPlayer) audio.bump();
      }
    }
    // 路面電車との接触 (広電はコースの真ん中を走る)
    if (racing) {
      for (const k of karts) {
        if (k.spinTimer > 0 || k.invincible) continue;
        if (rail.hitTram(k.x, k.z, 1.3)) {
          k.spinTimer = 1.5; k.drifting = 0; k.speed *= 0.25;
          itemEvents.onHit(k, null);
          if (k.def.isPlayer) hud.showLandmark('路面電車に注意!');
        }
      }
    }
    if (racing) items.update(dt, karts, itemEvents);
    // 順位
    const order = [...karts].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress);
    order.forEach((k, i) => (k.rank = i + 1));
    // 地名表示
    for (const l of track.labels) {
      const d = track.wrap(player.trackIdx - l.idx);
      if (d >= 0 && d < 6 && lastLabel !== l.idx && racing) { lastLabel = l.idx; hud.showLandmark(l.name); }
    }
  }

  // デバッグ用の撮影カメラ: ?photo=<lat>,<lon>,<注視高さ>,<距離>,<方位角deg>
  const photoArg = params.get('photo');
  const photo = photoArg ? photoArg.split(',').map(Number) : null;

  function updateCamera(dt: number, lookBack: boolean) {
    const fx = Math.cos(player.heading), fz = Math.sin(player.heading);
    if (photo) {
      const [plat, plon, ph = 12, pd = 70, paz = 180] = photo;
      const [tx, tz] = llToXZ(plat, plon);
      const a = (paz * Math.PI) / 180;
      camera.position.set(tx + Math.sin(a) * pd, terrain.groundHeight(tx, tz) + ph + pd * 0.35, tz + Math.cos(a) * pd);
      camera.lookAt(tx, terrain.groundHeight(tx, tz) + ph, tz);
      camera.fov = 55; camera.updateProjectionMatrix();
      return;
    }
    if (camMode === 3) { // 俯瞰 (デバッグ)
      camera.position.set(player.x, player.y + 320, player.z + 1);
      camera.lookAt(player.x, player.y, player.z);
      camera.fov = 60; camera.updateProjectionMatrix();
      return;
    }
    const dist = camMode === 0 ? 7.5 : camMode === 1 ? 12 : 0.4;
    const height = camMode === 0 ? 3.2 : camMode === 1 ? 5.5 : 1.4;
    const dir = lookBack ? -1 : 1;
    const back = camMode === 2 ? -1 : 1;
    const target = new THREE.Vector3(player.x - fx * dist * dir * back, player.y + height, player.z - fz * dist * dir * back);
    const speedT = clamp(player.speed / 56, 0, 1);
    const k = camMode === 2 ? 1 : Math.min(1, dt * (5 + speedT * 3));
    camPos.lerp(target, k);
    if (camMode === 2) camPos.copy(target);
    const lookAt = new THREE.Vector3(player.x + fx * 6 * dir, player.y + 1.2, player.z + fz * 6 * dir);
    camLook.lerp(lookAt, Math.min(1, dt * 10));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fovTarget = 68 + speedT * 12 + (player.boostTimer > 0 ? 10 : 0) + (player.starTimer > 0 ? 4 : 0);
    camFov = lerp(camFov, fovTarget, Math.min(1, dt * 4));
    camera.fov = camFov; camera.updateProjectionMatrix();
  }
  function updateSun(center: THREE.Vector3) {
    sun.position.set(center.x - 300, center.y + 500, center.z - 200);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    sky.position.copy(center);
  }
  requestAnimationFrame(frame);
}

function nextFrame() { return new Promise<void>(r => requestAnimationFrame(() => r())); }

/** データ範囲外を囲む遠景の山並み (広島は三方を山に囲まれている) */
function makeHills(terrain: Terrain): THREE.Mesh {
  const cx = (terrain.xMin + terrain.xMax) / 2, cz = (terrain.zMin + terrain.zMax) / 2;
  const size = 14000, seg = 140;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const r = rng(7);
  const noise = (x: number, z: number) => Math.sin(x * 0.0021 + 1.3) * Math.cos(z * 0.0017 + 0.4) * 0.5 + Math.sin(x * 0.0063 + z * 0.0041) * 0.3 + Math.sin(x * 0.013 - z * 0.011) * 0.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    const dx = Math.max(0, Math.abs(x - cx) - (terrain.xMax - terrain.xMin) / 2 - 250);
    const dz = Math.max(0, Math.abs(z - cz) - (terrain.zMax - terrain.zMin) / 2 - 250);
    const d = Math.hypot(dx, dz);
    // 南側 (z 正 = 南) は海なので低く
    const southFactor = z > cz + 800 ? 0.15 : 1;
    const ramp = clamp((d - 200) / 1500, 0, 1);
    let y = -6 + ramp * (180 + 140 * noise(x, z) + r() * 6) * southFactor;
    if (d === 0) y = -6;
    pos.setXYZ(i, x, y, z);
    const g = clamp((y + 6) / 200, 0, 1);
    col[i * 3] = 0.35 - g * 0.1; col[i * 3 + 1] = 0.55 - g * 0.1; col[i * 3 + 2] = 0.3;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  return mesh;
}

main().catch(e => { console.error(e); const b = document.getElementById('startBtn')!; b.textContent = 'エラー: ' + e.message; });
