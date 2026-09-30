// 5. Room logic: joining, the 5-player limit, and start + end of every minigame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics } from '../shared/rapier';
import { Room } from '../shared/room';
import { SIM_HZ, CHARACTER_IDS } from '../shared/constants';
import type { ServerMsg } from '../shared/protocol';
import type { V3 } from '../shared/math';

async function room(solo = false) {
  await initPhysics();
  const inbox = new Map<string, ServerMsg[]>();
  const r = new Room('1234', (id, m) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id)!.push(m); }, solo);
  return { r, inbox };
}
const hello = (i: number) => ({ t: 'hello' as const, look: { char: CHARACTER_IDS[i % 5], color: '#26B3AE', acc: 'none' as const } });
const run = (r: Room, s: number) => { for (let i = 0; i < Math.round(s * SIM_HZ); i++) r.stepOnce(); };
const events = (inbox: Map<string, ServerMsg[]>, id: string) => (inbox.get(id) || []).flatMap(m => m.t === 's' ? m.snap.ev : []);
function put(r: Room, id: string, x: number, z: number, y = 0.05) { r.sim.teleport(r.sim.players.get(id)!, [x, y, z] as V3); }
function view(r: Room, game: string) { return r.games.views().find(v => v.id === game)!; }
function runUntil(r: Room, cond: () => boolean, maxS: number, each?: () => void) {
  for (let i = 0; i < maxS * SIM_HZ; i++) { each?.(); r.stepOnce(); if (cond()) { for (let k = 0; k < 3; k++) r.stepOnce(); return true; } }
  return false;
}
async function twoPlayers() {
  const env = await room();
  const a = env.r.join(hello(0)), b = env.r.join(hello(1));
  assert.ok(a.ok && b.ok);
  return { ...env, a: (a as any).id as string, b: (b as any).id as string };
}
function startGame(r: Room, game: string, ids: string[]) {
  const g = r.sim.def.layout.games.find(x => x.id === game)!;
  const at = view(r, game).spot;
  ids.forEach((id, i) => put(r, id, at[0] + (i - 0.5) * 0.8, at[1] + (g.id === 'giantBall' ? -2 : 0)));
  assert.ok(runUntil(r, () => view(r, game).phase === 'running', 6), `${game} did not start (phase ${view(r, game).phase}, in spot ${view(r, game).inSpot})`);
}

test('joining: welcome, snapshots, info', async () => {
  const { r, inbox } = await room();
  const j = r.join(hello(0));
  assert.ok(j.ok);
  const id = (j as any).id;
  r.welcome(id);
  run(r, 0.2);
  const msgs = inbox.get(id)!;
  assert.ok(msgs.some(m => m.t === 'welcome' && m.code === '1234'));
  assert.ok(msgs.some(m => m.t === 's' && m.snap.pl.some((p: any) => p.id === id)));
  assert.ok(msgs.some(m => m.t === 'info' && m.players.length === 1));
});

test('the room holds at most 5 players; leaving frees a place', async () => {
  const { r } = await room();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { const j = r.join(hello(i)); assert.ok(j.ok, `player ${i + 1} joins`); ids.push((j as any).id); }
  const sixth = r.join(hello(5));
  assert.deepEqual(sixth, { ok: false, code: 'full' });
  r.leave(ids[2]);
  assert.equal(r.count, 4);
  assert.ok(r.join(hello(6)).ok);
  assert.equal(r.sim.players.size, 5);
});

test('bad hello is refused; a reconnect resumes the same player', async () => {
  const { r } = await room();
  assert.deepEqual(r.join({ t: 'hello', look: { char: 'nobody', color: 'x', acc: 'none' } as any }), { ok: false, code: 'bad' });
  const j = r.join(hello(0)) as any;
  r.disconnect(j.id);
  const again = r.join({ ...hello(0), resume: j.id }) as any;
  assert.equal(again.id, j.id);
  assert.equal(r.count, 1);
});

test('inputs move the player; emoji and stars are broadcast', async () => {
  const { r, inbox } = await room();
  const id = (r.join(hello(0)) as any).id;
  const p = r.sim.players.get(id)!;
  const z0 = p.pos[2];
  r.message(id, { t: 'in', f: Array.from({ length: 30 }, (_, i) => [i + 1, 0, 1, 0] as [number, number, number, number]) });
  run(r, 0.6);
  assert.ok(p.pos[2] > z0 + 1, 'moved north');
  r.message(id, { t: 'emoji', e: 2 });
  const s = r.sim.def.layout.stars[1];
  put(r, id, s[0], s[2], s[1] - 0.7);
  run(r, 0.3);
  const ev = events(inbox, id);
  assert.ok(ev.some(e => e.type === 'emoji' && e.e === 2));
  assert.ok(ev.some(e => e.type === 'star'));
  assert.ok(r.players.get(id)!.stars.length >= 1);
});

test('a minigame needs two players in its spot (one in solo play)', async () => {
  const { r, a } = await twoPlayers();
  const at = view(r, 'paint').spot;
  put(r, a, at[0], at[1]);
  run(r, 5);
  assert.equal(view(r, 'paint').phase, 'idle');
  const solo = await room(true);
  const s = (solo.r.join(hello(0)) as any).id;
  const sat = view(solo.r, 'paint').spot;
  put(solo.r, s, sat[0], sat[1]);
  run(solo.r, 0.2);
  assert.equal(view(solo.r, 'paint').phase, 'countdown');
  run(solo.r, 3.2);
  assert.equal(view(solo.r, 'paint').phase, 'running');
});

test('countdown cancels when a player walks off the spot', async () => {
  const { r, a, b } = await twoPlayers();
  const at = view(r, 'race').spot;
  put(r, a, at[0], at[1]); put(r, b, at[0] + 0.5, at[1]);
  run(r, 1);
  assert.equal(view(r, 'race').phase, 'countdown');
  put(r, b, at[0] + 10, at[1]);
  run(r, 0.1);
  assert.equal(view(r, 'race').phase, 'idle');
});

test('race: start, checkpoints, finish', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'race', [a, b]);
  const g = r.sim.def.layout.games.find(x => x.id === 'race')!;
  for (const cp of [...g.checkpoints, g.spot]) { put(r, a, cp[0], cp[1]); run(r, 0.2); }
  for (const cp of [...g.checkpoints, g.spot]) { put(r, b, cp[0], cp[1]); run(r, 0.2); }
  assert.ok(runUntil(r, () => view(r, 'race').phase === 'result', 2));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'race');
  assert.deepEqual(end.winners, [a]);
});

test('ball rescue: start, balls into the basket, end', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'rescue', [a, b]);
  const g = r.sim.def.layout.games.find(x => x.id === 'rescue')!;
  const balls = r.sim.props.filter(p => p.def.tag === 'rescue');
  assert.equal(balls.length, 8);
  balls.forEach((pr, i) => { pr.lastToucher = i % 3 ? a : b; r.sim.resetProp(pr, [g.spot[0] + (i % 3 - 1) * 0.4, 0.6 + i * 0.2, g.spot[1]]); });
  assert.ok(runUntil(r, () => view(r, 'rescue').phase === 'result', 5));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'rescue');
  assert.deepEqual(end.winners, [a]);
  assert.equal(end.scores[a] + end.scores[b], 8);
});

test('colour floor: rounds knock players out, last one standing wins', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'colorFloor', [a, b]);
  const area = r.sim.toyById.get('color-floor') as any;
  // a always runs to the called colour; b stays put on a random tile.
  const ok = runUntil(r, () => view(r, 'colorFloor').phase === 'result', 80, () => {
    const x = view(r, 'colorFloor').x;
    if (!x || x.phase !== 'show') return;
    const pa = r.sim.players.get(a)!;
    if (area.grid[area.cell(pa.pos)] === x.target) return;
    const k = area.grid.findIndex((c: number) => c === x.target);
    const at = area.cellCenter(k);
    r.sim.teleport(pa, [at[0], 0.08, at[2]]);
  });
  assert.ok(ok, 'colour floor ended');
  run(r, 0.1);   // let the snapshot carrying the result go out
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'colorFloor');
  assert.ok(end.winners.includes(a));
});

test('hide and seek: hide phase, seek phase, everyone found', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'hideSeek', [a, b]);
  const seeker = view(r, 'hideSeek').x.seeker, hider = seeker === a ? b : a;
  assert.equal(r.sim.players.get(seeker)!.mode, 'frozen');
  put(r, hider, 36, 86);
  run(r, 15.2);
  assert.equal(view(r, 'hideSeek').x.phase, 'seek');
  assert.notEqual(r.sim.players.get(seeker)!.mode, 'frozen');
  put(r, seeker, 36.5, 85);
  assert.ok(runUntil(r, () => view(r, 'hideSeek').phase === 'result', 3));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'hideSeek');
  assert.deepEqual(end.winners, [seeker]);
});

test('hide and seek: hiders win when time runs out', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'hideSeek', [a, b]);
  const seeker = view(r, 'hideSeek').x.seeker, hider = seeker === a ? b : a;
  put(r, hider, -38, 88);
  assert.ok(runUntil(r, () => view(r, 'hideSeek').phase === 'result', 90));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'hideSeek');
  assert.deepEqual(end.winners, [hider]);
});

test('giant ball: goals count, first to 3 wins', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'giantBall', [a, b]);
  const pr = r.sim.propById.get('giant-ball')!;
  const east = r.sim.toyById.get('goal-e') as any;
  for (let i = 0; i < 3; i++) {
    r.sim.resetProp(pr, [east.c[0], 1.3, east.c[2]]);
    run(r, 0.2);
  }
  assert.ok(runUntil(r, () => view(r, 'giantBall').phase === 'result', 2));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'giantBall');
  assert.equal(events(inbox, a).filter(e => e.type === 'goal' && e.game === 'giantBall').length, 3);
  assert.deepEqual(end.winners, [a]);     // team 0 attacks the east goal
});

test('paint war: painting tiles, time up, most tiles wins', async () => {
  const { r, inbox, a, b } = await twoPlayers();
  startGame(r, 'paint', [a, b]);
  const pa = r.sim.players.get(a)!;
  // a throws paint around; b stands still.
  for (let k = 0; k < 8; k++) { pa.yaw = k * Math.PI / 4; r.message(a, { t: 'in', f: [[10000 + k * 2, 0, 0, 2], [10001 + k * 2, 0, 0, 0]] }); run(r, 0.7); }
  assert.ok(runUntil(r, () => view(r, 'paint').phase === 'result', 70));
  const end = events(inbox, a).find(e => e.type === 'gameEnd' && e.game === 'paint');
  assert.ok(end.scores[a] > end.scores[b], JSON.stringify(end.scores));
  assert.deepEqual(end.winners, [a]);
});

test('only one minigame runs at a time; players return to idle after the result', async () => {
  const { r, a, b } = await twoPlayers();
  startGame(r, 'paint', [a, b]);
  const c = (r.join(hello(2)) as any).id, d = (r.join(hello(3)) as any).id;
  const at = view(r, 'race').spot;
  put(r, c, at[0], at[1]); put(r, d, at[0] + 0.5, at[1]);
  run(r, 4);
  assert.equal(view(r, 'race').phase, 'idle');
  r.games.forceEnd('paint');
  assert.equal(view(r, 'paint').phase, 'result');
  run(r, 4.5);
  assert.equal(view(r, 'paint').phase, 'idle');
});

test('a backlog of inputs is trimmed without losing a button press', async () => {
  const { r } = await room();
  const id = (r.join(hello(0)) as any).id;
  run(r, 0.5);
  const p = r.sim.players.get(id)!;
  // 20 frames arrive at once; the jump press is early in the batch (it will be trimmed).
  const f: [number, number, number, number][] = Array.from({ length: 20 }, (_, i) => [i + 1, 0, 0, i >= 2 ? 1 : 0]);
  r.message(id, { t: 'in', f });
  let peak = 0;
  for (let i = 0; i < 60; i++) { r.stepOnce(); peak = Math.max(peak, p.pos[1]); }
  assert.ok(peak > 0.5, `jumped to ${peak.toFixed(2)} m`);
});
