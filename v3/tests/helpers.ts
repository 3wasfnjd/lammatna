import { initPhysics, RAPIER } from '../shared/rapier';
import { worldDef } from '../shared/worldData';
import { Sim, type PlayerSim } from '../shared/sim';
import { MOVE, SIM_HZ, BTN } from '../shared/constants';
import type { V3 } from '../shared/math';

export async function makeSim() {
  await initPhysics();
  return new Sim(worldDef(), 'authority');
}
export function steps(sim: Sim, n: number, inputs: Record<string, { mx?: number; mz?: number; b?: number }> = {}) {
  for (let i = 0; i < n; i++) {
    const m = new Map();
    for (const [id, f] of Object.entries(inputs)) m.set(id, { seq: sim.tick + 1, mx: f.mx || 0, mz: f.mz || 0, b: f.b || 0 });
    sim.step(m);
  }
}
export const seconds = (s: number) => Math.round(s * SIM_HZ);
export function press(sim: Sim, id: string, bit: number, hold: Record<string, number> = {}) {
  steps(sim, 1, { [id]: { b: bit, ...hold } });
  steps(sim, 1, { [id]: { b: 0, ...hold } });
}
export const interact = (sim: Sim, id: string) => press(sim, id, BTN.interact);
export const jump = (sim: Sim, id: string) => press(sim, id, BTN.jump);

// ------------------------------------------------------------ walk grid over the real colliders
export interface Grid { x0: number; z0: number; cell: number; w: number; h: number; free: Uint8Array }
export function walkGrid(sim: Sim, cell = 0.5): Grid {
  sim.world.step();   // scene queries only see colliders after a step
  const { min, max } = sim.def.layout.bounds;
  const w = Math.ceil((max[0] - min[0]) / cell), h = Math.ceil((max[1] - min[1]) / cell);
  const free = new Uint8Array(w * h);
  const r = MOVE.radius + 0.15;
  const shape = new RAPIER.Capsule(MOVE.halfHeight, r);
  const lift = MOVE.stepHeight + 0.02;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = min[0] + (i + 0.5) * cell, z = min[1] + (j + 0.5) * cell;
    let hit = false;
    sim.world.intersectionsWithShape({ x, y: lift + MOVE.halfHeight + r, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, c => {
      const meta = sim.meta.get(c.handle);
      if (!meta || meta.kind !== 'static') return true;     // props, toy bodies and players move out of the way
      hit = true; return false;                            // (trampolines too: you bounce, you don't walk)
    });
    // Bounce surfaces are for bouncing, not for walking through.
    if (!hit) sim.world.intersectionsWithShape({ x, y: 0.3, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cylinder(0.25, r), c => {
      if (sim.meta.get(c.handle)?.tag === 'bounce') { hit = true; return false; }
      return true;
    });
    free[j * w + i] = hit ? 0 : 1;
  }
  return { x0: min[0], z0: min[1], cell, w, h, free };
}
export function toCell(g: Grid, x: number, z: number) { return [Math.floor((x - g.x0) / g.cell), Math.floor((z - g.z0) / g.cell)]; }
export function cellCenter(g: Grid, i: number, j: number): [number, number] { return [g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell]; }
// Cells reachable from a point (flood fill).
export function reachable(g: Grid, from: [number, number]): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const [si, sj] = toCell(g, ...from);
  const q = [sj * g.w + si]; out[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!, i = k % g.w, j = Math.floor(k / g.w);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * g.w + a;
      if (a >= 0 && b >= 0 && a < g.w && b < g.h && g.free[n] && !out[n]) { out[n] = 1; q.push(n); }
    }
  }
  return out;
}
export function nearestFree(g: Grid, x: number, z: number, within?: Uint8Array): [number, number] {
  const [ci, cj] = toCell(g, x, z);
  for (let r = 0; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = ci + di, j = cj + dj;
    if (i >= 0 && j >= 0 && i < g.w && j < g.h && g.free[j * g.w + i] && (!within || within[j * g.w + i])) return cellCenter(g, i, j);
  }
  throw new Error(`no free cell near ${x},${z}`);
}
// A* with 8 neighbours; diagonals need both orthogonal cells free.
export function findPath(g: Grid, from: [number, number], to: [number, number]): [number, number][] | null {
  const [si, sj] = toCell(g, ...from), [ti, tj] = toCell(g, ...to);
  const idx = (i: number, j: number) => j * g.w + i;
  const open: number[] = [idx(si, sj)];
  const gs = new Float64Array(g.w * g.h).fill(Infinity), came = new Int32Array(g.w * g.h).fill(-1);
  const closed = new Uint8Array(g.w * g.h);
  gs[idx(si, sj)] = 0;
  const hf = (k: number) => Math.hypot(k % g.w - ti, Math.floor(k / g.w) - tj);
  const fs = (k: number) => gs[k] + hf(k);
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (fs(open[k]) < fs(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === idx(ti, tj)) {
      const out: [number, number][] = [];
      for (let k = cur; k !== -1; k = came[k]) out.unshift(cellCenter(g, k % g.w, Math.floor(k / g.w)));
      return out;
    }
    closed[cur] = 1;
    const ci = cur % g.w, cj = Math.floor(cur / g.w);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const k = idx(i, j);
      if (!g.free[k] || closed[k]) continue;
      if (di && dj && (!g.free[idx(ci + di, cj)] || !g.free[idx(ci, cj + dj)])) continue;
      const ng = gs[cur] + (di && dj ? 1.414 : 1);
      if (ng < gs[k]) { gs[k] = ng; came[k] = cur; if (!open.includes(k)) open.push(k); }
    }
  }
  return null;
}
// Drive a player along a path with the real character controller.
export function walkPath(sim: Sim, p: PlayerSim, path: [number, number][], maxSeconds = 90) {
  let k = 0, stuck = 0, last: V3 = [...p.pos] as V3;
  for (let t = 0; t < seconds(maxSeconds); t++) {
    // Look ahead to the furthest waypoint within 3 m to smooth the grid path.
    while (k < path.length - 1 && Math.hypot(path[k][0] - p.pos[0], path[k][1] - p.pos[2]) < 0.45) k++;
    const tgt = path[k];
    const dx = tgt[0] - p.pos[0], dz = tgt[1] - p.pos[2], d = Math.hypot(dx, dz);
    if (k === path.length - 1 && d < 0.8) return { ok: true, t: t / 60 };
    steps(sim, 1, { [p.id]: { mx: dx / (d || 1), mz: dz / (d || 1) } });
    if (p.mode !== 'walk' && p.mode !== 'air') { sim.release(p); p.mode = 'walk'; }   // no detours onto slides/bars
    if (t % 60 === 59) {
      stuck = Math.hypot(p.pos[0] - last[0], p.pos[2] - last[2]) < 0.4 ? stuck + 1 : 0;
      last = [...p.pos] as V3;
      if (stuck >= 3) return { ok: false, t: t / 60, at: [...p.pos], k, of: path.length };
    }
  }
  return { ok: false, t: maxSeconds, at: [...p.pos], k, of: path.length };
}
