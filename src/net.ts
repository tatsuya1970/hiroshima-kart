// オンライン対戦 — サーバー無しの P2P (WebRTC)
//
// このゲームは GitHub Pages で配信しているので、常駐サーバーを置けない。
// そのため trystero を使い、公開リレーをシグナリングにして WebRTC を直接つなぐ。
// 通るのはシグナリング (どの部屋に誰がいるか) だけで、レース中の通信は
// ブラウザ同士の直結になる。
//
// 権威の持ち方:
//   - 自分のカートは自分だけが物理計算する (クライアント権威)。他人のカートは
//     受け取った位置へ補間するだけ。カートゲームなので多少ずれても破綻しない。
//   - 空き枠の AI はホストだけが計算し、位置を配る。
//   - アイテムボックスの取得と被弾は「そのカートを持っている側」だけが判定し、
//     結果をイベントで配る。判定を一箇所に寄せないと、各自の画面で別々に
//     当たったことになってしまう。
//   - ホストは部屋を作った人。抜けたら残った中で ID が最小の人へ自動的に移る。
import { joinRoom, selfId } from 'trystero/nostr';
import type { JsonValue, MessageAction, Room } from 'trystero/nostr';

const APP_ID = 'hiroshima-kart';
/** 作成者が誰か分かるまで、参加した側がホストを名乗らずに待つ時間 */
const HOST_GRACE_MS = 5000;

/** 1 カート分の同期データ */
export interface Pose {
  slot: number;
  x: number; z: number; y: number;
  heading: number;
  speed: number;
  drifting: number;
  spin: number;
  lap: number;
  s: number;
  boost: number;
  star: number;
  finished: number;
}

const POSE_LEN = 12;

function packPose(p: Pose): number[] {
  return [p.slot, p.x, p.z, p.y, p.heading, p.speed, p.drifting, p.spin, p.lap, p.s, p.boost, p.star];
}

function unpackPose(a: number[], off: number): Pose {
  return {
    slot: a[off], x: a[off + 1], z: a[off + 2], y: a[off + 3], heading: a[off + 4],
    speed: a[off + 5], drifting: a[off + 6], spin: a[off + 7], lap: a[off + 8], s: a[off + 9],
    boost: a[off + 10], star: a[off + 11], finished: 0,
  };
}

export interface LobbyInfo {
  /** 座席順の peer id。添字がそのままカートの枠になる */
  order: string[];
  names: Record<string, string>;
  seed: number;
}

/** アイテムの使用・被弾など、位置以外の出来事 */
export type NetEvent =
  | { t: 'use'; slot: number; item: string; x: number; z: number; y: number; heading: number; speed: number }
  | { t: 'hit'; slot: number }
  | { t: 'fin'; slot: number; time: number };

export interface NetHandlers {
  onLobby(info: LobbyInfo): void;
  onStart(): void;
  onPose(poses: Pose[]): void;
  onEvent(ev: NetEvent): void;
  onPeers(): void;
}

/** あいことば: 紛らわしい文字 (0/O, 1/I) を除いた 5 文字 */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function normalizeRoomCode(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

/** 公開ロビーの 1 枠の長さ (秒)。この境目でレースが始まる */
export const OPEN_PERIOD = 30;
/** これより締切が近い枠には入れず、次の枠へ回す (入った瞬間に発走しないように) */
const OPEN_MIN_WAIT = 12;

/**
 * 公開ロビーの部屋名と締切。
 *
 * 壁時計を OPEN_PERIOD 秒ごとに区切り、同じ区間に来た人が同じ部屋に入る。
 * 部屋名が時刻から決まるので、遅れて来た人は自動的に次のレースの部屋へ回り、
 * 走っているレースに紛れ込まない。締切も全員が同じ計算で出せる。
 */
export function openRoom(now = Date.now()): { code: string; deadline: number } {
  const sec = now / 1000;
  let bucket = Math.floor(sec / OPEN_PERIOD);
  let deadline = (bucket + 1) * OPEN_PERIOD;
  if (deadline - sec < OPEN_MIN_WAIT) { bucket += 1; deadline += OPEN_PERIOD; }
  return { code: `OPEN${bucket}`, deadline: deadline * 1000 };
}

/** create=合言葉で部屋を作った / join=合言葉で参加した / open=公開ロビー */
export type RoomKind = 'create' | 'join' | 'open';

export class NetSession {
  readonly code: string;
  readonly selfId = selfId;
  private room: Room;
  private handlers: NetHandlers;
  private myName: string;

  /** 部屋にいる人の名前 (自分を含む) */
  names: Record<string, string> = {};
  /** 部屋を作った人 (ホストはここから決める) */
  private creators: Record<string, boolean> = {};
  private joinedAt = Date.now();
  private kind: RoomKind;
  /** ホストが決めた座席順。ロビー受信まで空 */
  order: string[] = [];
  seed = 20240803;
  started = false;

  // trystero 0.25 の makeAction は { send, onMessage } を返す
  private hi: MessageAction<JsonValue>;
  private lobby: MessageAction<JsonValue>;
  private go: MessageAction<JsonValue>;
  private pose: MessageAction<JsonValue>;
  private ev: MessageAction<JsonValue>;

  constructor(code: string, name: string, kind: RoomKind, handlers: NetHandlers) {
    this.code = code;
    this.myName = name;
    this.handlers = handlers;
    this.names[selfId] = name;
    this.kind = kind;
    this.creators[selfId] = kind === 'create';
    this.room = joinRoom({ appId: APP_ID }, `hk-${code}`);

    this.hi = this.room.makeAction<JsonValue>('hi', {
      onMessage: (d, ctx) => {
        const msg = d as { name?: string; creator?: boolean };
        this.names[ctx.peerId] = String(msg?.name ?? '???').slice(0, 10);
        this.creators[ctx.peerId] = !!msg?.creator;
        handlers.onPeers();
        // 座席順を決めて配るのはホストだけ
        if (this.isHost) this.publishLobby();
      },
    });
    this.lobby = this.room.makeAction<JsonValue>('lobby', {
      onMessage: d => {
        const info = d as unknown as LobbyInfo;
        if (!info || !Array.isArray(info.order)) return;
        this.order = info.order;
        this.names = { ...this.names, ...info.names };
        this.seed = info.seed;
        handlers.onLobby(info);
      },
    });
    this.go = this.room.makeAction<JsonValue>('go', {
      onMessage: () => { if (!this.started) { this.started = true; handlers.onStart(); } },
    });
    this.pose = this.room.makeAction<JsonValue>('pose', {
      onMessage: d => {
        if (!Array.isArray(d)) return;
        const a = d as number[];
        const out: Pose[] = [];
        for (let i = 0; i + POSE_LEN <= a.length; i += POSE_LEN) out.push(unpackPose(a, i));
        if (out.length) handlers.onPose(out);
      },
    });
    this.ev = this.room.makeAction<JsonValue>('ev', {
      onMessage: d => {
        const e = d as unknown as NetEvent;
        if (e && typeof e.t === 'string') handlers.onEvent(e);
      },
    });

    this.room.onPeerJoin = peer => {
      // 新しく来た人へ自分の名前を渡す。名簿はホストがまとめて配る。
      void this.hi.send({ name: this.myName, creator: !!this.creators[selfId] }, { target: peer });
      handlers.onPeers();
      if (this.isHost) this.publishLobby();
    };
    this.room.onPeerLeave = () => {
      handlers.onPeers();
      // ホストが抜けたら ID 順で次の人がホストになる
      if (this.isHost) this.publishLobby();
    };
    // 既にいる人へ挨拶
    void this.hi.send({ name: this.myName, creator: !!this.creators[selfId] });
  }

  /** 部屋にいる全員の ID (自分を含む, 昇順) */
  peerIds(): string[] {
    return [selfId, ...Object.keys(this.room.getPeers())].sort();
  }

  /**
   * ホスト = 部屋を作った人。抜けたら残った中で ID が最小の人へ自動的に移る。
   * ID 順だけで決めると「部屋を作ったのに開始ボタンを押せない」ことになる。
   *
   * 参加した直後は、まだ相手の挨拶が届いておらず作成者が誰か分からない。
   * そのまま ID 順で決めると、参加した側が一瞬ホストだと思い込んで座席表を
   * 配ってしまい、席が入れ替わる。作成者でない場合は少し待つ。
   */
  get host(): string {
    const here = this.peerIds();
    const made = here.filter(id => this.creators[id]);
    if (made.length) return made[0];
    // 公開ロビーには作成者がいないので待つ意味がない
    if (this.kind === 'join' && Date.now() - this.joinedAt < HOST_GRACE_MS) return '';
    return here[0];
  }

  get isHost(): boolean {
    return this.host === selfId;
  }

  /** 自分のカートの枠。まだ席が決まっていなければ -1 */
  get mySlot(): number {
    return this.order.indexOf(selfId);
  }

  /** ホストが座席順を決めて配る。既に決まっている席は動かさない (レース中の入れ替え防止) */
  publishLobby(): void {
    // レース中は席を配り直さない。途中で誰か抜けたときに枠がずれると、
    // 走っているカートの持ち主が入れ替わってしまう。
    if (!this.isHost || this.started) return;
    const here = new Set(this.peerIds());
    const order = this.order.filter(id => here.has(id));
    // ホストは必ず先頭。名前がまだ届いていない人は席に着けない
    // (?????? のまま配ると、相手の画面で自分の名前が上書きされてしまう)
    if (!order.includes(selfId)) order.unshift(selfId);
    for (const id of this.peerIds()) if (!order.includes(id) && this.names[id]) order.push(id);
    this.order = order.slice(0, 8);
    const names: Record<string, string> = {};
    for (const id of this.order) names[id] = this.names[id] ?? '???';
    this.names = { ...this.names, ...names };
    const info: LobbyInfo = { order: this.order, names, seed: this.seed };
    void this.lobby.send(info as unknown as JsonValue);
    this.handlers.onLobby(info);
  }

  startRace(): void {
    if (!this.isHost || this.started) return;
    this.started = true;
    void this.go.send({});
    this.handlers.onStart();
  }

  /**
   * ホストからの合図を待たずに自分だけ始める。
   * 締切を過ぎても go が届かないとき (ホストが落ちた・回線が詰まった) の保険。
   */
  startLocally(): void {
    if (this.started) return;
    this.started = true;
    this.handlers.onStart();
  }

  /** 自分が持っているカートの位置をまとめて送る */
  sendPoses(poses: Pose[]): void {
    if (!poses.length) return;
    const a: number[] = [];
    for (const p of poses) a.push(...packPose(p));
    void this.pose.send(a);
  }

  emit(ev: NetEvent): void {
    void this.ev.send(ev as unknown as JsonValue);
  }

  leave(): void {
    void this.room.leave().catch(() => { /* 切断済み */ });
  }
}

// ---- トップ画面の「対戦待ち」表示 (presence) ----
//
// 対戦PLAY を押す前から、レースの部屋とは別の常設の部屋 (hk-presence) に全員が入り、
// 「トップ画面にいる / 対戦待ち / レース中」を伝え合う。トップ画面はこれを見て
// 「いま 2 人が対戦待ち (発走まで 18 秒)」のように出す。
//
// trystero 0.25 は同じ appId なら部屋をまたいで WebRTC 接続を共有する
// (@trystero-p2p/core の SharedPeerManager)。ここでつながった相手とは、
// 対戦PLAY を押した瞬間にリレーの往復なしで同じ部屋に入れるので、
// 相手とつながるまでの 8〜19 秒をページの読み込み中に済ませておく意味もある。

export type PresenceState = 'title' | 'wait' | 'race';

export interface PresenceInfo {
  s: PresenceState;
  /** 対戦待ちのときだけ: 名前・部屋・締切 (ミリ秒) */
  name?: string;
  room?: string;
  deadline?: number;
}

/** 対戦待ちの人がいる部屋 */
export interface WaitingRoom { code: string; deadline: number; names: string[] }

export interface PresenceSummary {
  /** 自分以外でつながっている人数 (0 ならまだ誰ともつながっていないか、本当に誰もいない) */
  others: number;
  title: number;
  racing: number;
  /** 締切の早い順 */
  waiting: WaitingRoom[];
}

/**
 * 対戦待ちの部屋へ途中から入るのに要る最低の残り秒数。
 * 接続は presence で共有済みなので、残るのは席の受け渡し (数百ミリ秒) だけ。
 * OPEN_MIN_WAIT (12 秒) は接続に時間がかかる前提の値で、ここには当てはまらない。
 */
export const JOIN_MIN_WAIT = 3;

export class Presence {
  private room: Room;
  private peers: Record<string, PresenceInfo> = {};
  private me: PresenceInfo = { s: 'title' };
  private st: MessageAction<JsonValue>;
  /** 誰かの状態が変わった (表示の更新用) */
  onChange: (() => void) | null = null;

  constructor() {
    this.room = joinRoom({ appId: APP_ID }, 'hk-presence');
    this.st = this.room.makeAction<JsonValue>('st', {
      onMessage: (d, ctx) => {
        const m = d as { s?: string; name?: string; room?: string; deadline?: number } | null;
        const s: PresenceState = m?.s === 'wait' || m?.s === 'race' ? m.s : 'title';
        this.peers[ctx.peerId] = s === 'wait'
          ? { s, name: String(m?.name ?? '').slice(0, 10), room: String(m?.room ?? ''), deadline: Number(m?.deadline) || 0 }
          : { s };
        this.onChange?.();
      },
    });
    this.room.onPeerJoin = peer => {
      // 状態が届くまでは「トップ画面にいる」扱い
      this.peers[peer] ??= { s: 'title' };
      void this.st.send(this.me as unknown as JsonValue, { target: peer });
      this.onChange?.();
    };
    this.room.onPeerLeave = peer => { delete this.peers[peer]; this.onChange?.(); };
  }

  /** 自分の状態を全員へ知らせる */
  set(info: PresenceInfo): void {
    this.me = info;
    void this.st.send(info as unknown as JsonValue);
    this.onChange?.();
  }

  summary(now = Date.now()): PresenceSummary {
    const rooms: Record<string, WaitingRoom> = {};
    let title = 0, racing = 0, others = 0;
    for (const id of Object.keys(this.room.getPeers())) {
      const p = this.peers[id] ?? { s: 'title' };
      others++;
      if (p.s === 'wait' && p.room && p.deadline && p.deadline > now) {
        const r = rooms[p.room] ??= { code: p.room, deadline: p.deadline, names: [] };
        r.names.push(p.name || '???');
      } else if (p.s === 'wait' || p.s === 'race') {
        racing++;   // 締切を過ぎた「対戦待ち」は走り出している
      } else {
        title++;
      }
    }
    const waiting = Object.values(rooms).sort((a, b) => a.deadline - b.deadline);
    return { others, title, racing, waiting };
  }

  /** いま押せば間に合う対戦待ちの部屋 (締切が JOIN_MIN_WAIT 秒以上先のうち最も早いもの) */
  joinable(now = Date.now()): WaitingRoom | null {
    return this.summary(now).waiting.find(r => r.deadline - now >= JOIN_MIN_WAIT * 1000) ?? null;
  }

  leave(): void {
    void this.room.leave().catch(() => { /* 切断済み */ });
  }
}
