// HUD (DOM) とミニマップ
import type { Kart } from './kart';
import type { Track } from './track';
import { ITEM_ICON } from './items';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private lapNum = $('lapNum');
  private lapTotal = $('lapTotal');
  private timer = $('timer');
  private pos = $('pos');
  private item = $('item');
  private speed = $('speed');
  private coins = $('coins');
  private landmark = $('landmark');
  private center = $('center');
  private wrong = $('wrong');
  private mm = $('minimap') as HTMLCanvasElement;
  private mctx = this.mm.getContext('2d')!;
  private mapPts: [number, number][] = [];
  private mapScale = 1; private mapOx = 0; private mapOz = 0;
  private landmarkTimer = 0;
  private centerTimer = 0;
  private rouletteIcons = ['🍄', '🍌', '🐢', '⭐'];

  constructor(track: Track, laps: number) {
    this.lapTotal.textContent = String(laps);
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < track.n; i++) { xMin = Math.min(xMin, track.px[i]); xMax = Math.max(xMax, track.px[i]); zMin = Math.min(zMin, track.pz[i]); zMax = Math.max(zMax, track.pz[i]); }
    const pad = 14;
    this.mapScale = Math.min((this.mm.width - pad * 2) / (xMax - xMin), (this.mm.height - pad * 2) / (zMax - zMin));
    this.mapOx = (this.mm.width - (xMax - xMin) * this.mapScale) / 2 - xMin * this.mapScale;
    this.mapOz = (this.mm.height - (zMax - zMin) * this.mapScale) / 2 - zMin * this.mapScale;
    for (let i = 0; i < track.n; i += 3) this.mapPts.push(this.toMap(track.px[i], track.pz[i]));
  }

  private toMap(x: number, z: number): [number, number] { return [x * this.mapScale + this.mapOx, z * this.mapScale + this.mapOz]; }

  showLandmark(name: string) { this.landmark.textContent = name; this.landmark.style.opacity = '1'; this.landmarkTimer = 2.2; }
  showCenter(text: string, dur = 1, color = '#ffd83d') { this.center.textContent = text; this.center.style.color = color; this.center.style.opacity = '1'; this.centerTimer = dur; }

  update(dt: number, player: Kart, karts: Kart[], raceTime: number, track: Track, labels: { idx: number; name: string }[]) {
    this.lapNum.textContent = String(Math.max(1, Math.min(player.lap, Number(this.lapTotal.textContent))));
    const t = Math.max(0, raceTime);
    const m = Math.floor(t / 60), s = t - m * 60;
    this.timer.textContent = `${m}:${s.toFixed(2).padStart(5, '0')}`;
    const r = player.rank;
    const suffix = r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th';
    this.pos.innerHTML = `${r}<small>${suffix}</small>`;
    this.pos.style.color = r === 1 ? '#ffd83d' : r <= 3 ? '#fff' : '#cfd8e3';
    this.speed.innerHTML = `${Math.round(Math.abs(player.speed) * 3.6)}<small> km/h</small>`;
    this.coins.textContent = `🪙 ${player.coins}`;
    if (player.itemRoulette > 0) this.item.textContent = this.rouletteIcons[Math.floor(performance.now() / 90) % 4];
    else this.item.textContent = player.item ? ITEM_ICON[player.item] : '';
    this.item.style.borderColor = player.item ? '#ffd83d' : '#fff';
    if (this.landmarkTimer > 0) { this.landmarkTimer -= dt; if (this.landmarkTimer <= 0) this.landmark.style.opacity = '0'; }
    if (this.centerTimer > 0) { this.centerTimer -= dt; if (this.centerTimer <= 0) this.center.style.opacity = '0'; }
    this.wrong.style.display = player.wrongWayTime > 1.2 ? 'block' : 'none';
    // ミニマップ
    const c = this.mctx;
    c.clearRect(0, 0, this.mm.width, this.mm.height);
    c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineJoin = 'round';
    c.beginPath();
    this.mapPts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath(); c.stroke();
    c.fillStyle = '#ffd83d'; c.font = '9px sans-serif'; c.textAlign = 'center';
    for (const l of labels) { const p = this.toMap(track.px[l.idx], track.pz[l.idx]); c.fillText(l.name, p[0], p[1] - 6); }
    for (const k of karts) {
      const p = this.toMap(k.x, k.z);
      c.beginPath(); c.arc(p[0], p[1], k.def.isPlayer ? 6 : 4, 0, Math.PI * 2);
      c.fillStyle = '#' + k.def.color.toString(16).padStart(6, '0'); c.fill();
      c.lineWidth = k.def.isPlayer ? 2.5 : 1; c.strokeStyle = k.def.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)'; c.stroke();
    }
  }
}
