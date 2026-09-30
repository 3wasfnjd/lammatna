// Client side of a room: sends inputs, predicts the local player with the same
// Sim code the server runs (mirror mode), reconciles with server snapshots, and
// interpolates everyone else.
import { Sim, PREDICTED_MODES, type InputFrame, type PlayerSim } from '../../../shared/sim';
import { worldDef } from '../../../shared/worldData';
import { SIM_DT, INTERP_DELAY_MS } from '../../../shared/constants';
import type { Transport } from './transport';
import type { ServerMsg, Snapshot, PlayerInfo, Look, GameView } from '../../../shared/protocol';
import type { V3 } from '../../../shared/math';

interface Timed { at: number; snap: Snapshot }
export interface RemoteView { id: string; pos: V3; yaw: number; mode: string; vel: V3; grounded: boolean; toy: string; carry: string; follow: string }

export class NetClient {
  t: Transport;
  sim: Sim;               // mirror world: prediction, camera collision, interaction hints
  myId = '';
  code = '';
  solo = false;
  players: PlayerInfo[] = [];
  buffer: Timed[] = [];
  latest: Snapshot | null = null;
  games: GameView[] = [];
  seq = 0;
  pending: InputFrame[] = [];
  history = new Map<number, V3>();   // predicted position after each input seq
  visualOffset: V3 = [0, 0, 0];
  clockOffset = 0;                   // server sim time − local seconds
  onEvent: (e: any) => void = () => { };
  onInfo: () => void = () => { };
  onClosed: (reason: string) => void = () => { };
  private sendAcc = 0;
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  error: string | null = null;

  constructor(t: Transport, sim?: Sim) {
    this.t = t;
    this.solo = t.solo;
    this.sim = sim || new Sim(worldDef(), 'mirror');
    this.ready = new Promise((r, j) => { this.resolveReady = r; this.rejectReady = j; });
    t.onMessage = m => this.handle(m);
    t.onClose = r => { this.rejectReady(new Error(this.error || 'offline')); this.onClosed(r); };
  }
  join(look: Look) {
    this.t.send({ t: 'hello', look });
    const timeout = new Promise<void>((_, rej) => setTimeout(() => rej(new Error(this.error || 'offline')), 12000));
    return Promise.race([this.ready, timeout]).catch(e => { this.t.close(); throw e; });
  }
  get me(): PlayerSim | undefined { return this.sim.players.get(this.myId); }
  now() { return performance.now() / 1000; }

  handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id; this.code = m.code; this.solo = m.solo; this.players = m.players;
        this.applySnapshot(m.snap, true);
        this.resolveReady(); this.onInfo();
        break;
      case 'info': this.players = m.players; this.onInfo(); break;
      case 's': this.applySnapshot(m.snap, false); break;
      case 'err': this.error = m.code; this.rejectReady(new Error(m.code)); this.onClosed(m.code); break;
    }
  }

  applySnapshot(s: Snapshot, first: boolean) {
    const at = this.now();
    const off = s.time - at;
    this.clockOffset = first || !this.buffer.length ? off : this.clockOffset + (Math.max(off, this.clockOffset - 0.25) - this.clockOffset) * 0.1;
    this.buffer.push({ at, snap: s });
    while (this.buffer.length > 30) this.buffer.shift();
    this.latest = s;
    this.games = s.g;
    for (const e of s.ev) this.onEvent(e);
    // Players present / gone.
    const ids = new Set(s.pl.map((p: any) => p.id));
    for (const id of [...this.sim.players.keys()]) if (!ids.has(id)) this.sim.removePlayer(id);
    for (const ps of s.pl) if (!this.sim.players.has(ps.id)) this.sim.addPlayer(ps.id, ps.p, ps.yaw);
    // Props: keep a complete picture (snapshots only carry awake bodies).
    this.sim.applyPropStates(s.pr);
    this.sim.applyToyStates(s.ty);
    this.reconcile(s, first);
  }

  reconcile(s: Snapshot, first: boolean) {
    const mine = s.pl.find((p: any) => p.id === this.myId);
    const me = this.me;
    if (!mine || !me) return;
    this.pending = this.pending.filter(f => f.seq > mine.seq);
    const predicted = PREDICTED_MODES.includes(mine.mode);
    if (!predicted || first) {
      // Server-driven (seat, slide, claw…): follow the server; smoothing hides the jump.
      const before: V3 = [...me.pos] as V3;
      this.sim.applyPlayerState(me, mine);
      if (!first) this.addOffset(before, me.pos);
      this.history.clear();
      return;
    }
    const guess = this.history.get(mine.seq);
    const err = guess ? Math.hypot(guess[0] - mine.p[0], guess[1] - mine.p[1], guess[2] - mine.p[2]) : Infinity;
    for (const k of [...this.history.keys()]) if (k <= mine.seq) this.history.delete(k);
    if (err < 0.04 && PREDICTED_MODES.includes(me.mode)) return;
    // Rewind to the server state and replay the inputs it has not seen yet.
    const before: V3 = [...me.pos] as V3;
    this.sim.applyPlayerState(me, mine);
    this.sim.world.step();
    for (const f of this.pending) { this.sim.step(new Map([[this.myId, f]]), this.myId); this.history.set(f.seq, [...me.pos] as V3); }
    this.addOffset(before, me.pos);
  }
  addOffset(before: V3, after: V3) {
    const d: V3 = [before[0] - after[0], before[1] - after[1], before[2] - after[2]];
    if (Math.hypot(...d) > 4) { this.visualOffset = [0, 0, 0]; return; }   // teleports snap
    this.visualOffset = [this.visualOffset[0] + d[0], this.visualOffset[1] + d[1], this.visualOffset[2] + d[2]];
  }

  // One fixed 60 Hz client step with the local input.
  step(mx: number, mz: number, buttons: number) {
    const f: InputFrame = { seq: ++this.seq, mx, mz, b: buttons };
    this.pending.push(f);
    if (this.pending.length > 120) this.pending.shift();
    this.placeOthers();
    const me = this.me;
    if (me && PREDICTED_MODES.includes(me.mode)) {
      this.sim.step(new Map([[this.myId, f]]), this.myId);
      this.history.set(f.seq, [...me.pos] as V3);
    } else {
      me && (me.prevB = buttons);
      this.sim.world.step();
    }
    const k = Math.exp(-SIM_DT * 10);
    this.visualOffset = this.visualOffset.map(v => v * k) as V3;
    this.sendAcc += SIM_DT;
    if (this.sendAcc >= 0.05 || (buttons & 2)) {
      this.sendAcc = 0;
      this.t.send({ t: 'in', f: this.pending.slice(-8).map(p => [p.seq, round(p.mx), round(p.mz), p.b] as [number, number, number, number]) });
    }
  }
  // Put the other players' capsules, the toys and the props where they are
  // drawn, so prediction collides with them and interaction hints are right.
  placeOthers() {
    this.sim.applyToyStates(this.toyStates());
    const flat: number[] = [];
    for (const [i, v] of this.propViews()) flat.push(i, ...v);
    this.sim.applyPropStates(flat);
    for (const v of this.remoteViews()) {
      if (v.id === this.myId) continue;
      const p = this.sim.players.get(v.id);
      if (!p) continue;
      p.pos = v.pos; p.yaw = v.yaw; p.mode = v.mode as any;
      this.sim.placeKinematic(p);
    }
  }

  // Interpolated view of every player except the local one (which is predicted).
  renderTime() { return this.now() + this.clockOffset - INTERP_DELAY_MS / 1000; }
  pair(): [Timed, Timed, number] | null {
    const b = this.buffer;
    if (!b.length) return null;
    const t = this.renderTime();
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (a.snap.time <= t) {
        const f = c.snap.time > a.snap.time ? Math.min(1.2, (t - a.snap.time) / (c.snap.time - a.snap.time)) : 1;
        return [a, c, f];
      }
    }
    return [b[0], b[0], 0];
  }
  remoteViews(): RemoteView[] {
    const pr = this.pair();
    if (!pr) return [];
    const [a, c, f] = pr;
    return c.snap.pl.map((pc: any) => {
      const pa = a.snap.pl.find((x: any) => x.id === pc.id) || pc;
      const lerp = (x: number, y: number) => x + (y - x) * f;
      let dy = pc.yaw - pa.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      return {
        id: pc.id, pos: [lerp(pa.p[0], pc.p[0]), lerp(pa.p[1], pc.p[1]), lerp(pa.p[2], pc.p[2])] as V3, yaw: pa.yaw + dy * f,
        mode: f < 0.5 ? pa.mode : pc.mode, vel: pc.v, grounded: !!pc.g, toy: pc.toy, carry: pc.carry, follow: pc.follow
      };
    });
  }
  // Interpolated props: index → [x,y,z,qx,qy,qz,qw]; missing ones are asleep (keep last pose).
  propViews(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    const pr = this.pair();
    if (!pr) return out;
    const [a, c, f] = pr;
    const idxA = new Map<number, number>();
    for (let i = 0; i < a.snap.pr.length; i += 8) idxA.set(a.snap.pr[i], i);
    const C = c.snap.pr, A = a.snap.pr;
    for (let i = 0; i < C.length; i += 8) {
      const j = idxA.get(C[i]);
      const v = C.slice(i + 1, i + 8);
      if (j != null) {
        const u = A.slice(j + 1, j + 8);
        let dot = 0; for (let k = 3; k < 7; k++) dot += u[k] * v[k];
        const s = dot < 0 ? -1 : 1;
        for (let k = 0; k < 7; k++) v[k] = u[k] + ((k >= 3 ? v[k] * s : v[k]) - u[k]) * f;
        const n = Math.hypot(v[3], v[4], v[5], v[6]) || 1; for (let k = 3; k < 7; k++) v[k] /= n;
      }
      out.set(C[i], v);
    }
    return out;
  }
  toyStates(): Record<string, number[]> {
    const pr = this.pair();
    if (!pr) return {};
    const [a, c, f] = pr;
    const out: Record<string, number[]> = {};
    for (const id in c.snap.ty) {
      const cv = c.snap.ty[id], av = a.snap.ty[id];
      // Angles interpolate; discrete values (scores, masks, grids) snap.
      out[id] = av && av.length === cv.length && cv.length <= 8 ? cv.map((v, i) => Math.abs(v - av[i]) < 3 ? av[i] + (v - av[i]) * f : v) : cv;
    }
    return out;
  }
  sendEmoji(e: number) { this.t.send({ t: 'emoji', e }); }
  sendChallenge(toy: string, ok: boolean) { this.t.send({ t: 'ch', toy, ok }); }
  close() { this.t.close(); }
}
const round = (v: number) => Math.round(v * 1000) / 1000;
