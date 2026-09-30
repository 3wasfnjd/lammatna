// 1. Walkability: from the start plaza to every zone, from the hall into the
// garden and around the garden, over the real colliders from layout.json.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, walkGrid, nearestFree, findPath, walkPath, reachable, type Grid } from './helpers';
import type { Sim } from '../shared/sim';

let sim: Sim, grid: Grid;
before(async () => { sim = await makeSim(); grid = walkGrid(sim); });

function trip(from: [number, number], to: [number, number], name: string) {
  const a = nearestFree(grid, ...from), b = nearestFree(grid, ...to, reachable(grid, a));
  assert.ok(Math.hypot(b[0] - to[0], b[1] - to[1]) < 7, `${name}: target ${to} is not reachable (closest reachable ${b})`);
  const path = findPath(grid, a, b);
  assert.ok(path, `${name}: no path on the walk grid from ${a} to ${b}`);
  const id = 'walker-' + name;
  const p = sim.addPlayer(id, [a[0], 0.05, a[1]]);
  try {
    const r = walkPath(sim, p, path!);
    assert.ok(r.ok, `${name}: the character controller got stuck at ${JSON.stringify(r)}`);
  } finally { sim.removePlayer(id); }
}

test('grid has room to walk', () => {
  const free = grid.free.reduce((a, b) => a + b, 0);
  assert.ok(free > grid.free.length * 0.5, `only ${free} of ${grid.free.length} cells are walkable`);
});

const start: [number, number] = [0, -14];
for (const z of ['trampoline', 'adventure', 'arcade', 'cafe', 'swings', 'plaza', 'garden'])
  test(`plaza → ${z}`, async () => {
    const zone = (await import('../shared/worldData')).LAYOUT.zones.find(q => q.id === z)!;
    trip(start, zone.center, z);
  });

test('hall → garden through the north gate', () => trip([0, 20], [0, 45], 'gate'));

test('around the garden', () => {
  const loop: [number, number][] = [[0, 40], [-36, 40], [-36, 86], [0, 86], [36, 86], [36, 40], [0, 40]];
  for (let i = 0; i < loop.length - 1; i++) trip(loop[i], loop[i + 1], `garden-${i}`);
});

test('into the fenced playground through its gate', () => trip([10, 55], [8, 64.5], 'playground-gate'));
