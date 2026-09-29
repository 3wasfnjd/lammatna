// Giant Ball Challenge: the family pushes a giant beach ball along a course
// with gentle turns, soft barriers and slowly moving gates into a big goal.
// The server simulates the ball; pushes come from where players stand and move.
import { GIANT, distToPath } from './layout.js';
import { solidsFor } from './solids.js';
import { MOVEMENT } from '../characters.js';

const SUBSTEPS = 4;

export function ballStars(success, seconds) {
  if (!success) return 0;
  return 1 + (seconds <= 80 ? 1 : 0) + (seconds <= 55 ? 1 : 0);
}

export const ball = {
  minPlayers: 1,
  begin(room, participants) {
    const [sx, sz] = GIANT.path[0];
    const teleport = {};
    participants.forEach((id, i) => { teleport[id] = { x: sx + 1.2 + (i % 3) * 0.9, y: 0, z: sz - 2.2 - Math.floor(i / 3) * 0.9, yaw: -0.9 }; });
    return { data: { x: sx, z: sz, vx: 0, vz: 0, cp: 0, resets: 0, pushes: {} }, teleport };
  },
  playMs() { return GIANT.timeLimit * 1000; },
  snap(a) { return [round2(a.data.x), round2(a.data.z)]; },

  tick(room, a, now, dt) {
    const d = a.data, h = dt / SUBSTEPS, R = GIANT.radius;
    const solids = solidsFor(a, now).filter(s => s.max[1] > 0.3 && s.kind !== 'deck' && s.min[1] < 1.6);
    for (let step = 0; step < SUBSTEPS; step++) {
      for (const id of a.participants) {
        const p = room.players.get(id);
        if (!p?.connected || p.y > 1.2) continue;
        const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz), contact = R + MOVEMENT.radius + 0.25;
        if (dist >= contact || dist < 1e-4) continue;
        const nx = dx / dist, nz = dz / dist;
        // Walking into the ball pushes harder than just standing against it.
        const along = Math.max(0, (p.vx || 0) * nx + (p.vz || 0) * nz);
        const accel = 3.5 + along * 3.2;
        d.vx += nx * accel * h; d.vz += nz * accel * h;
        d.pushes[id] = (d.pushes[id] || 0) + accel * h;
      }
      const damp = Math.exp(-1.1 * h);
      d.vx *= damp; d.vz *= damp;
      const speed = Math.hypot(d.vx, d.vz);
      if (speed > 5.5) { d.vx *= 5.5 / speed; d.vz *= 5.5 / speed; }
      d.x += d.vx * h; d.z += d.vz * h;
      for (const s of solids) {
        const cx = Math.max(s.min[0], Math.min(d.x, s.max[0])), cz = Math.max(s.min[2], Math.min(d.z, s.max[2]));
        let ex = d.x - cx, ez = d.z - cz;
        const e2 = ex * ex + ez * ez;
        if (e2 >= R * R) continue;
        if (e2 < 1e-8) { ex = d.x - (s.min[0] + s.max[0]) / 2; ez = d.z - (s.min[2] + s.max[2]) / 2; }
        const l = Math.hypot(ex, ez) || 1, nx = ex / l, nz = ez / l;
        d.x = cx + nx * R; d.z = cz + nz * R;
        const vn = d.vx * nx + d.vz * nz;
        if (vn < 0) { d.vx -= 1.5 * vn * nx; d.vz -= 1.5 * vn * nz; } // soft bounce
      }
    }
    // Progress along the course and forgiving resets.
    const { dist, along } = distToPath(d.x, d.z);
    const reached = Math.floor(along + 0.15);
    if (reached > d.cp && dist < GIANT.halfWidth) { d.cp = Math.min(reached, GIANT.path.length - 1); room.dirty = true; room.broadcastEvent({ kind: 'ballCp', cp: d.cp }); }
    if (dist > GIANT.halfWidth + 1.8) {
      const [px, pz] = GIANT.path[d.cp];
      Object.assign(d, { x: px, z: pz, vx: 0, vz: 0 });
      d.resets++;
      room.dirty = true;
      room.broadcastEvent({ kind: 'ballReset', cp: d.cp });
    }
    const g = GIANT.goal;
    if (d.z > g.lineZ && d.x > g.minX && d.x < g.maxX) {
      const seconds = (now - a.phaseStart) / 1000;
      credit(room, a);
      room.finishGame({ success: true, seconds: Math.round(seconds), stars: ballStars(true, seconds) });
    }
  },

  timeUp(room, a) {
    credit(room, a);
    const progress = Math.round(distToPath(a.data.x, a.data.z).along / (GIANT.path.length - 1) * 100);
    room.finishGame({ success: false, stars: 0, progress });
  }
};

function credit(room, a) {
  for (const [id, v] of Object.entries(a.data.pushes)) {
    const p = room.players.get(Number(id));
    if (p) p.stats.pushes += Math.round(v);
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
