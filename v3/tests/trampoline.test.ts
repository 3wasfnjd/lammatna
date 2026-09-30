// 3. A trampoline throws the player higher than 2 m (and the bed reports a bounce for the dip + sound).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, steps, seconds } from './helpers';

test('every trampoline bed throws the player higher than 2 m', async () => {
  const sim = await makeSim();
  const beds = sim.def.statics.filter(c => c.tag === 'bounce' && c.h[1] * 2 < 1.6 && c.h[0] > 0.6 && c.h[2] > 0.6);
  assert.ok(beds.length >= 6, `found ${beds.length} beds`);
  for (const [i, bed] of beds.entries()) {
    const top = bed.c[1] + bed.h[1];
    const p = sim.addPlayer('j' + i, [bed.c[0], top + 0.6, bed.c[2]]);
    let peak = -Infinity, bounced = false;
    for (let k = 0; k < seconds(3); k++) {
      steps(sim, 1);
      peak = Math.max(peak, p.pos[1] - top);
      if (sim.drainEvents().some(e => e.type === 'bounce' && e.p === p.id)) bounced = true;
    }
    assert.ok(bounced, `bed ${bed.owner}: bounce event`);
    assert.ok(peak > 2, `bed ${bed.owner}: peak ${peak.toFixed(2)} m above the bed`);
    sim.removePlayer(p.id);
  }
});

test('walking onto the first trampoline from the soft steps bounces', async () => {
  const sim = await makeSim();
  const p = sim.addPlayer('kid', [-16.5, 0.05, -19.3]);
  let peak = 0;
  for (let k = 0; k < seconds(4); k++) { steps(sim, 1, { kid: { mx: -1, mz: 0 } }); peak = Math.max(peak, p.pos[1]); }
  assert.ok(peak > 3, `peak ${peak.toFixed(2)} m`);
});
