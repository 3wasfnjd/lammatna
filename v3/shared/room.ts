// A private room: up to 5 players, one Sim, the minigames, stars and emojis.
// Transport-agnostic: the Durable Object and the in-page solo host both feed it
// messages and forward what it sends.
import { Sim, type InputFrame } from './sim';
import { GameManager } from './games';
import { worldDef } from './worldData';
import { MAX_PLAYERS, SIM_DT, STEPS_PER_SNAPSHOT, CHARACTER_IDS, CHARACTERS, OUTFIT_COLORS, ACCESSORIES, EMOJIS, BTN } from './constants';
import type { ClientMsg, ServerMsg, PlayerInfo, Look, Snapshot } from './protocol';
import type { V3 } from './math';

export interface RoomPlayer {
  id: string;
  look: Look;
  stars: number[];
  tickets: number;
  queue: InputFrame[];
  last: InputFrame;
  connected: boolean;
  pendingChallenge: { toy: string; at: number } | null;
}

export class Room {
  code: string;
  solo: boolean;
  sim: Sim;
  games: GameManager;
  players = new Map<string, RoomPlayer>();
  send: (id: string, m: ServerMsg) => void;
  private acc = 0;
  private steps = 0;
  private events: any[] = [];
  private nextId = 1;
  private fullPropsEvery = 40;   // snapshots between full prop dumps

  constructor(code: string, send: (id: string, m: ServerMsg) => void, solo = false) {
    this.code = code; this.send = send; this.solo = solo;
    this.sim = new Sim(worldDef(), 'authority');
    this.games = new GameManager(this.sim, this.sim.def.layout.games, () => this.solo);
  }

  get count() { return this.players.size; }

  join(msg: Extract<ClientMsg, { t: 'hello' }>): { ok: true; id: string } | { ok: false; code: 'full' | 'bad' } {
    if (msg.resume && this.players.has(msg.resume)) {
      const rp = this.players.get(msg.resume)!;
      rp.connected = true;
      return { ok: true, id: rp.id };
    }
    if (this.players.size >= MAX_PLAYERS) return { ok: false, code: 'full' };
    const look = sanitizeLook(msg.look);
    if (!look) return { ok: false, code: 'bad' };
    const id = 'p' + this.nextId++;
    const n = this.players.size;
    const sp = this.sim.def.layout.spawn;
    const pos: V3 = [sp[0] + (n % 3 - 1) * 1.4, sp[1] + 0.05, sp[2] - Math.floor(n / 3) * 1.4];
    this.sim.addPlayer(id, pos, this.sim.def.layout.spawnYaw);
    this.players.set(id, { id, look, stars: [], tickets: 0, queue: [], last: { seq: 0, mx: 0, mz: 0, b: 0 }, connected: true, pendingChallenge: null });
    this.broadcastInfo();
    return { ok: true, id };
  }
  welcome(id: string) {
    this.send(id, { t: 'welcome', id, code: this.code, solo: this.solo, players: this.info(), snap: this.snapshot(true) });
  }
  leave(id: string) {
    if (!this.players.delete(id)) return;
    this.sim.removePlayer(id);
    this.broadcastInfo();
  }
  disconnect(id: string) { const p = this.players.get(id); if (p) p.connected = false; }

  info(): PlayerInfo[] {
    return [...this.players.values()].map(p => ({ id: p.id, look: p.look, stars: p.stars, tickets: p.tickets, color: p.look.color }));
  }
  broadcastInfo() { const players = this.info(); for (const id of this.players.keys()) this.send(id, { t: 'info', players }); }

  message(id: string, m: ClientMsg) {
    const rp = this.players.get(id);
    if (!rp) return;
    switch (m.t) {
      case 'in':
        for (const f of m.f.slice(-30)) {
          const [seq, mx, mz, b] = f;
          if (seq <= (rp.queue.at(-1)?.seq ?? rp.last.seq)) continue;
          rp.queue.push({ seq, mx: clampUnit(mx), mz: clampUnit(mz), b: b & 3 });
        }
        break;
      case 'emoji':
        if (m.e >= 0 && m.e < EMOJIS.length) this.sim.emit({ type: 'emoji', p: id, e: m.e });
        break;
      case 'look': { const l = sanitizeLook(m.look); if (l) { rp.look = l; this.broadcastInfo(); } break; }
      case 'ch':
        if (rp.pendingChallenge && rp.pendingChallenge.toy === m.toy && this.sim.time - rp.pendingChallenge.at < 90) {
          rp.tickets += m.ok ? 3 : 1;
          rp.pendingChallenge = null;
          this.sim.emit({ type: m.ok ? 'win' : 'chime', p: id, toy: m.toy });
          this.broadcastInfo();
        }
        break;
      case 'ping': this.send(id, { t: 'pong', c: m.c, s: Date.now() }); break;
    }
  }

  // Advance real time (ms). Runs fixed 60 Hz steps and sends 20 Hz snapshots.
  update(ms: number) {
    this.acc += Math.min(ms, 250) / 1000;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      this.stepOnce();
    }
  }
  stepOnce() {
    const inputs = new Map<string, InputFrame>();
    for (const rp of this.players.values()) {
      // Consume one input frame per step; catch up if the client is far ahead.
      if (rp.queue.length > 8) rp.queue.splice(0, rp.queue.length - 4);
      const f = rp.queue.shift();
      if (f) { rp.last = f; inputs.set(rp.id, f); }
      else inputs.set(rp.id, { ...rp.last, b: rp.last.b & ~BTN.interact });
      const ps = this.sim.players.get(rp.id);
      if (ps) ps.lastSeq = rp.last.seq;
    }
    this.sim.step(inputs);
    this.games.tick(SIM_DT);
    this.checkStars();
    for (const e of this.sim.drainEvents()) {
      if (e.type === 'challenge') { const rp = this.players.get(e.p); if (rp) rp.pendingChallenge = { toy: e.toy, at: this.sim.time }; }
      if (e.type === 'prize' && e.p) { const rp = this.players.get(e.p); if (rp) { rp.tickets += 2; this.broadcastInfo(); } }
      this.events.push(e);
    }
    if (++this.steps % STEPS_PER_SNAPSHOT === 0) this.broadcastSnapshot();
  }
  checkStars() {
    const stars = this.sim.def.layout.stars;
    for (const rp of this.players.values()) {
      const p = this.sim.players.get(rp.id); if (!p) continue;
      for (let i = 0; i < stars.length; i++) {
        if (rp.stars.includes(i)) continue;
        const s = stars[i];
        if (Math.hypot(s[0] - p.pos[0], s[1] - (p.pos[1] + 0.7), s[2] - p.pos[2]) < 1.2) {
          rp.stars.push(i);
          this.sim.emit({ type: 'star', p: rp.id, i });
          this.broadcastInfo();
        }
      }
    }
  }
  snapshot(full = false): Snapshot {
    const snapNo = Math.floor(this.steps / STEPS_PER_SNAPSHOT);
    const ev = this.events; this.events = [];
    return {
      k: this.sim.tick, time: Math.round(this.sim.time * 1000) / 1000,
      pl: [...this.sim.players.values()].map(p => this.sim.playerState(p)),
      pr: this.sim.propStates(full || snapNo % this.fullPropsEvery === 0),
      ty: this.sim.toyStates(), g: this.games.views(), ev
    };
  }
  broadcastSnapshot() {
    const snap = this.snapshot();
    for (const id of this.players.keys()) this.send(id, { t: 's', snap });
  }
}

const clampUnit = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
export function sanitizeLook(l: any): Look | null {
  if (!l || !CHARACTER_IDS.includes(l.char)) return null;
  return {
    char: l.char,
    color: OUTFIT_COLORS.includes(l.color) ? l.color : CHARACTERS[l.char as keyof typeof CHARACTERS].color,
    acc: ACCESSORIES.includes(l.acc) ? l.acc : 'none',
    name: CHARACTERS[l.char as keyof typeof CHARACTERS].name
  };
}
