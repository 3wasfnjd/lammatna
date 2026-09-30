// Procedural pieces of the world: floors, walls, hedges, pools, goals, rings,
// colour floors. Everything static is returned for batching (merged per material).
import { Mesh, CreateBox, CreateCylinder, CreateDisc, CreateGround, CreateTorus, CreateSphere, Vector3, Quaternion, Color4, Color3, DynamicTexture, StandardMaterial, type Scene } from '../babylon';
import type { Assets } from './assets';
import type { RenderItem, Layout, Zone } from '../../../shared/world';

export interface Built { statics: Mesh[]; live: Mesh[] }

const place = (m: Mesh, it: RenderItem, y = 0) => {
  m.position.set(it.xf.pos[0], it.xf.pos[1] + y, it.xf.pos[2]);
  m.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), it.xf.rot);
  return m;
};

// Zone floors: each zone is recognisable by its shape and colour.
export function buildFloors(scene: Scene, a: Assets, layout: Layout): Built {
  const out: Built = { statics: [], live: [] };
  const hall = CreateGround('hall-floor', { width: 85, height: 65 }, scene);
  hall.position.set(0, 0, 0);
  hall.material = floorMaterial(scene, 'hall-floor', '#F6E7CF', '#EAD3B1');
  out.statics.push(hall);
  const lawn = CreateGround('lawn', { width: 85, height: 59 }, scene);
  lawn.position.set(0, 0, 61.5);
  lawn.material = floorMaterial(scene, 'lawn', '#9CCB6B', '#8DBE5C');
  (lawn as any).stage = 'garden';
  out.statics.push(lawn);
  layout.zones.forEach((z: Zone, i: number) => {
    if (z.id === 'garden') return;
    const y = 0.006 + i * 0.002;
    let m: Mesh;
    if (z.shape === 'circle') m = CreateDisc('floor-' + z.id, { radius: z.size[0] / 2, tessellation: 48 }, scene);
    else if (z.shape === 'hex') m = CreateDisc('floor-' + z.id, { radius: z.size[0] / 2, tessellation: 6 }, scene);
    else m = CreateGround('floor-' + z.id, { width: z.size[0], height: z.size[1] }, scene);
    if (z.shape !== 'rect') m.rotation.x = Math.PI / 2;
    m.position.set(z.center[0], y, z.center[1]);
    m.material = a.flat(mix(z.color, '#FFFFFF', 0.25));
    out.statics.push(m);
    // A soft border ring in the zone colour.
    const ring = z.shape === 'rect'
      ? CreateGround('edge-' + z.id, { width: z.size[0] + 0.6, height: z.size[1] + 0.6 }, scene)
      : CreateDisc('edge-' + z.id, { radius: z.size[0] / 2 + 0.35, tessellation: z.shape === 'hex' ? 6 : 48 }, scene);
    if (z.shape !== 'rect') ring.rotation.x = Math.PI / 2;
    ring.position.set(z.center[0], y - 0.001, z.center[1]);
    ring.material = a.flat(z.color);
    out.statics.push(ring);
  });
  return out;
}

function floorMaterial(scene: Scene, name: string, a: string, b: string) {
  const t = new DynamicTexture(name, { width: 128, height: 128 }, scene, true);
  const g = t.getContext();
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  g.fillStyle = b; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  t.update();
  t.uScale = 40; t.vScale = 30;
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = t;
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  return m;
}

export function buildWalls(scene: Scene, a: Assets, layout: Layout): Built {
  const out: Built = { statics: [], live: [] };
  layout.walls.forEach((w, i) => {
    const dx = w.to[0] - w.from[0], dz = w.to[1] - w.from[1], len = Math.hypot(dx, dz);
    const m = CreateBox('wall' + i, { width: w.thickness, height: w.height, depth: len }, scene);
    m.position.set((w.from[0] + w.to[0]) / 2, w.height / 2, (w.from[1] + w.to[1]) / 2);
    m.rotation.y = Math.atan2(dx, dz);
    m.material = a.flat(w.kind === 'wall' ? '#FFD9B8' : '#5E9E4A');
    if (w.kind !== 'wall') (m as any).stage = 'garden';
    out.statics.push(m);
    if (w.kind === 'wall') {
      // Pastel stripe along the wall.
      const s = CreateBox('stripe' + i, { width: w.thickness + 0.06, height: 0.6, depth: len }, scene);
      s.position.set(m.position.x, 1.4, m.position.z); s.rotation.y = m.rotation.y;
      s.material = a.flat(['#FF8FB8', '#4CC9F0', '#FFD166', '#06D6A0', '#9D4EDD'][i % 5]);
      out.statics.push(s);
    }
  });
  // An arch over the north gate: you see the garden through it.
  const g = layout.gate;
  for (const x of g.x) {
    const p = CreateCylinder('gate-post', { diameter: 1.1, height: 8.4, tessellation: 12 }, scene);
    p.position.set(x, 4.2, g.z); p.material = a.flat('#FF8FB8'); out.statics.push(p);
  }
  const beam = CreateBox('gate-beam', { width: g.x[1] - g.x[0] + 1.2, height: 1, depth: 1.1 }, scene);
  beam.position.set((g.x[0] + g.x[1]) / 2, 8.4, g.z); beam.material = a.flat('#FFD166'); out.statics.push(beam);
  return out;
}

export function buildShape(scene: Scene, a: Assets, it: RenderItem): Built {
  const out: Built = { statics: [], live: [] };
  const s = it.size || [1, 1, 1];
  switch (it.shape) {
    case 'pool': case 'pond': {
      const rim = CreateCylinder(it.id + '-rim', { diameter: s[0] + 0.5, height: s[1], tessellation: 40 }, scene);
      place(rim, it, s[1] / 2); rim.material = a.flat(it.shape === 'pool' ? '#FFFFFF' : '#B8A48A'); out.statics.push(rim);
      const water = CreateDisc(it.id + '-water', { radius: s[0] / 2, tessellation: 40 }, scene);
      water.rotation.x = Math.PI / 2; water.position.set(it.xf.pos[0], s[1] + 0.02, it.xf.pos[2]);
      water.material = a.flat(it.color || '#48CAE4', { emissive: 0.35, alpha: 0.85 });
      (water as any).water = true;
      out.live.push(water);
      if (it.shape === 'pool') {
        const spout = CreateCylinder(it.id + '-spout', { diameterTop: 0.4, diameterBottom: 0.9, height: 1.3, tessellation: 16 }, scene);
        place(spout, it, 0.65); spout.material = a.flat('#FFFFFF'); out.statics.push(spout);
        const bowl = CreateCylinder(it.id + '-bowl', { diameterTop: 1.8, diameterBottom: 0.5, height: 0.35, tessellation: 24 }, scene);
        place(bowl, it, 1.45); bowl.material = a.flat('#FFD166'); out.statics.push(bowl);
      }
      break;
    }
    case 'goal': {
      for (const x of [-1.65, 1.65]) {
        const p = CreateCylinder(it.id + '-post', { diameter: 0.2, height: s[1], tessellation: 10 }, scene);
        p.position.set(...rot(it, x, s[1] / 2, 0)); p.material = a.flat('#FFFFFF'); out.statics.push(p);
      }
      const bar = CreateCylinder(it.id + '-bar', { diameter: 0.2, height: 3.5, tessellation: 10 }, scene);
      bar.position.set(...rot(it, 0, s[1], 0)); bar.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), it.xf.rot).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 2));
      bar.material = a.flat('#FFFFFF'); out.statics.push(bar);
      const net = CreateBox(it.id + '-net', { width: 3.3, height: s[1] - 0.1, depth: 0.05 }, scene);
      place(net, it, s[1] / 2); net.position.addInPlace(new Vector3(...rot(it, 0, 0, -s[2] / 2)).subtract(new Vector3(it.xf.pos[0], it.xf.pos[1], it.xf.pos[2])));
      net.material = a.flat(it.id.endsWith('w') ? '#4CC9F0' : '#FF595E', { alpha: 0.55 }); out.statics.push(net);
      break;
    }
    case 'block': {
      const m = CreateBox(it.id, { width: s[0], height: s[1], depth: s[2] }, scene);
      place(m, it, s[1] / 2); m.material = a.flat(it.color || '#FFD166'); out.statics.push(m);
      break;
    }
    case 'pit': {
      const floor = CreateBox(it.id + '-floor', { width: s[0], height: 0.05, depth: s[2] }, scene);
      place(floor, it, 0.025); floor.material = a.flat('#FFE8C2'); out.statics.push(floor);
      for (const [x, z, w, d] of [[0, -s[2] / 2, s[0], 0.25], [0, s[2] / 2, s[0], 0.25], [-s[0] / 2, 0, 0.25, s[2]], [s[0] / 2, 0, 0.25, s[2]]]) {
        const r = CreateBox(it.id + '-rim', { width: w + 0.1, height: 0.5, depth: d + 0.1 }, scene);
        r.position.set(...rot(it, x, 0.25, z)); r.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), it.xf.rot);
        r.material = a.flat(it.color || '#FB8500'); out.statics.push(r);
      }
      break;
    }
    case 'basket': case 'ring': {
      const t = CreateTorus(it.id, { diameter: s[0], thickness: it.shape === 'basket' ? 0.28 : 0.14, tessellation: 40 }, scene);
      place(t, it, it.shape === 'basket' ? 0.14 : 0.04);
      t.material = a.flat(it.color || '#FFB703', { emissive: 0.35 });
      out.statics.push(t);
      break;
    }
    case 'colorFloor': case 'paintFloor': {
      // Tiles are thin instances coloured per game state (see WorldView.updateGrids).
      const n = it.shape === 'colorFloor' ? 6 : 10;
      const tile = CreateBox(it.id, { width: 1, height: 1, depth: 1 }, scene);
      const mat = new StandardMaterial(it.id + '-mat', scene);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      tile.material = mat;
      const cw = s[0] / n, cd = s[2] / n;
      const mats = new Float32Array(16 * n * n), cols = new Float32Array(4 * n * n);
      const base = Quaternion.RotationAxis(Vector3.Up(), it.xf.rot);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const p = rot(it, -s[0] / 2 + (i + 0.5) * cw, 0.03, -s[2] / 2 + (j + 0.5) * cd);
        const m = composeMatrix(new Vector3(cw * 0.94, 0.05, cd * 0.94), base, new Vector3(...p));
        m.copyToArray(mats, k * 16);
        cols.set([1, 1, 1, 1], k * 4);
      }
      tile.thinInstanceSetBuffer('matrix', mats, 16);
      tile.thinInstanceSetBuffer('color', cols, 4);
      (tile as any).grid = { n, cols };
      out.live.push(tile);
      break;
    }
  }
  return out;
}

import { Matrix } from '../babylon';
function composeMatrix(s: Vector3, q: Quaternion, p: Vector3) { return Matrix.Compose(s, q, p); }
function rot(it: RenderItem, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(it.xf.rot), sn = Math.sin(it.xf.rot);
  return [it.xf.pos[0] + x * c + z * sn, it.xf.pos[1] + y, it.xf.pos[2] - x * sn + z * c];
}
export function mix(a: string, b: string, t: number) {
  const A = Color3.FromHexString(a), B = Color3.FromHexString(b);
  return Color3.Lerp(A, B, t).toHexString();
}

// Coloured sphere template for balls; instances carry their own colour.
export function ballTemplate(scene: Scene) {
  const m = CreateSphere('ball-template', { diameter: 1, segments: 12 }, scene);
  const mat = new StandardMaterial('ball-mat', scene);
  mat.specularColor = new Color3(0.4, 0.4, 0.4);
  mat.specularPower = 24;
  m.material = mat;
  m.registerInstancedBuffer('color', 4);
  m.instancedBuffers.color = new Color4(1, 1, 1, 1);
  return m;
}
