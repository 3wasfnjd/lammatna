// Golden stars hidden around the playground in free play: on the tower, on
// the platforms, on blocks and in corners. Collected per device (saved locally)
// so every family member can hunt them; they come back after a while.
import { Mesh, Vector3, CreateCylinder, TransformNode } from '../babylon.js';
import { DECK_Y, PLATFORMS, BLOCKS, IGLOO, TENT, ZONES, HALL } from '../../shared/playground.js';

const A = ZONES.adventure.dx, C = ZONES.course, S = ZONES.swings;

const RESPAWN_S = 90;

// Reward exploring, climbing and jumping.
export const STAR_SPOTS = [
  [A + 12.2, DECK_Y + 0.9, 6.0], [A + 18.8, DECK_Y + 0.9, 10.2], [A + 15, DECK_Y + 0.9, 8], [A + 8.6, 2.2, 8],
  ...PLATFORMS.map(([x, z]) => [x, 1.5, z]),
  [BLOCKS[2].x, BLOCKS[2].y + BLOCKS[2].h + 0.9, BLOCKS[2].z], [BLOCKS[3].x, BLOCKS[3].h + 0.9, BLOCKS[3].z],
  [C.dx - 13.4, 1.6, C.dz - 9], [C.dx - 7.5, 1.0, C.dz - 9], [0, 1.4, 0], [IGLOO.x - 0.4, 0.9, IGLOO.z], [TENT.x - 0.6, 0.9, TENT.z + 0.4],
  [A + 12.2, 0.9, 8], [S.dx - 14, 1.4, S.dz + 11], [5, 1.0, 22], [A + 15.5, 0.8, -8.5], [A + 20, 0.8, -12.5],
  [HALL.minX + 1.5, 1.0, HALL.minZ + 1.5], [HALL.maxX - 1.5, 1.0, HALL.minZ + 1.5], [HALL.minX + 1.5, 1.0, HALL.maxZ - 1.5],
  [HALL.maxX - 1.5, 1.0, HALL.maxZ - 1.5], [-2, 1.9, 4.9],
  // Newer areas: trampolines, the arcade lounge, the cafe and the outdoor garden.
  [13, 3.2, -26], [20, 3.4, -24], [16, 1.6, 18.5], [16, 1.4, -8.8], [0, 1.2, 36], [-27, 4.8, 40], [27, 1.6, 39], [-33, 1.4, 48],
  [32, 3.3, 48], [0, 1.2, 55]
];

export class Collectibles {
  constructor(scene, kit, { onCollect, glow } = {}) {
    this.scene = scene;
    this.onCollect = onCollect || (() => {});
    this.total = STAR_SPOTS.length;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('lammatna.stars') || '{}'); } catch { /* storage blocked */ }
    this.found = saved.found || 0;          // lifetime counter
    const source = makeStar(scene, kit);
    this.stars = STAR_SPOTS.map(([x, y, z], i) => {
      const m = source.createInstance(`star${i}`);
      m.position.set(x, y, z);
      m.isPickable = false;
      glow?.(m);
      return { mesh: m, x, y, z, until: 0 };
    });
    glow?.(source);
    this.visible = true;
  }

  get collected() { return this.stars.filter(s => s.until > 0).length; }

  update(dt, time, body, enabled) {
    if (enabled !== this.visible) {
      this.visible = enabled;
      for (const s of this.stars) s.mesh.setEnabled(enabled && !s.until);
    }
    if (!enabled) return;
    for (const [i, s] of this.stars.entries()) {
      if (s.until) {
        if (time > s.until) { s.until = 0; s.mesh.setEnabled(true); s.mesh.scaling.setAll(0.01); }
        continue;
      }
      const grow = s.mesh.scaling.x < 1 ? Math.min(1, s.mesh.scaling.x + dt * 2) : 1;
      s.mesh.scaling.setAll(grow);
      s.mesh.rotation.y = time * 2 + i;
      s.mesh.position.y = s.y + Math.sin(time * 2.5 + i) * 0.12;
      if (Math.hypot(body.x - s.x, body.z - s.z) < 0.85 && body.y + 0.9 > s.y - 0.9 && body.y < s.y + 0.6) {
        s.until = time + RESPAWN_S;
        s.mesh.setEnabled(false);
        this.found++;
        try { localStorage.setItem('lammatna.stars', JSON.stringify({ found: this.found })); } catch { /* storage blocked */ }
        this.onCollect(new Vector3(s.x, s.y, s.z), this.collected, this.total);
      }
    }
  }
}

function makeStar(scene, kit) {
  // A chunky five-point star: a pentagon core with five blocky points.
  const root = new Mesh('star-src', scene);
  const mat = kit.mat('#FFC928', { gloss: 0.8, emissive: 0.45, name: 'star' });
  const parts = [];
  const core = CreateCylinder('star-core', { diameter: 0.34, height: 0.14, tessellation: 5 }, scene);
  core.rotation.x = Math.PI / 2; parts.push(core);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const tip = CreateCylinder('star-tip', { diameterTop: 0, diameterBottom: 0.2, height: 0.26, tessellation: 4 }, scene);
    tip.rotation.set(Math.PI / 2 * 0, 0, -a); tip.position.set(Math.sin(a) * 0.26, Math.cos(a) * 0.26, 0);
    tip.scaling.z = 0.6;
    parts.push(tip);
  }
  const merged = Mesh.MergeMeshes(parts, true, true);
  merged.name = 'star-src';
  merged.material = mat;
  root.dispose();
  merged.setEnabled(true);
  merged.position.y = -100; // the source itself stays out of sight
  return merged;
}

export { TransformNode };
