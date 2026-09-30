// 2. Every "Playable?" model in docs/MODELS.md has a working behaviour: each
// placed toy is exercised in its own fresh simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, steps, seconds, interact, jump } from './helpers';
import { worldDef, LAYOUT, BOUNDS } from '../shared/worldData';
import { childNames } from '../shared/world';
import * as T from '../shared/toys';
import { BTN, MOVE } from '../shared/constants';
import type { Sim } from '../shared/sim';
import type { V3 } from '../shared/math';
// @ts-ignore — plain JS tool module
import { classify, classifyChild } from '../tools/playability.mjs';
// @ts-ignore
import { catalog } from '../tools/catalog.mjs';

const def = worldDef();
const cat = catalog();

test('every placed model that looks playable has a behaviour', () => {
  const missing: string[] = [];
  for (const pl of LAYOUT.placements) {
    if (!pl.model) continue;
    const c = classify(cat[pl.model]);
    if (c.playable === 'Yes') {
      const toy = def.toys.find(t => t.id === pl.id), prop = def.props.find(p => p.id === pl.id);
      if (!toy && !prop) missing.push(`${pl.id} (${pl.model}) should be ${c.behaviour}`);
      else if (toy && c.behaviour !== 'dynamic' && !['dynamic'].includes(c.behaviour) && toy.type !== c.behaviour && !(c.behaviour === 'machine' && toy.type === 'machine'))
        missing.push(`${pl.id}: behaviour ${toy.type}, table says ${c.behaviour}`);
    }
    if (c.playable === 'Scene') {
      const mb = BOUNDS[pl.model];
      const rules = pl.children || [];
      for (const name of childNames(mb)) {
        const cc = classifyChild(name.replace(/^\d+-/, ''));
        const rule = rules.find(r => new RegExp(r.match).test(name));
        if (cc.playable !== 'Yes') continue;
        const hasToy = def.toys.some(t => t.node === name && t.model === pl.model);
        const dyn = rule?.collider === 'dynamic';
        const bounce = rule?.collider === 'bounce';
        if (!hasToy && !dyn && !bounce) missing.push(`${pl.id}/${name} should be ${cc.behaviour}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

const fresh = async () => makeSim();
const byType = (type: string) => def.toys.filter(t => t.type === type).map(t => t.id);
const place = (sim: Sim, id: string, pos: V3, yaw = 0) => { const p = sim.addPlayer(id, pos, yaw); steps(sim, 12); return p; };

for (const id of byType('swing')) test(`swing ${id}: moves when pushed; a rider can sit and pump`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.SwingToy;
  toy.seats.forEach((_, i) => {
    const s = toy.seatPos(i), f = toy.fwd();
    toy.push(i, [s[0] - f[0], s[1], s[2] - f[2]]);
  });
  let maxA = 0;
  for (let k = 0; k < seconds(1.5); k++) { steps(sim, 1); toy.seats.forEach((_, i) => { maxA = Math.max(maxA, Math.abs(toy.angle(i))); }); }
  assert.ok(maxA > 0.15, `swing angle only ${maxA}`);
  // Sit and pump from rest.
  const sim2 = await fresh(); const t2 = sim2.toyById.get(id) as T.SwingToy;
  const s0 = t2.seatPos(0);
  const p = place(sim2, 'kid', [s0[0] + t2.fwd()[0] * 0.8, 0.05, s0[2] + t2.fwd()[2] * 0.8]);
  interact(sim2, 'kid');
  assert.equal(p.mode, 'seat');
  let amp = 0;
  const f = t2.fwd();
  for (let k = 0; k < seconds(8); k++) { steps(sim2, 1, { kid: { mx: f[0], mz: f[2] } }); amp = Math.max(amp, Math.abs(t2.angle(0))); }
  assert.ok(amp > 0.3, `pumping reached only ${amp.toFixed(2)} rad`);
  assert.ok(Math.hypot(p.pos[0] - t2.seatPos(0)[0], p.pos[2] - t2.seatPos(0)[2]) < 0.3, 'rider stays on the seat');
  jump(sim2, 'kid');
  assert.notEqual(p.mode, 'seat');
});

for (const id of byType('seesaw')) test(`seesaw ${id}: tilts under one rider`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.SeesawToy;
  const sp = toy.seatPoint(0);
  const p = place(sim, 'kid', [sp[0] + 0.6, 0.05, sp[2]]);
  // Choose the seat nearest to the player (either end is fine).
  interact(sim, 'kid');
  assert.equal(p.mode, 'seat');
  steps(sim, seconds(2));
  const tilt = toy.tilt(), end = p.slot === 0 ? 1 : -1;
  assert.ok(tilt * end > 0.5 * toy.limit, `tilt ${tilt.toFixed(3)} (limit ${toy.limit.toFixed(3)}, slot ${p.slot})`);
  // A second rider on the high end: equal weights balance, and the low rider pushes off to see-saw.
  const other = toy.seatPoint(p.slot === 0 ? 1 : 0);
  const q = place(sim, 'mum', [other[0] + 0.6, 0.05, other[2]]);
  interact(sim, 'mum');
  assert.equal(q.mode, 'seat');
  steps(sim, seconds(1));
  assert.ok(Math.abs(toy.tilt() - tilt) < 0.1, 'balanced riders hold the beam');
  steps(sim, seconds(1.5), { kid: { mz: 1 } });
  assert.ok(toy.tilt() * end < 0, `pushing off sends the other end down (tilt ${toy.tilt().toFixed(3)})`);
});

for (const id of byType('roundabout')) test(`roundabout ${id}: spins when pushed and carries a rider`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.RoundaboutToy;
  const rider = place(sim, 'rider', [toy.c[0] + toy.r * 0.6, toy.c[1] + 0.3, toy.c[2]]);
  steps(sim, seconds(0.5));
  assert.ok(rider.grounded, 'rider stands on the deck');
  const start = [...rider.pos];
  toy.push([toy.c[0], 0, toy.c[2] - toy.r - 0.5], Math.PI / 2, 1);
  const a0 = toy.angle();
  steps(sim, seconds(1.5));
  assert.ok(Math.abs(toy.angle() - a0) > 0.3, `turned only ${(toy.angle() - a0).toFixed(2)}`);
  const moved = Math.hypot(rider.pos[0] - start[0], rider.pos[2] - start[2]);
  assert.ok(moved > 0.3, `rider carried ${moved.toFixed(2)} m`);
  const r = Math.hypot(rider.pos[0] - toy.c[0], rider.pos[2] - toy.c[2]);
  assert.ok(r < toy.r + 0.3, 'rider stays on');
});

for (const id of byType('springRider')) test(`spring rider ${id}: wobbles and springs back`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.SpringRiderToy;
  toy.wobble(1);
  let maxA = 0;
  for (let k = 0; k < seconds(1); k++) { steps(sim, 1); maxA = Math.max(maxA, Math.abs(toy.angle())); }
  assert.ok(maxA > 0.08, `wobble ${maxA}`);
  steps(sim, seconds(5));
  assert.ok(Math.abs(toy.angle()) < 0.06, `springs back (${toy.angle()})`);
  const p = place(sim, 'kid', [toy.pivot[0] + 0.9, 0.05, toy.pivot[2]]);
  interact(sim, 'kid');
  assert.equal(p.mode, 'seat');
});

for (const id of byType('spinner')) test(`spinner ${id}: spins when pushed`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.SpinnerToy;
  const a0 = toy.angle(); toy.spinUp(1);
  steps(sim, seconds(0.7));
  assert.ok(Math.abs(toy.angle() - a0) > 0.3, `spun ${toy.angle() - a0}`);
});

for (const id of byType('slide')) test(`slide ${id}: carries the player from the top to the bottom`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.SlideToy;
  // Via the ladder: interact at the entry, climb, ride.
  const p = place(sim, 'kid', [toy.entry[0], toy.entry[1] + 0.05, toy.entry[2]]);
  interact(sim, 'kid');
  assert.ok(p.mode === 'climbUp' || p.mode === 'slide', `mode ${p.mode}`);
  let rode = false;
  for (let k = 0; k < seconds(10) && (p.mode === 'climbUp' || p.mode === 'slide'); k++) { steps(sim, 1); if (p.mode === 'slide') rode = true; }
  assert.ok(rode, 'rode the slide');
  steps(sim, seconds(1));
  const d = Math.hypot(p.pos[0] - toy.end[0], p.pos[2] - toy.end[2]);
  assert.ok(d < 2.5, `landed ${d.toFixed(2)} m from the bottom`);
  assert.ok(p.pos[1] < 0.6, `landed on the ground (y ${p.pos[1].toFixed(2)})`);
});

for (const id of byType('climb')) test(`climbable ${id}: climb up, stand on top, jump off`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.ClimbToy;
  const b = toy.solid;
  const sides: V3[] = [[(b[0] + b[3]) / 2, 0, b[2] - 0.45 / toy.s], [(b[0] + b[3]) / 2, 0, b[5] + 0.45 / toy.s], [b[0] - 0.45 / toy.s, 0, (b[2] + b[5]) / 2], [b[3] + 0.45 / toy.s, 0, (b[2] + b[5]) / 2]];
  let ok = false, why = '';
  for (const side of sides) {
    const sim2 = await fresh(); const t2 = sim2.toyById.get(id) as T.ClimbToy;
    const at = t2.w(side); at[1] = t2.def.xf.pos[1] + 0.05;
    const p = place(sim2, 'kid', at);
    const d = t2.dirIn(p);
    for (let k = 0; k < seconds(6); k++) {
      steps(sim2, 1, { kid: { mx: d[0], mz: d[2] } });
      if (p.pos[1] >= t2.top - 0.15 && p.mode !== 'climb') { ok = true; break; }
    }
    if (ok) { jump(sim2, 'kid'); steps(sim2, seconds(1.5)); ok = p.pos[1] < t2.top - 0.3 || p.mode === 'air' || p.mode === 'walk'; break; }
    why += ` side ${side.map(v => v.toFixed(1))}: mode ${p.mode} y ${p.pos[1].toFixed(2)}/${t2.top.toFixed(2)};`;
  }
  void sim; void b;
  assert.ok(ok, `could not climb${why}`);
});

for (const id of byType('hang')) test(`monkey bars ${id}: hang, travel along, drop`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.HangToy;
  const at: V3 = [toy.a[0] + (toy.b[0] - toy.a[0]) * 0.15, toy.def.xf.pos[1] + 0.05, toy.a[2] + (toy.b[2] - toy.a[2]) * 0.15];
  const p = place(sim, 'kid', at);
  interact(sim, 'kid');
  assert.equal(p.mode, 'hang');
  const dir = toy.proj(p.pos).dir, t0 = toy.proj(p.pos).t;
  steps(sim, seconds(1), { kid: { mx: dir[0], mz: dir[2] } });
  assert.equal(p.mode, 'hang');
  assert.ok(toy.proj(p.pos).t > t0 + 0.1, 'moves along the bars');
  jump(sim, 'kid');
  steps(sim, seconds(1));
  assert.ok(p.mode === 'walk' || p.mode === 'air');
});

for (const type of ['sandbox', 'ballPit', 'softPit', 'water']) for (const id of byType(type)) test(`${type} ${id}: reacts when you walk in`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.ZoneToy;
  if (type === 'water' && toy.def.p.tap) {
    const p = place(sim, 'kid', [toy.c[0] + 0.9, 0.05, toy.c[2]]);
    interact(sim, 'kid');
    assert.ok(sim.drainEvents().some(e => e.type === 'splash'), 'tap splashes');
    void p; return;
  }
  const c = toy.c;
  const p = place(sim, 'kid', [c[0], c[1] + 0.8, c[2]]);
  steps(sim, seconds(0.5));
  const ev = sim.drainEvents();
  assert.ok(toy.inside(p.pos), `player inside the ${type} (at ${p.pos.map(v => v.toFixed(2))})`);
  if (type === 'water') assert.ok(ev.some(e => e.type === 'splash'), 'splash');
  else assert.ok(p.speedMul < 1, 'soft ground slows you down');
  if (type === 'sandbox') { interact(sim, 'kid'); interact(sim, 'kid'); assert.ok(toy.piles.length >= 3 && toy.piles[2] > 0.2, 'builds a pile'); }
});

for (const id of byType('tree')) test(`tree ${id}: shakes when bumped, trunk blocks`, async () => {
  let ok = false;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const sim = await fresh(); const toy = sim.toyById.get(id) as T.TreeToy;
    const p = place(sim, 'kid', [toy.c[0] + dx * 2.5, 0.05, toy.c[2] + dz * 2.5]);
    if (Math.hypot(p.pos[0] - toy.c[0] - dx * 2.5, p.pos[2] - toy.c[2] - dz * 2.5) > 0.2) continue;   // spawn blocked
    steps(sim, seconds(0.7), { kid: { mx: -dx, mz: -dz } });
    const shook = sim.drainEvents().some(e => e.type === 'shake' && e.toy === id);
    const blocked = (p.pos[0] - toy.c[0]) * dx + (p.pos[2] - toy.c[2]) * dz > 0;
    if (shook && blocked) { ok = true; break; }
  }
  assert.ok(ok);
});

for (const id of byType('door')) test(`door ${id}: opens when you walk into it`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.DoorToy;
  steps(sim, 5);
  assert.equal(toy.angle, 0);
  place(sim, 'kid', [toy.c[0] + 2, 0.05, toy.c[2] + 1.5]);
  steps(sim, seconds(1));
  assert.ok(toy.angle > 1.2, `angle ${toy.angle}`);
});

for (const id of byType('hoop')) test(`hoop ${id}: a thrown ball scores`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.HoopToy;
  const ball = sim.props.find(pr => pr.def.tag === 'basketball' || pr.def.tag === 'ball')!;
  const front = toy.shootFrom(); front[1] += 0.05;
  const p = place(sim, 'kid', front);
  sim.resetProp(ball, [front[0] + 0.5, 0.2, front[2]]);
  steps(sim, 3);
  sim.pickUp(p, ball);
  steps(sim, 3);
  p.yaw = Math.atan2(toy.ring[0] - p.pos[0], toy.ring[2] - p.pos[2]);
  toy.interact(p);
  steps(sim, seconds(2));
  assert.ok(toy.score >= 1, `score ${toy.score}`);
});

for (const id of byType('machine')) test(`machine ${id}: lights up / starts a challenge in front`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.MachineToy;
  const p = place(sim, 'kid', [toy.front[0], 0.05, toy.front[2]]);
  assert.ok(toy.interaction(p), 'offers to play');
  interact(sim, 'kid');
  assert.ok(sim.drainEvents().some(e => e.type === 'challenge' && e.toy === id));
});

for (const id of byType('claw')) test(`claw ${id}: can be steered and grab a prize`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.ClawToy;
  const p = place(sim, 'kid', [toy.front[0], 0.05, toy.front[2]]);
  interact(sim, 'kid');
  assert.equal(p.mode, 'claw');
  // Steer the claw over prize 0 by driving input in world space.
  const target = toy.spots[0];
  for (let k = 0; k < seconds(8); k++) {
    const dl = [target[0] - toy.claw[0], target[1] - toy.claw[1]];
    if (Math.hypot(dl[0], dl[1]) < 0.01) break;
    const w = toy.wd([dl[0], 0, dl[1]]); const n = Math.hypot(w[0], w[2]) || 1;
    steps(sim, 1, { kid: { mx: w[0] / n, mz: w[2] / n } });
  }
  assert.ok(Math.hypot(target[0] - toy.claw[0], target[1] - toy.claw[1]) < 0.03, 'claw reached the prize');
  interact(sim, 'kid');
  const ev: any[] = [];
  for (let k = 0; k < seconds(6); k++) { steps(sim, 1); ev.push(...sim.drainEvents()); }
  assert.ok(ev.some(e => e.type === 'prize'), 'won a prize: ' + ev.map(e => e.type).join(','));
  assert.equal(p.mode, 'walk');
});

for (const id of byType('airHockey')) test(`air hockey ${id}: players push the puck and goals count`, async () => {
  const sim = await fresh(); const toy = sim.toyById.get(id) as T.AirHockeyToy;
  const end = toy.endPoint(1);
  const p = place(sim, 'kid', [end[0] + (end[0] - toy.def.xf.pos[0]) * 0.3, 0.05, end[2]]);
  p.yaw = Math.atan2(toy.def.xf.pos[0] - p.pos[0], toy.def.xf.pos[2] - p.pos[2]);
  const m0 = toy.mallets[0].translation();
  steps(sim, seconds(0.5), { kid: { mx: 0, mz: 0.001 } });
  const m1 = toy.mallets[0].translation();
  assert.ok(Math.hypot(m1.x - m0.x, m1.z - m0.z) > 0.05, 'mallet follows the player');
  // Send the puck at the far goal, past the goalie mallet.
  const far = toy.w([toy.cx - toy.hl - 0.1, 0, toy.cz + 0.1]);
  const from = toy.w([toy.cx, 0, toy.cz + 0.1]);
  toy.puck.setTranslation({ x: from[0], y: toy.puck.translation().y, z: from[2] }, true);
  toy.puck.setLinvel({ x: (far[0] - from[0]) * 2.5, y: 0, z: (far[2] - from[2]) * 2.5 }, true);
  const ev: any[] = [];
  for (let k = 0; k < seconds(3); k++) { steps(sim, 1); ev.push(...sim.drainEvents()); }
  assert.ok(ev.some(e => e.type === 'goal'), 'goal');
});

test('balls roll, bounce and can be thrown; light furniture can be pushed', async () => {
  const sim = await fresh();
  const ball = sim.props.find(p => p.def.tag === 'ball')!;
  const t0 = ball.body.translation();
  ball.body.applyImpulse({ x: ball.def.mass * 4, y: 0, z: 0 }, true);
  steps(sim, seconds(1));
  const t1 = ball.body.translation();
  assert.ok(Math.hypot(t1.x - t0.x, t1.z - t0.z) > 1, 'ball rolled');
  // Throw to another player.
  const a = place(sim, 'a', [t1.x - 1, 0.05, t1.z]);
  const b = place(sim, 'b', [t1.x + 7, 0.05, t1.z]);
  a.yaw = Math.PI / 2;
  sim.pickUp(a, ball); steps(sim, 3);
  sim.throwCarry(a);
  steps(sim, seconds(1.4));
  const t2 = ball.body.translation();
  assert.ok(Math.hypot(t2.x - b.pos[0], t2.z - b.pos[2]) < 3, `ball landed ${Math.hypot(t2.x - b.pos[0], t2.z - b.pos[2]).toFixed(2)} m from the catcher`);
  // Chairs are dynamic: walking into one pushes it.
  const chair = sim.props.find(p => p.def.model === 'fur/chairCushion')!;
  const c0 = chair.body.translation();
  const kid = place(sim, 'kid', [c0.x - 2, 0.05, c0.z]);
  steps(sim, seconds(1.5), { kid: { mx: 1, mz: 0 } });
  const c1 = chair.body.translation();
  assert.ok(Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.2, 'chair pushed');
  void kid;
});

test('dynamic bodies fall asleep when idle', async () => {
  const sim = await fresh();
  steps(sim, seconds(4));
  const awake = sim.props.filter(p => !p.body.isSleeping()).map(p => p.def.id);
  assert.ok(awake.length <= 2, 'awake: ' + awake.join(','));
});

test('players can hold hands and walk together', async () => {
  const sim = await fresh();
  const a = place(sim, 'a', [0, 0.05, -14]);
  const b = place(sim, 'b', [1, 0.05, -14]);
  interact(sim, 'b');
  assert.equal(b.mode, 'follow');
  steps(sim, seconds(2), { a: { mx: 0, mz: 1 } });
  assert.ok(a.pos[2] > -6 && Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) < 1.5, 'walked together');
  jump(sim, 'b');
  assert.notEqual(b.mode, 'follow');
  void MOVE; void BTN;
});
