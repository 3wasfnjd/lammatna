// Authoritative room: membership, unique characters, shared equipment, balls,
// minigame phases, timers, scores and badges. Runs unchanged in the Node server
// and in the browser (solo play), driven by `handle()` and `tick()`.
import { CHARACTER_IDS, MOVEMENT, isCharacterId, ANIM_CODE } from './characters.js';
import { MAX_PLAYERS, RECONNECT_GRACE_MS, S2C, makeToken } from './protocol.js';
import {
  SWINGS, SLIDE, BASKETS, BALL_COLORS, BALL_SPOTS, BALL_PIT, RACE, raceStartSlot, spawnPoint, celebrationSlot
} from './playground.js';

export const PHASE_MS = { intro: 4500, countdown: 3000, results: 7500, celebrate: 11000 };
export const RESCUE_TIME = 100;
const TOY_COUNT = 12;

export function rescueTarget(playerCount) {
  return Math.min(19, Math.max(7, 4 + playerCount * 3));
}
export function rescueStars(success, secondsLeft) {
  if (!success) return 0;
  return 1 + (secondsLeft >= 25 ? 1 : 0) + (secondsLeft >= 50 ? 1 : 0);
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export class Room {
  constructor(code, { now = () => Date.now(), random = Math.random, send = () => {} } = {}) {
    this.code = code;
    this.now = now;
    this.random = random;
    this.send = send;
    this.players = new Map();
    this.nextId = 1;
    this.hostId = null;
    this.mode = 'free';
    this.assist = false;
    this.equipment = Object.fromEntries([...SWINGS.map(s => s.id), SLIDE.id].map(id => [id, null]));
    this.balls = [];
    this.ballSeq = 1;
    this.activity = null;
    this.round = null;
    this.lastResults = null;
    this.activitySeq = 0;
    this.dirty = true;
    this.createdAt = now();
    this.spawnToys();
  }

  // ---- membership -------------------------------------------------------------
  get activePlayers() {
    return [...this.players.values()].filter(p => p.connected && p.character);
  }

  join(token) {
    if (token) {
      const existing = [...this.players.values()].find(p => p.token === token);
      if (existing) {
        existing.connected = true;
        existing.awayUntil = 0;
        this.dirty = true;
        this.broadcastEvent({ kind: 'back', id: existing.id });
        return { ok: true, playerId: existing.id, token: existing.token, rejoined: true };
      }
    }
    if (this.players.size >= MAX_PLAYERS) return { ok: false, error: 'full' };
    const id = this.nextId++;
    const player = {
      id, token: makeToken(this.random), character: null, connected: true, awayUntil: 0,
      x: 0, y: 0, z: 0, yaw: 0, anim: 0, carrying: null, equipment: null, stats: this.freshStats(), seen: this.now()
    };
    this.players.set(id, player);
    if (this.hostId == null) this.hostId = id;
    this.dirty = true;
    return { ok: true, playerId: id, token: player.token };
  }

  // Temporary loss of connection: free shared things right away, keep the slot.
  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.awayUntil = this.now() + RECONNECT_GRACE_MS;
    this.releaseAll(p);
    this.dirty = true;
    this.broadcastEvent({ kind: 'away', id });
    this.checkActivityDone();
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.releaseAll(p);
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value ?? null;
    this.dirty = true;
    this.checkActivityDone();
  }

  releaseAll(p) {
    if (p.equipment) this.releaseEquipment(p, p.equipment);
    if (p.carrying) {
      const ball = this.ball(p.carrying);
      if (ball) Object.assign(ball, { holder: null, x: p.x, y: 0.3, z: p.z });
      p.carrying = null;
    }
  }

  freshStats() {
    return { racePlace: 0, raceTime: 0, delivered: 0, passes: 0, picked: 0, swings: 0, slides: 0, emotes: 0 };
  }

  get isEmpty() {
    return ![...this.players.values()].some(p => p.connected);
  }

  // ---- messages ----------------------------------------------------------------
  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg.type !== 'string') return;
    p.seen = this.now();
    // Actions carry the sender's position so validation never uses a stale one.
    if (msg.type !== 'state' && Array.isArray(msg.p)) this.updateState(p, { p: msg.p });
    switch (msg.type) {
      case 'pick': return this.pickCharacter(p, msg.character);
      case 'state': return this.updateState(p, msg);
      case 'occupy': return this.occupy(p, msg.id);
      case 'release': return this.releaseEquipment(p, msg.id);
      case 'ball': return this.ballAction(p, msg);
      case 'emote': return this.emote(p, msg.e);
      case 'start': return this.start(p, msg.activity);
      case 'race': return this.raceReport(p, msg);
      case 'settings': return this.settings(p, msg);
      case 'ping': return this.send(id, { type: S2C.PONG, t: msg.t, now: this.now() });
    }
  }

  pickCharacter(p, character) {
    if (!isCharacterId(character)) return this.error(p, 'bad-character');
    const owner = [...this.players.values()].find(o => o.character === character);
    if (owner && owner !== p) return this.error(p, 'taken');
    if (p.character === character) return;
    const first = !p.character;
    p.character = character;
    if (first) {
      const s = spawnPoint(p.id % MAX_PLAYERS);
      Object.assign(p, { x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    }
    this.dirty = true;
    this.broadcastEvent({ kind: 'joined', id: p.id, character });
  }

  updateState(p, msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return;
    const [x, y, z] = msg.p;
    // Clients own their movement; reject only impossible values.
    if (Math.abs(x) > 40 || Math.abs(z) > 40 || y < -5 || y > 20) return;
    p.x = x; p.y = y; p.z = z;
    if (Number.isFinite(msg.r)) p.yaw = msg.r;
    if (Number.isInteger(msg.a) && msg.a >= 0 && msg.a < 32) p.anim = msg.a;
  }

  reach(extra = 0) {
    return (this.assist ? MOVEMENT.assistReach : MOVEMENT.reach) + extra;
  }

  // ---- equipment -----------------------------------------------------------------
  occupy(p, eqId) {
    if (!(eqId in this.equipment) || !p.character) return;
    if (this.inLockedPhase(p)) return;
    const current = this.equipment[eqId];
    if (current && current.occupant !== p.id) return this.error(p, 'occupied', eqId);
    if (p.equipment && p.equipment !== eqId) this.releaseEquipment(p, p.equipment);
    const spot = eqId === SLIDE.id ? SLIDE.entrance : SWINGS.find(s => s.id === eqId);
    // Latency tolerance: the reported position trails the device by a few frames.
    if (dist2(p, spot) > this.reach(1.2) ** 2) return this.error(p, 'far', eqId);
    if (eqId === SLIDE.id && p.y < SLIDE.entrance.y - 0.6) return this.error(p, 'far', eqId);
    if (p.carrying) this.dropBall(p, p.x, p.z);
    this.equipment[eqId] = { occupant: p.id, since: this.now() };
    p.equipment = eqId;
    if (eqId === SLIDE.id) p.stats.slides++; else p.stats.swings++;
    this.dirty = true;
  }

  releaseEquipment(p, eqId) {
    const current = this.equipment[eqId];
    if (!current || current.occupant !== p.id) return;
    this.equipment[eqId] = null;
    if (p.equipment === eqId) p.equipment = null;
    this.dirty = true;
  }

  // ---- balls -------------------------------------------------------------------
  ball(id) { return this.balls.find(b => b.id === id); }

  pitSpot() {
    const p = BALL_PIT;
    return { x: p.minX + 0.8 + this.random() * (p.maxX - p.minX - 1.6), z: p.minZ + 0.8 + this.random() * (p.maxZ - p.minZ - 1.6) };
  }

  clearCarried() {
    for (const p of this.players.values()) p.carrying = null;
  }

  spawnToys() {
    this.clearCarried();
    this.balls = [];
    for (let i = 0; i < TOY_COUNT; i++) {
      const s = i < 8 ? this.pitSpot() : { x: BALL_SPOTS[12 + i][0], z: BALL_SPOTS[12 + i][1] };
      this.balls.push({ id: this.ballSeq++, color: BALL_COLORS[i % BALL_COLORS.length].id, x: s.x, y: 0.3, z: s.z, holder: null, done: false });
    }
    this.dirty = true;
  }

  spawnRescueBalls(count) {
    this.clearCarried();
    this.balls = [];
    const spots = [...BALL_SPOTS].sort(() => this.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const s = i < spots.length ? { x: spots[i][0], z: spots[i][1] } : this.pitSpot();
      this.balls.push({ id: this.ballSeq++, color: BALL_COLORS[i % BALL_COLORS.length].id, x: s.x, y: 0.3, z: s.z, holder: null, done: false });
    }
    this.dirty = true;
  }

  ballAction(p, msg) {
    if (!p.character || this.inLockedPhase(p)) return;
    if (msg.op === 'pickup') {
      const ball = this.ball(msg.id);
      if (!ball || ball.holder || ball.done || p.carrying || p.equipment) return;
      if (dist2(p, ball) > this.reach(0.9) ** 2) return this.error(p, 'far');
      ball.holder = p.id; p.carrying = ball.id; p.stats.picked++;
      this.dirty = true;
      this.broadcastEvent({ kind: 'pickup', id: p.id, ball: ball.id });
    } else if (msg.op === 'drop') {
      if (!p.carrying) return;
      const x = Number.isFinite(msg.x) ? msg.x : p.x, z = Number.isFinite(msg.z) ? msg.z : p.z;
      this.dropBall(p, x, z);
    } else if (msg.op === 'deliver') {
      this.deliver(p, msg.basket);
    } else if (msg.op === 'pass') {
      const to = this.players.get(msg.to);
      const ball = this.ball(p.carrying);
      if (!ball || !to || to === p || !to.connected || to.carrying || to.equipment) return;
      if (dist2(p, to) > (this.reach(0) + 6) ** 2) return this.error(p, 'far');
      ball.holder = to.id; to.carrying = ball.id; p.carrying = null;
      if (this.activity?.type === 'rescue') p.stats.passes++;
      this.dirty = true;
      this.broadcastEvent({ kind: 'pass', from: p.id, to: to.id, ball: ball.id });
    }
  }

  dropBall(p, x, z) {
    const ball = this.ball(p.carrying);
    p.carrying = null;
    if (!ball) return;
    // Forgiving drop: stay near the player, never inside the far walls.
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), m = d > 1.5 ? 1.5 / d : 1;
    Object.assign(ball, { holder: null, x: p.x + dx * m, y: 0.3, z: p.z + dz * m });
    this.dirty = true;
    this.broadcastEvent({ kind: 'drop', id: p.id, ball: ball.id });
  }

  deliver(p, basketId) {
    const ball = this.ball(p.carrying), basket = BASKETS.find(b => b.id === basketId);
    if (!ball || !basket) return;
    if (dist2(p, basket) > (this.reach(0.7) + (this.assist ? 0.6 : 0)) ** 2) return this.error(p, 'far');
    if (ball.color !== basket.id) return this.error(p, 'wrong-basket');
    p.carrying = null;
    const rescue = this.activity?.type === 'rescue' && this.activity.phase === 'play';
    if (rescue) {
      Object.assign(ball, { holder: null, done: true, x: basket.x, y: 0.6, z: basket.z });
      this.activity.data.delivered++;
      p.stats.delivered++;
      this.activity.data.byPlayer[p.id] = (this.activity.data.byPlayer[p.id] || 0) + 1;
    } else {
      // Free play: the ball pops back into the pit to be found again.
      const s = this.pitSpot();
      Object.assign(ball, { holder: null, x: s.x, y: 0.3, z: s.z });
    }
    this.dirty = true;
    this.broadcastEvent({ kind: 'deliver', id: p.id, ball: ball.id, basket: basket.id, count: rescue ? this.activity.data.delivered : 0 });
    if (rescue && this.activity.data.delivered >= this.activity.data.target) this.finishRescue(true);
  }

  // ---- emotes & settings -----------------------------------------------------------
  emote(p, e) {
    if (!['wave', 'laugh', 'clap', 'celebrate'].includes(e) || !p.character) return;
    const t = this.now();
    if (t - (p.lastEmote || 0) < 700) return;
    p.lastEmote = t; p.stats.emotes++;
    this.broadcastEvent({ kind: 'emote', id: p.id, e });
  }

  settings(p, msg) {
    if (p.id !== this.hostId) return;
    if (typeof msg.assist === 'boolean') this.assist = msg.assist;
    this.dirty = true;
  }

  error(p, code, detail) {
    this.send(p.id, { type: S2C.ERROR, code, detail });
  }

  broadcastEvent(event) {
    for (const p of this.players.values()) if (p.connected) this.send(p.id, { type: S2C.EVENT, t: this.now(), ...event });
  }

  // ---- activities ------------------------------------------------------------------
  inLockedPhase(p) {
    const a = this.activity;
    if (!a) return false;
    if (a.phase === 'intro' || a.phase === 'countdown') return a.participants.includes(p.id);
    if (a.type === 'celebrate') return true;
    return false;
  }

  start(p, type) {
    if (this.activity || !p.character) return;
    if (!['race', 'rescue', 'family'].includes(type)) return;
    if (type === 'family') {
      if (p.id !== this.hostId) return this.error(p, 'host-only');
      this.round = { queue: ['race', 'rescue'], index: 0, stats: {} };
      for (const q of this.players.values()) q.stats = this.freshStats();
      this.mode = 'family';
      return this.beginActivity(this.round.queue[0]);
    }
    for (const q of this.players.values()) q.stats = this.freshStats();
    this.beginActivity(type);
  }

  beginActivity(type) {
    const now = this.now();
    const participants = this.activePlayers.map(q => q.id);
    const teleport = {};
    for (const q of this.activePlayers) this.releaseAll(q);
    if (type === 'race') {
      participants.forEach((id, i) => { teleport[id] = raceStartSlot(i); });
      this.spawnToys();
    }
    const data = type === 'race'
      ? { progress: Object.fromEntries(participants.map(id => [id, 0])), finished: [] }
      : { target: rescueTarget(participants.length), delivered: 0, byPlayer: {} };
    if (type === 'rescue') {
      participants.forEach((id, i) => { teleport[id] = spawnPoint(i); });
      this.spawnRescueBalls(data.target + 5);
    }
    for (const [id, t] of Object.entries(teleport)) Object.assign(this.players.get(Number(id)), { x: t.x, y: t.y, z: t.z, yaw: t.yaw });
    this.activity = { type, phase: 'intro', phaseStart: now, phaseEnd: now + PHASE_MS.intro, participants, teleport, data, seq: ++this.activitySeq };
    this.dirty = true;
  }

  setPhase(phase, duration) {
    const now = this.now();
    Object.assign(this.activity, { phase, phaseStart: now, phaseEnd: now + duration });
    if (phase !== 'intro') this.activity.teleport = null;
    this.dirty = true;
  }

  raceReport(p, msg) {
    const a = this.activity;
    if (!a || a.type !== 'race' || a.phase !== 'play' || !a.participants.includes(p.id)) return;
    const next = a.data.progress[p.id];
    if (msg.op === 'cp') {
      if (msg.i !== next || next >= RACE.checkpoints.length) return;
      const cp = RACE.checkpoints[next];
      if (dist2(p, cp) > (cp.r + 2.5) ** 2) return this.error(p, 'far');
      a.data.progress[p.id] = next + 1;
      this.dirty = true;
      this.broadcastEvent({ kind: 'cp', id: p.id, i: next });
    } else if (msg.op === 'finish') {
      if (next < RACE.checkpoints.length || a.data.finished.some(f => f.id === p.id)) return;
      if (!(p.x > BALL_PIT.minX - 1 && p.x < BALL_PIT.maxX + 1 && p.z > BALL_PIT.minZ - 1 && p.z < BALL_PIT.maxZ + 1)) return;
      const time = (this.now() - a.phaseStart) / 1000;
      a.data.finished.push({ id: p.id, time });
      a.data.progress[p.id] = RACE.checkpoints.length + 1;
      p.stats.racePlace = a.data.finished.length;
      p.stats.raceTime = time;
      this.dirty = true;
      this.broadcastEvent({ kind: 'finish', id: p.id, place: a.data.finished.length, time });
      this.checkActivityDone();
    }
  }

  checkActivityDone() {
    const a = this.activity;
    if (!a || a.phase !== 'play') return;
    const live = a.participants.filter(id => this.players.get(id)?.connected);
    if (a.type === 'race') {
      if (live.every(id => a.data.finished.some(f => f.id === id))) this.finishRace();
    }
    if (live.length === 0) {
      this.activity = null; this.round = null; this.mode = 'free'; this.spawnToys();
    }
  }

  finishRace() {
    const a = this.activity;
    const ranking = a.data.finished.map((f, i) => ({ id: f.id, place: i + 1, time: Math.round(f.time * 10) / 10 }));
    for (const id of a.participants) if (!a.data.finished.some(f => f.id === id)) ranking.push({ id, place: 0, time: 0, progress: a.data.progress[id] });
    a.data.results = { ranking, badges: this.badges(['race']) };
    this.lastResults = { type: 'race', ...a.data.results };
    this.setPhase('results', PHASE_MS.results);
  }

  finishRescue(success) {
    const a = this.activity;
    const left = Math.max(0, (a.phaseEnd - this.now()) / 1000);
    a.data.results = {
      success, secondsLeft: Math.round(left), stars: rescueStars(success, left),
      delivered: a.data.delivered, target: a.data.target, byPlayer: a.data.byPlayer, badges: this.badges(['rescue'])
    };
    this.lastResults = { type: 'rescue', ...a.data.results };
    this.setPhase('results', PHASE_MS.results);
  }

  // Badges come only from what players actually did this activity or round.
  badges(kinds) {
    const list = [];
    const players = [...this.players.values()].filter(p => p.character);
    const best = (key, cmp = (a, b) => b - a) => {
      const scored = players.filter(p => p.stats[key] > 0).sort((a, b) => cmp(a.stats[key], b.stats[key]));
      return scored.length ? scored[0] : null;
    };
    if (kinds.includes('race')) {
      const fastest = best('racePlace', (a, b) => a - b);
      if (fastest) list.push({ id: fastest.id, badge: 'fastest' });
      for (const p of players) if (p.stats.racePlace > 1) list.push({ id: p.id, badge: 'finisher' });
    }
    if (kinds.includes('rescue')) {
      const collector = best('delivered');
      if (collector) list.push({ id: collector.id, badge: 'collector' });
      const helper = best('passes');
      if (helper) list.push({ id: helper.id, badge: 'helper' });
    }
    if (kinds.includes('fun')) {
      const fun = players.filter(p => p.stats.swings + p.stats.slides + p.stats.emotes > 0)
        .sort((a, b) => (b.stats.swings + b.stats.slides + b.stats.emotes) - (a.stats.swings + a.stats.slides + a.stats.emotes))[0];
      if (fun) list.push({ id: fun.id, badge: 'joy' });
    }
    return list;
  }

  endActivity() {
    const finished = this.activity;
    this.activity = null;
    if (finished.type !== 'race') this.spawnToys();
    if (this.round && finished.type !== 'celebrate') {
      this.round.index++;
      if (this.round.index < this.round.queue.length) return this.beginActivity(this.round.queue[this.round.index]);
      return this.beginCelebration();
    }
    if (finished.type === 'celebrate') { this.round = null; this.mode = 'free'; }
    this.dirty = true;
  }

  beginCelebration() {
    const now = this.now();
    const participants = this.activePlayers.map(p => p.id);
    const teleport = {};
    participants.forEach((id, i) => { teleport[id] = celebrationSlot(i, participants.length); });
    for (const [id, t] of Object.entries(teleport)) Object.assign(this.players.get(Number(id)), t);
    const badges = this.badges(['race', 'rescue', 'fun']);
    this.activity = {
      type: 'celebrate', phase: 'results', phaseStart: now, phaseEnd: now + PHASE_MS.celebrate, participants, teleport,
      data: { results: { badges, stats: Object.fromEntries(participants.map(id => [id, this.players.get(id).stats])) } },
      seq: ++this.activitySeq
    };
    this.dirty = true;
  }

  // ---- ticking -------------------------------------------------------------------
  tick() {
    const now = this.now();
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.awayUntil && now > p.awayUntil) this.remove(p.id);
    }
    const slide = this.equipment[SLIDE.id];
    if (slide && now - slide.since > SLIDE.duration * 1000 + 600) {
      const p = this.players.get(slide.occupant);
      if (p) p.equipment = null;
      this.equipment[SLIDE.id] = null;
      this.dirty = true;
    }
    const a = this.activity;
    if (a && now >= a.phaseEnd) {
      if (a.phase === 'intro') this.setPhase('countdown', PHASE_MS.countdown);
      else if (a.phase === 'countdown') this.setPhase('play', (a.type === 'race' ? RACE.timeLimit : RESCUE_TIME) * 1000);
      else if (a.phase === 'play') a.type === 'race' ? this.finishRace() : this.finishRescue(false);
      else if (a.phase === 'results') this.endActivity();
    }
    this.flush();
  }

  flush() {
    const connected = [...this.players.values()].filter(p => p.connected);
    if (this.dirty) {
      this.dirty = false;
      const world = this.world();
      for (const p of connected) this.send(p.id, world);
    }
    const snap = { type: S2C.SNAP, t: this.now(), p: this.activePlayers.map(p => [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.yaw), p.anim]) };
    for (const p of connected) this.send(p.id, snap);
  }

  world() {
    return {
      type: S2C.WORLD, t: this.now(), code: this.code, host: this.hostId, mode: this.mode, assist: this.assist,
      players: [...this.players.values()].map(p => ({ id: p.id, character: p.character, connected: p.connected, carrying: p.carrying, equipment: p.equipment })),
      equipment: this.equipment,
      balls: this.balls.map(b => ({ id: b.id, color: b.color, x: round2(b.x), y: b.y, z: round2(b.z), holder: b.holder, done: b.done })),
      activity: this.activity && {
        type: this.activity.type, phase: this.activity.phase, phaseStart: this.activity.phaseStart, phaseEnd: this.activity.phaseEnd,
        participants: this.activity.participants, teleport: this.activity.teleport, data: this.activity.data, seq: this.activity.seq
      },
      round: this.round && { queue: this.round.queue, index: this.round.index },
      free: CHARACTER_IDS.filter(c => ![...this.players.values()].some(p => p.character === c))
    };
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
export { ANIM_CODE };
