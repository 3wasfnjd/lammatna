// Minigames are server-run plugins. Each one has a spot in the world; when
// enough players stand in it, a countdown shows above the spot and the game
// starts — no menus. The same code runs in the Durable Object and in solo play.
import type { Sim, PlayerSim } from './sim';
import type { GameSpot } from './world';
import type { GameView } from './protocol';
import { AreaToy } from './toys';
import type { V3 } from './math';
import { rng, dist2 } from './math';
import { MAX_PLAYERS } from './constants';

export const COUNTDOWN = 3;
export const RESULT_TIME = 4;
export const COOLDOWN = 3;

export interface GameCtx {
  sim: Sim;
  spot: GameSpot;
  players: string[];
  time: number;               // seconds since start
  rand: () => number;
  scores: Record<string, number>;
  s: any;                     // plugin state
  ended: boolean;
  winners: string[];
  emit(e: any): void;
  area(id?: string): AreaToy | undefined;
  player(id: string): PlayerSim | undefined;
}

export interface GamePlugin {
  id: string;
  icon: string;
  duration: number;
  minPlayers(solo: boolean): number;
  start(c: GameCtx): void;
  tick(c: GameCtx, dt: number): void;
  interact?(c: GameCtx, p: PlayerSim): boolean;
  finish(c: GameCtx): void;   // decide winners (called at time out or when ended)
  view?(c: GameCtx): any;
  spot?(c: GameCtx | null, sim: Sim, spot: GameSpot): [number, number];
}

const best = (c: GameCtx) => {
  const top = Math.max(0, ...c.players.map(p => c.scores[p] || 0));
  c.winners = top > 0 ? c.players.filter(p => (c.scores[p] || 0) === top) : [];
};
const inCircle = (p: PlayerSim, spot: [number, number], r: number) => dist2(p.pos, { x: spot[0], z: spot[1] }) < r;

// ---------------------------------------------------------------- playground race
const race: GamePlugin = {
  id: 'race', icon: '🏁', duration: 120,
  minPlayers: solo => solo ? 1 : 2,
  start(c) { c.s.next = Object.fromEntries(c.players.map(p => [p, 0])); c.s.done = []; },
  tick(c) {
    const cps: [number, number][] = [...c.spot.checkpoints, c.spot.spot];
    for (const id of c.players) {
      const p = c.player(id); if (!p || c.s.done.includes(id)) continue;
      const k = c.s.next[id], cp = cps[k];
      if (dist2(p.pos, { x: cp[0], z: cp[1] }) < (k === cps.length - 1 ? c.spot.radius + 0.5 : 3)) {
        c.s.next[id] = k + 1;
        c.emit({ type: 'checkpoint', p: id, n: k + 1 });
        if (k + 1 === cps.length) { c.s.done.push(id); c.scores[id] = MAX_PLAYERS + 1 - c.s.done.length; c.emit({ type: 'finish', p: id, rank: c.s.done.length }); }
      }
    }
    if (c.s.done.length === c.players.length) c.ended = true;
  },
  finish(c) { c.winners = c.s.done.slice(0, 1); },
  view: c => ({ next: c.s.next, cps: c.spot.checkpoints })
};

// ---------------------------------------------------------------- ball rescue
const rescue: GamePlugin = {
  id: 'rescue', icon: '🧺', duration: 90,
  minPlayers: solo => solo ? 1 : 2,
  start(c) {
    c.s.balls = c.sim.props.filter(p => p.def.tag === 'rescue').map(p => p.index);
    c.s.saved = [];
    for (const i of c.s.balls) c.sim.resetProp(c.sim.props[i]);
  },
  tick(c) {
    for (const i of c.s.balls) {
      if (c.s.saved.includes(i)) continue;
      const pr = c.sim.props[i], t = pr.body.translation();
      if (Math.hypot(t.x - c.spot.spot[0], t.z - c.spot.spot[1]) < c.spot.radius && !pr.carriedBy) {
        c.s.saved.push(i);
        const who = c.players.includes(pr.lastToucher) ? pr.lastToucher : c.players[0];
        c.scores[who] = (c.scores[who] || 0) + 1;
        c.emit({ type: 'rescued', p: who, prop: pr.def.id });
      }
    }
    if (c.s.saved.length === c.s.balls.length) c.ended = true;
  },
  finish(c) { best(c); },
  view: c => ({ saved: c.s.saved.length, total: c.s.balls.length })
};

// ---------------------------------------------------------------- colour floor
const COLORS = 4;
const colorFloor: GamePlugin = {
  id: 'colorFloor', icon: '🟦', duration: 75,
  minPlayers: solo => solo ? 1 : 2,
  start(c) {
    c.s.alive = [...c.players]; c.s.round = 0; c.s.phase = 'show'; c.s.t = 0;
    for (const id of c.players) c.scores[id] = 0;
    newRound(c);
  },
  tick(c, dt) {
    const area = c.area()!;
    c.s.t -= dt;
    if (c.s.t > 0) return;
    if (c.s.phase === 'show') {
      // Time's up: anyone not on the called colour is out.
      c.s.phase = 'check';
      for (const id of [...c.s.alive]) {
        const p = c.player(id);
        const cell = p ? area.cell(p.pos) : -1;
        if (!p || cell < 0 || area.grid[cell] !== c.s.target) {
          c.s.alive = c.s.alive.filter((a: string) => a !== id);
          c.emit({ type: 'out', p: id });
          if (p) {
            const edge = area.w([area.def.b[3] + 1.2, 0, 0]);
            c.sim.teleport(p, [edge[0], 0.05, p.pos[2]]);
          }
        } else c.scores[id] += 1;
      }
      c.s.t = 1.2;
      const needed = c.players.length > 1 ? 1 : 0;
      if (c.s.alive.length <= needed || c.s.round >= 6) c.ended = true;
    } else newRound(c);
  },
  finish(c) { c.winners = c.s.alive.length ? [...c.s.alive] : []; if (!c.winners.length) best(c); },
  view: c => ({ target: c.s.target, round: c.s.round, alive: c.s.alive, phase: c.s.phase, left: Math.max(0, c.s.t) })
};
function newRound(c: GameCtx) {
  const area = c.area()!, n = (area.def.p.cells || 6) ** 2;
  c.s.round++; c.s.phase = 'show'; c.s.t = Math.max(2.2, 4.5 - c.s.round * 0.35);
  c.s.target = Math.floor(c.rand() * COLORS);
  area.grid = Array.from({ length: n }, () => Math.floor(c.rand() * COLORS));
  // Make sure the called colour is common enough to find.
  for (let i = 0; i < n; i += 3) area.grid[i] = c.s.target;
  c.emit({ type: 'color', n: c.s.target });
}

// ---------------------------------------------------------------- hide and seek
const hideSeek: GamePlugin = {
  id: 'hideSeek', icon: '🙈', duration: 80,
  minPlayers: () => 2,
  start(c) {
    c.s.seeker = c.players[Math.floor(c.rand() * c.players.length)];
    c.s.found = []; c.s.phase = 'hide';
    const s = c.player(c.s.seeker);
    if (s) { c.sim.release(s); s.mode = 'frozen'; }
    c.emit({ type: 'seeker', p: c.s.seeker });
  },
  tick(c) {
    if (c.s.phase === 'hide' && c.time >= 15) {
      c.s.phase = 'seek';
      const s = c.player(c.s.seeker); if (s && s.mode === 'frozen') s.mode = 'walk';
      c.emit({ type: 'whistle' });
    }
    if (c.s.phase !== 'seek') return;
    const s = c.player(c.s.seeker); if (!s) { c.ended = true; return; }
    for (const id of c.players) {
      if (id === c.s.seeker || c.s.found.includes(id)) continue;
      const h = c.player(id);
      if (h && Math.hypot(h.pos[0] - s.pos[0], h.pos[2] - s.pos[2]) < 1.6 && Math.abs(h.pos[1] - s.pos[1]) < 2) found(c, id);
    }
    if (c.s.found.length >= c.players.length - 1) c.ended = true;
  },
  interact(c, p) {
    if (p.id !== c.s.seeker || c.s.phase !== 'seek') return false;
    for (const id of c.players) {
      const h = c.player(id);
      if (id !== p.id && h && !c.s.found.includes(id) && Math.hypot(h.pos[0] - p.pos[0], h.pos[2] - p.pos[2]) < 3) { found(c, id); return true; }
    }
    return false;
  },
  finish(c) {
    const hiders = c.players.filter(p => p !== c.s.seeker);
    const left = hiders.filter(p => !c.s.found.includes(p));
    c.winners = left.length ? left : [c.s.seeker];
    for (const w of c.winners) c.scores[w] = (c.scores[w] || 0) + 1;
    const s = c.player(c.s.seeker); if (s && s.mode === 'frozen') s.mode = 'walk';
  },
  view: c => ({ seeker: c.s.seeker, found: c.s.found, phase: c.s.phase })
};
function found(c: GameCtx, id: string) {
  c.s.found.push(id);
  c.scores[c.s.seeker] = (c.scores[c.s.seeker] || 0) + 1;
  c.emit({ type: 'found', p: id, by: c.s.seeker });
}

// ---------------------------------------------------------------- giant ball
const giantBall: GamePlugin = {
  id: 'giantBall', icon: '⚽', duration: 90,
  minPlayers: solo => solo ? 1 : 2,
  spot(_c, sim, spot) {
    const pr = sim.propById.get(spot.ball);
    if (!pr) return spot.spot;
    const t = pr.body.translation();
    return [t.x, t.z];
  },
  start(c) {
    c.s.team = Object.fromEntries(c.players.map((p, i) => [p, i % 2]));
    c.s.goals = [0, 0];
    const pr = c.sim.propById.get(c.spot.ball)!;
    c.sim.resetProp(pr);
  },
  tick(c) {
    const pr = c.sim.propById.get(c.spot.ball)!;
    const t = pr.body.translation();
    c.spot.goals.forEach((gid: string, gi: number) => {
      const g = c.sim.toyById.get(gid) as AreaToy | undefined;
      if (!g || !g.inside([t.x, t.y, t.z], 0.2)) return;
      const team = 1 - gi;          // team 0 scores in the east goal, team 1 in the west goal
      c.s.goals[team]++;
      for (const p of c.players) if (c.s.team[p] === team) c.scores[p] = (c.scores[p] || 0) + 1;
      c.emit({ type: 'goal', team, score: [...c.s.goals] });
      c.sim.resetProp(pr);
      if (c.s.goals[team] >= 3) c.ended = true;
    });
  },
  finish(c) {
    const [a, b] = c.s.goals;
    const team = a === b ? -1 : a > b ? 0 : 1;
    c.winners = team < 0 ? [] : c.players.filter(p => c.s.team[p] === team);
  },
  view: c => ({ team: c.s.team, goals: c.s.goals })
};

// ---------------------------------------------------------------- paint war
const paint: GamePlugin = {
  id: 'paint', icon: '🎨', duration: 60,
  minPlayers: solo => solo ? 1 : 2,
  start(c) {
    const area = c.area()!;
    area.grid = new Array((area.def.p.cells || 10) ** 2).fill(-1);
    c.s.color = Object.fromEntries(c.players.map((p, i) => [p, i]));
    c.s.cool = {};
  },
  tick(c) {
    const area = c.area()!;
    for (const id of c.players) {
      const p = c.player(id); if (!p) continue;
      const k = area.cell(p.pos);
      if (k >= 0) area.grid[k] = c.s.color[id];
    }
    count(c);
  },
  interact(c, p) {
    if (!(p.id in c.s.color)) return false;
    if ((c.s.cool[p.id] || 0) > c.time) return true;
    c.s.cool[p.id] = c.time + 0.5;
    const area = c.area()!, f = c.sim.forwardOf(p.yaw);
    const at: V3 = [p.pos[0] + f[0] * 4, 0, p.pos[2] + f[2] * 4];
    const n = area.def.p.cells || 10;
    const k = area.cell(at);
    if (k >= 0) {
      const i = k % n, j = Math.floor(k / n);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < n && jj < n) area.grid[jj * n + ii] = c.s.color[p.id];
      }
    }
    c.emit({ type: 'paint', p: p.id, x: at[0], z: at[2], c: c.s.color[p.id] });
    count(c);
    return true;
  },
  finish(c) { count(c); best(c); },
  view: c => ({ color: c.s.color })
};
function count(c: GameCtx) {
  const grid = c.area()!.grid;
  for (const id of c.players) c.scores[id] = grid.filter(v => v === c.s.color[id]).length;
}

export const GAMES: Record<string, GamePlugin> = { race, rescue, colorFloor, hideSeek, giantBall, paint };

// ---------------------------------------------------------------- manager
interface SpotState { spot: GameSpot; plugin: GamePlugin; phase: GameView['phase']; t: number; ctx: GameCtx | null; lastScores: Record<string, number>; lastPlayers: string[] }

export class GameManager {
  sim: Sim; solo: () => boolean; spots: SpotState[]; seed = 1;
  onEnd: ((game: string, winners: string[], scores: Record<string, number>) => void) | null = null;
  constructor(sim: Sim, spots: GameSpot[], solo: () => boolean) {
    this.sim = sim; this.solo = solo;
    this.spots = spots.map(spot => ({ spot, plugin: GAMES[spot.id], phase: 'idle', t: 0, ctx: null, lastScores: {}, lastPlayers: [] }));
    for (const s of this.spots) if (!s.plugin) throw new Error('No minigame plugin ' + s.spot.id);
    sim.interactHook = p => {
      for (const s of this.spots) if (s.phase === 'running' && s.ctx!.players.includes(p.id) && s.plugin.interact?.(s.ctx!, p)) return true;
      return false;
    };
  }
  spotPos(s: SpotState): [number, number] { return s.plugin.spot ? s.plugin.spot(s.ctx, this.sim, s.spot) : s.spot.spot; }
  busy(id: string) { return this.spots.some(s => (s.phase === 'running' || s.phase === 'countdown') && s.ctx?.players.includes(id)); }
  playersIn(s: SpotState) {
    const at = this.spotPos(s);
    return [...this.sim.players.values()].filter(p => inCircle(p, at, s.spot.radius) && !this.busy(p.id)).map(p => p.id);
  }
  need(s: SpotState) { return s.plugin.minPlayers(this.solo()); }
  running() { return this.spots.find(s => s.phase === 'running'); }

  tick(dt: number) {
    for (const s of this.spots) {
      switch (s.phase) {
        case 'idle': {
          if (this.running()) break;
          const ins = this.playersIn(s);
          if (ins.length >= this.need(s)) { s.phase = 'countdown'; s.t = COUNTDOWN; this.sim.emit({ type: 'countdown', game: s.spot.id }); }
          break;
        }
        case 'countdown': {
          const ins = this.playersIn(s);
          if (ins.length < this.need(s) || this.running()) { s.phase = 'idle'; break; }
          s.t -= dt;
          if (s.t <= 0) this.start(s, ins);
          break;
        }
        case 'running': {
          const c = s.ctx!;
          c.players = c.players.filter(id => this.sim.players.has(id));
          c.time += dt; s.t = s.plugin.duration - c.time;
          s.plugin.tick(c, dt);
          if (c.ended || s.t <= 0 || !c.players.length) this.end(s);
          break;
        }
        case 'result': case 'cooldown' as any: {
          s.t -= dt;
          if (s.t <= 0) { s.phase = 'idle'; s.ctx = null; }
          break;
        }
      }
    }
  }
  start(s: SpotState, players: string[]) {
    const sim = this.sim;
    const ctx: GameCtx = {
      sim, spot: s.spot, players, time: 0, rand: rng(this.seed++ * 7919 + sim.tick), scores: Object.fromEntries(players.map(p => [p, 0])),
      s: {}, ended: false, winners: [],
      emit: e => sim.emit({ ...e, game: s.spot.id }),
      area: (id?: string) => sim.toyById.get(id || s.spot.area) as AreaToy | undefined,
      player: id => sim.players.get(id)
    };
    s.ctx = ctx; s.phase = 'running'; s.t = s.plugin.duration;
    s.plugin.start(ctx);
    sim.emit({ type: 'gameStart', game: s.spot.id, players });
  }
  end(s: SpotState) {
    const c = s.ctx!;
    s.plugin.finish(c);
    s.phase = 'result'; s.t = RESULT_TIME;
    s.lastScores = { ...c.scores }; s.lastPlayers = [...c.players];
    const area = c.area();
    if (area && s.spot.id !== 'paint') area.grid = [];
    this.sim.emit({ type: 'gameEnd', game: s.spot.id, winners: c.winners, scores: c.scores });
    this.onEnd?.(s.spot.id, c.winners, c.scores);
  }
  // Test/admin helper: end a running game now.
  forceEnd(id: string) { const s = this.spots.find(x => x.spot.id === id && x.phase === 'running'); if (s) this.end(s); }
  views(): GameView[] {
    return this.spots.map(s => {
      const pos = this.spotPos(s);
      const round = (v: number) => Math.round(v * 100) / 100;
      return {
        id: s.spot.id, phase: s.phase, t: round(Math.max(0, s.t)), spot: [round(pos[0]), round(pos[1])],
        inSpot: s.phase === 'idle' || s.phase === 'countdown' ? this.playersIn(s).length : 0, need: this.need(s),
        players: s.ctx?.players || s.lastPlayers, scores: s.ctx?.scores || s.lastScores,
        x: s.ctx ? { ...(s.plugin.view ? s.plugin.view(s.ctx) : {}), winners: s.phase === 'result' ? s.ctx.winners : undefined } : undefined
      };
    });
  }
}
