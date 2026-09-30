// 4. Walls keep players inside the world, and the north gate is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, steps, seconds } from './helpers';
import { RAPIER } from '../shared/rapier';

test('running at every wall never leaves the world', async () => {
  const sim = await makeSim();
  const { min, max } = sim.def.layout.bounds;
  const starts: [number, number][] = [[0, -14], [-30, 0], [30, 0], [0, 60], [-30, 70], [30, 70]];
  let n = 0;
  for (const [x, z] of starts) for (let a = 0; a < 16; a++) {
    const ang = a / 16 * Math.PI * 2, id = `r${n++}`;
    const p = sim.addPlayer(id, [x, 0.05, z]);
    for (let k = 0; k < seconds(25); k++) steps(sim, 1, { [id]: { mx: Math.sin(ang), mz: Math.cos(ang), b: k % 50 === 0 ? 1 : 0 } });
    assert.ok(p.pos[0] > min[0] - 0.2 && p.pos[0] < max[0] + 0.2 && p.pos[2] > min[1] - 0.2 && p.pos[2] < max[1] + 0.2 && p.pos[1] > -1,
      `escaped from ${x},${z} heading ${a}: ${p.pos.map(v => v.toFixed(1))}`);
    sim.removePlayer(id);
  }
});

test('the north gate is open: nothing blocks the 14 m gap', async () => {
  const sim = await makeSim();
  sim.world.step();
  const g = sim.def.layout.gate;
  for (let x = g.x[0] + 0.6; x <= g.x[1] - 0.6; x += 0.5) {
    const hit = sim.world.castRay(new RAPIER.Ray({ x, y: 1, z: g.z - 6 }, { x: 0, y: 0, z: 1 }), 12, true, undefined, undefined, undefined, undefined,
      c => sim.meta.get(c.handle)?.kind === 'static');
    assert.equal(hit, null, `blocked at x=${x.toFixed(1)}`);
  }
  // …and a player walks straight through it.
  const p = sim.addPlayer('gate', [0, 0.05, 28]);
  steps(sim, seconds(3), { gate: { mz: 1 } });
  assert.ok(p.pos[2] > 40, `stopped at z=${p.pos[2].toFixed(1)}`);
});

test('the hall is closed apart from the gate', async () => {
  const sim = await makeSim();
  sim.world.step();
  const g = sim.def.layout.gate;
  const ray = (x: number, z: number, dx: number, dz: number) => sim.world.castRay(new RAPIER.Ray({ x, y: 1, z }, { x: dx, y: 0, z: dz }), 60, true,
    undefined, undefined, undefined, undefined, c => sim.meta.get(c.handle)?.tag === 'wall');
  for (let x = -41; x <= 41; x += 2) {
    if (x > g.x[0] - 0.5 && x < g.x[1] + 0.5) continue;
    assert.ok(ray(x, 20, 0, 1), `north wall missing at x=${x}`);
    assert.ok(ray(x, 0, 0, -1), `south wall missing at x=${x}`);
  }
  for (let z = -31; z <= 88; z += 2) { assert.ok(ray(0, z, 1, 0), `east boundary missing at z=${z}`); assert.ok(ray(0, z, -1, 0), `west boundary missing at z=${z}`); }
});
