// Layout and pure helpers for the Aboden arcade games (hoops, shooting
// gallery, colour war). Shared by the room rules and the renderer.
import { HOOPS, BOOTH } from '../playground.js';

// ---- Basketball -----------------------------------------------------------------
export const HOOP = { threePoint: 4.6, minDist: 1.2, maxDist: 9.5, rimRadius: 0.23 };
export function nearestHoop(x, z) {
  let best = null, bd = Infinity;
  for (const h of HOOPS) { const d = Math.hypot(x - h.x, z - h.z); if (d < bd) { bd = d; best = h; } }
  return { hoop: best, dist: bd };
}
// The ideal release power grows with distance; the meter shows this sweet spot.
export function idealPower(dist) {
  return 0.34 + Math.min(1, Math.max(0, (dist - HOOP.minDist) / (HOOP.maxDist - HOOP.minDist))) * 0.52;
}
export const METER_PERIOD = 1.3; // seconds for 0 → 1 → 0
export function meterValue(seconds) {
  const k = (seconds / METER_PERIOD) % 1;
  return k < 0.5 ? k * 2 : 2 - k * 2;
}
export function shotFlight(dist) { return 0.75 + dist * 0.07; }

// ---- Shooting gallery ----------------------------------------------------------------
export const LANES = Array.from({ length: BOOTH.lanes }, (_, i) => ({ x: 12.4 + i * 1.6, z: 11.75 }));
const DUCK_L = 7, DUCK_SPEED = 1.5;
export const GALLERY_TARGETS = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, kind: 'can', x: 12.5 + i * 1.3, y: 1.35, z: 16.95, r: 0.2, pts: 10 })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, kind: 'duck', offset: i * 3.5, y: 2.15, z: 17.0, r: 0.3, pts: 25 })),
  ...[13.2, 15.5, 17.8].map((x, i) => ({ id: `b${i}`, kind: 'board', x, y: 3.0, z: 17.2, r: 0.45, pts: 15, bull: 0.15, bullPts: 35 }))
];
export function targetPos(t, seconds) {
  if (t.kind !== 'duck') return { x: t.x, y: t.y, z: t.z, dir: 0 };
  const u = (seconds * DUCK_SPEED + t.offset) % (2 * DUCK_L);
  const along = u < DUCK_L ? u : 2 * DUCK_L - u;
  return { x: 12 + along, y: t.y, z: t.z, dir: u < DUCK_L ? 1 : -1 };
}
// Ray (origin o, unit direction d) against a sphere; returns distance or Infinity.
export function raySphere(o, d, c, r) {
  const ox = o[0] - c.x, oy = o[1] - c.y, oz = o[2] - c.z;
  const b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

// ---- Colour war --------------------------------------------------------------------------
export const PAINT = { speed: 13, range: 13, radius: 0.55, freeze: 1.6, cooldown: 0.55, time: 90 };
export const TEAM_COLORS = { A: '#F2735F', B: '#2BB5B0' };
export const TEAM_NAMES = { A: 'الفريق المرجاني', B: 'الفريق الفيروزي' };
export function teamSpawn(team, i) {
  return team === 'A' ? { x: -4.2, y: 0, z: -2 + i * 1.2, yaw: Math.PI / 2 } : { x: 4.2, y: 0, z: -2 + i * 1.2, yaw: -Math.PI / 2 };
}
