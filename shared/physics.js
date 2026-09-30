// Lightweight character movement against axis-aligned boxes. Deterministic and
// renderer-free so the same code runs in the browser and in tests.
import { MOVEMENT } from './characters.js';
import { SOLIDS, DISCS, inBallPit, BALL_PIT } from './playground.js';

// Trampolines: standing on one launches you up again (filled by the decor loader on the client).
export const BOUNCE_PADS = [];

export function createBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vz: 0, vy: 0, grounded: true, landed: 0, airTime: 0 };
}

function groundHeight(x, z, feet, r, solids) {
  let g = 0;
  const inset = r * 0.55;
  for (const s of solids) {
    if (s.max[1] > feet + MOVEMENT.stepHeight + 0.02) continue;
    if (x + inset < s.min[0] || x - inset > s.max[0] || z + inset < s.min[2] || z - inset > s.max[2]) continue;
    if (s.max[1] > g) g = s.max[1];
  }
  for (const d of DISCS) {
    if (d.top <= feet + MOVEMENT.stepHeight && Math.hypot(x - d.x, z - d.z) < d.r && d.top > g) g = d.top;
  }
  return g;
}

function pushOut(body, r, solids) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      if (s.max[1] <= body.y + MOVEMENT.stepHeight || s.min[1] >= body.y + MOVEMENT.bodyHeight) continue;
      const cx = Math.max(s.min[0], Math.min(body.x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(body.z, s.max[2]));
      let dx = body.x - cx, dz = body.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = r - d;
        body.x += dx / d * push; body.z += dz / d * push;
      } else {
        // Centre inside the box: leave by the nearest face.
        const opts = [[body.x - s.min[0] + r, -1, 0], [s.max[0] - body.x + r, 1, 0], [body.z - s.min[2] + r, 0, -1], [s.max[2] - body.z + r, 0, 1]];
        opts.sort((a, b) => a[0] - b[0]);
        body.x += opts[0][1] * opts[0][0]; body.z += opts[0][2] * opts[0][0];
      }
    }
  }
  return hit;
}

// input: { x, z } world-space move vector (length 0..1), jump: boolean.
export function stepBody(body, input, dt, solids = SOLIDS) {
  const r = MOVEMENT.radius;
  const len = Math.min(1, Math.hypot(input.x || 0, input.z || 0));
  let speed = len < 0.05 ? 0 : MOVEMENT.walkSpeed + (MOVEMENT.runSpeed - MOVEMENT.walkSpeed) * Math.min(1, Math.max(0, (len - 0.35) / 0.5));
  if (inBallPit(body.x, body.z) && body.y < BALL_PIT.rim + 0.05) speed *= 0.72;
  const tx = len > 0.05 ? input.x / len * speed : 0, tz = len > 0.05 ? input.z / len * speed : 0;
  // Snappy on the ground, softer in the air.
  const accel = body.grounded ? 16 : 6;
  const k = Math.min(1, accel * dt);
  body.vx += (tx - body.vx) * k; body.vz += (tz - body.vz) * k;

  const steps = Math.max(1, Math.ceil(Math.hypot(body.vx, body.vz) * dt / (r * 0.8)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    body.x += body.vx * h; body.z += body.vz * h;
    pushOut(body, r, solids);
  }

  body.landed = 0;
  if (input.jump && body.grounded) { body.vy = MOVEMENT.jumpVelocity; body.grounded = false; }
  const ground = groundHeight(body.x, body.z, body.y, r, solids);
  if (body.grounded && ground > body.y) body.y = ground; // step up
  body.vy -= MOVEMENT.gravity * dt;
  const prevY = body.y;
  body.y += body.vy * dt;
  if (body.vy > 0) {
    for (const s of solids) {
      if (s.min[1] >= prevY + MOVEMENT.bodyHeight - 0.01 && s.min[1] < body.y + MOVEMENT.bodyHeight &&
        body.x > s.min[0] - r * 0.5 && body.x < s.max[0] + r * 0.5 && body.z > s.min[2] - r * 0.5 && body.z < s.max[2] + r * 0.5) {
        body.y = s.min[1] - MOVEMENT.bodyHeight; body.vy = 0;
      }
    }
  }
  const floor = groundHeight(body.x, body.z, Math.max(prevY, body.y), r, solids);
  if (body.y <= floor + 0.001 && body.vy <= 0) {
    if (!body.grounded) body.landed = Math.min(1, body.airTime / 0.6 + 0.2);
    body.y = floor; body.vy = 0; body.grounded = true; body.airTime = 0;
    for (const pad of BOUNCE_PADS) {
      if (body.x > pad.min[0] && body.x < pad.max[0] && body.z > pad.min[2] && body.z < pad.max[2] && Math.abs(body.y - pad.max[1]) < 0.2) {
        body.vy = pad.power; body.grounded = false; body.bounced = (body.bounced || 0) + 1;
      }
    }
  } else if (body.grounded && body.y - floor < 0.12 && body.vy <= 0) {
    body.y = floor; body.vy = 0; // walk down small steps smoothly
  } else {
    body.grounded = false; body.airTime += dt;
  }
  return body;
}

// Ray against the solid boxes; returns the nearest hit distance or Infinity.
export function raycastSolids(ox, oy, oz, dx, dy, dz, maxDist, solids = SOLIDS) {
  let best = maxDist;
  for (const s of solids) {
    let tmin = 0, tmax = best;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    let ok = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < s.min[a] || o[a] > s.max[a]) { ok = false; break; }
      } else {
        let t1 = (s.min[a] - o[a]) / d[a], t2 = (s.max[a] - o[a]) / d[a];
        if (t1 > t2) [t1, t2] = [t2, t1];
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin < best && tmin > 0) best = tmin;
  }
  return best;
}
