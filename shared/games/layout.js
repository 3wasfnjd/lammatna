// Geometry for the newer minigames. Pure data + helpers, shared by the room
// logic (server) and the renderer.
import { COLOR_FLOOR, BALL_COLORS, STAGE } from '../playground.js';

// ---- Colour Floor ---------------------------------------------------------------
export const FLOOR_COLORS = BALL_COLORS; // coral ●, turquoise ■, yellow ★, purple ▲

export function tileCenter(index) {
  const f = COLOR_FLOOR, c = index % f.cols, r = Math.floor(index / f.cols);
  return { x: f.x + (c - (f.cols - 1) / 2) * f.tile, z: f.z + (r - (f.rows - 1) / 2) * f.tile };
}
export function tileIndexAt(x, z) {
  const f = COLOR_FLOOR;
  const c = Math.floor((x - (f.x - f.cols * f.tile / 2)) / f.tile);
  const r = Math.floor((z - (f.z - f.rows * f.tile / 2)) / f.tile);
  return c >= 0 && c < f.cols && r >= 0 && r < f.rows ? r * f.cols + c : -1;
}
export const TILE_COUNT = COLOR_FLOOR.cols * COLOR_FLOOR.rows;

// ---- Giant Ball Challenge -----------------------------------------------------------
export const GIANT = {
  radius: 1.05,
  path: [[-4.6, -7.0], [-8.6, -4.2], [-8.9, 1.2], [-7.6, 6.2], [-3.4, 8.3], [0.9, 9.0], [2.5, 11.2]],
  halfWidth: 3.2,
  // The ball scores by crossing lineZ between the posts (on the illuminated floor).
  goal: { minX: 1.2, maxX: 3.8, lineZ: 12.9, x: 2.5, z: 13.7 },
  timeLimit: 120
};
// Soft barriers that exist only during the challenge.
export const GIANT_BARRIERS = [
  { min: [-7.3, 0, -6.3], max: [-6.6, 0.9, -4.9], color: '#9C6BD1' },
  { min: [-5.9, 0, 9.4], max: [-5.2, 0.9, 10.6], color: '#F2735F' }
];
// Slowly moving foam gates: position depends only on time since the round began.
export const GIANT_GATES = [
  { axis: 'x', from: -11.2, to: -6.2, fixed: 3.2, len: 2.2, thick: 0.5, period: 6.5, color: '#F7BE2F' },
  { axis: 'z', from: 5.9, to: 10.2, fixed: -0.6, len: 2.2, thick: 0.5, period: 5.5, color: '#2BB5B0' }
];
export function gateCenter(g, seconds) {
  const k = (1 - Math.cos(seconds / g.period * Math.PI * 2)) / 2;
  const v = g.from + (g.to - g.from) * k;
  return g.axis === 'x' ? { x: v, z: g.fixed } : { x: g.fixed, z: v };
}
export function gateBox(g, seconds) {
  const c = gateCenter(g, seconds);
  const hx = g.axis === 'x' ? g.len / 2 : g.thick / 2, hz = g.axis === 'x' ? g.thick / 2 : g.len / 2;
  return { min: [c.x - hx, 0, c.z - hz], max: [c.x + hx, 1.2, c.z + hz], color: g.color, kind: 'gate' };
}
// Goal frame posts are solid during the challenge.
export const GOAL_POSTS = [
  { min: [0.8, 0, 12.2], max: [1.2, 2.4, 12.6] },
  { min: [3.8, 0, 12.2], max: [4.2, 2.4, 12.6] },
  { min: [0.8, 0, 14.5], max: [4.2, 2.4, 14.8] }
];
export function distToPath(x, z) {
  let best = Infinity, bestIndex = 0;
  const p = GIANT.path;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) { best = d; bestIndex = i + t; }
  }
  return { dist: best, along: bestIndex };
}

// ---- Family Builders ----------------------------------------------------------------
export const BUILD = { x: -5, z: 10.4, timeLimit: 120 };
export const PIECE_SIZE = {
  cube: [1.0, 1.0, 1.0],
  plank: [3.4, 0.5, 1.0],
  star: [0.9, 0.9, 0.3]
};
// "برج النجمة": two pillars, a plank that needs two people, two more cubes, a star on top.
export const BLUEPRINT = [
  { id: 's0', kind: 'cube', x: -1.2, y: 0, color: '#2BB5B0', needs: [] },
  { id: 's1', kind: 'cube', x: 1.2, y: 0, color: '#F7BE2F', needs: [] },
  { id: 's2', kind: 'plank', x: 0, y: 1.0, color: '#F2735F', needs: ['s0', 's1'] },
  { id: 's3', kind: 'cube', x: -0.8, y: 1.5, color: '#9C6BD1', needs: ['s2'] },
  { id: 's4', kind: 'cube', x: 0.8, y: 1.5, color: '#FF8FB8', needs: ['s2'] },
  { id: 's5', kind: 'star', x: 0, y: 2.5, color: '#F7BE2F', needs: ['s3', 's4'] }
].map(s => ({ ...s, x: BUILD.x + s.x, z: BUILD.z }));
export const PIECE_SPAWNS = { s0: [-8.4, 6.0], s1: [-2.6, 6.2], s2: [-5.4, 7.4], s3: [-9.4, 8.6], s4: [-1.4, 8.6], s5: [-8.4, 12.8] };

export function pieceBox(kind, x, y, z) {
  const [w, h, d] = PIECE_SIZE[kind];
  return { min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2] };
}

// ---- Hide and Seek --------------------------------------------------------------------
export const HIDE = { hideTime: 18, seekTime: 75, findRange: 2.4 };
export function spectatorSlot(i) {
  const a = (i / 5) * Math.PI * 2;
  return { x: STAGE.x + Math.cos(a) * 1.4, y: STAGE.h, z: STAGE.z + Math.sin(a) * 1.4, yaw: Math.PI };
}
