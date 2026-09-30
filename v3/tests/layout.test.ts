// 6. Few signs, many things to do: at most 3 text signs in the whole world,
// at least 3 interactive objects per zone; plus layout sanity checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, BOUNDS, worldDef } from '../shared/worldData';
import { childNames } from '../shared/world';

test('at most 3 text signs in layout.json', () => {
  const def = worldDef();
  assert.ok(def.signs <= 3, `${def.signs} signs`);
  // Starter-scene sign children are excluded from the world.
  for (const pl of LAYOUT.placements.filter(p => p.collider === 'children')) {
    const names = childNames(BOUNDS[pl.model!]);
    const signs = names.filter(n => /sign|notice-board|briefing-screen/.test(n));
    for (const s of signs) assert.ok(pl.children!.some(r => r.collider === 'exclude' && new RegExp(r.match).test(s)), `${pl.id}: ${s} is not excluded`);
  }
});

test('every zone has at least 3 interactive objects', () => {
  const def = worldDef();
  for (const z of LAYOUT.zones) assert.ok((def.interactives[z.id] || 0) >= 3, `${z.id}: ${def.interactives[z.id] || 0}`);
});

test('every minigame has a spot in the world', () => {
  const ids = LAYOUT.games.map(g => g.id).sort();
  assert.deepEqual(ids, ['colorFloor', 'giantBall', 'hideSeek', 'paint', 'race', 'rescue']);
  for (const g of LAYOUT.games) assert.ok(LAYOUT.zones.some(z => z.id === g.zone));
});

test('placements use known models, zones and collider types', () => {
  const kinds = new Set(['box', 'trunk', 'none', 'bounce', 'children', 'dynamic', 'joint']);
  const ids = new Set<string>();
  for (const p of LAYOUT.placements) {
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id); ids.add(p.id);
    assert.ok(kinds.has(p.collider), `${p.id}: collider ${p.collider}`);
    assert.ok(LAYOUT.zones.some(z => z.id === p.zone), `${p.id}: zone ${p.zone}`);
    if (p.model) assert.ok(BOUNDS[p.model], `${p.id}: model ${p.model} not built`);
  }
});

test('colliders are simple shapes, never a big render mesh', () => {
  const def = worldDef();
  for (const c of def.statics) assert.ok(['box', 'cyl', 'ball'].includes(c.shape));
});
