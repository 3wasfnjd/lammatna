// Turns world/layout.json + world/model-bounds.json into a WorldDef: plain data
// describing every collider, toy, dynamic prop, zone, star and minigame spot.
// Physics (shared/physics.ts), the renderer and the tests all start from here,
// so the colliders the tests walk through are exactly the ones the game uses.
import type { V3, Q } from './math';
import { rotY, quatY, quatMul, quatAxis } from './math';

export type Bounds6 = [number, number, number, number, number, number];
export interface ModelBounds { min: V3; max: V3; nodes: Record<string, Bounds6> }
export type BoundsTable = Record<string, ModelBounds>;

export type ColliderKind = 'box' | 'trunk' | 'none' | 'bounce' | 'children' | 'dynamic' | 'joint';

export interface Behaviour { type: string; [k: string]: any }
export interface ChildRule { match: string; collider?: ColliderKind | 'exclude'; behaviour?: Behaviour; id?: string }
export interface Placement {
  id: string;
  model?: string;             // model id (public/models/<id>.glb); absent for procedural shapes
  shape?: string;             // procedural: 'ball', 'pool', 'block', 'colorFloor', 'goal', 'basket', 'steps'
  zone: string;
  pos: V3;
  rot?: number;               // degrees about +Y
  scale?: number;
  size?: V3;                  // procedural size / fit
  color?: string;
  collider: ColliderKind;
  behaviour?: Behaviour;
  children?: ChildRule[];
  mass?: number;
  sign?: boolean;             // a text sign (the world may hold at most 3)
  merge?: boolean;            // static: merge into the zone's batched mesh (default true)
  stage?: 'hall' | 'garden';
}
export interface Zone {
  id: string; icon: string; color: string; center: [number, number]; size: [number, number];
  shape: 'circle' | 'rect' | 'hex' | 'lawn'; sound: string; stage: 'hall' | 'garden';
}
export interface GameSpot { id: string; zone: string; spot: [number, number]; radius: number; [k: string]: any }
export interface WallDef { from: [number, number]; to: [number, number]; height: number; thickness: number; kind: 'wall' | 'hedge' | 'fence' }
export interface Layout {
  version: number;
  spawn: V3;
  spawnYaw: number;
  bounds: { min: [number, number]; max: [number, number] };
  gate: { x: [number, number]; z: number };
  walls: WallDef[];
  zones: Zone[];
  placements: Placement[];
  stars: V3[];
  games: GameSpot[];
  guide: [number, number][];
  alwaysLoad?: string[];
}

export interface ColliderDef {
  shape: 'box' | 'cyl' | 'ball';
  c: V3;                      // centre (world)
  h: V3;                      // half extents; cyl: [r, halfHeight, r]; ball: [r, r, r]
  q?: Q;
  tag?: string;               // 'bounce', 'tree', 'water' ...
  owner?: string;             // placement / toy id
  sensor?: boolean;
  friction?: number;
}

// Placement transform: world = pos + R(rot) * (scale * local).
export interface Xf { pos: V3; rot: number; scale: number }
export function xfPoint(xf: Xf, p: V3): V3 {
  const [x, z] = rotY(p[0] * xf.scale, p[2] * xf.scale, xf.rot);
  return [xf.pos[0] + x, xf.pos[1] + p[1] * xf.scale, xf.pos[2] + z];
}
export function xfDir(xf: Xf, d: V3): V3 {
  const [x, z] = rotY(d[0], d[2], xf.rot);
  return [x, d[1], z];
}
export function xfInverse(xf: Xf, p: V3): V3 {
  const [x, z] = rotY(p[0] - xf.pos[0], p[2] - xf.pos[2], -xf.rot);
  return [x / xf.scale, (p[1] - xf.pos[1]) / xf.scale, z / xf.scale];
}

export interface ToyDef {
  id: string;
  type: string;
  zone: string;
  model?: string;
  node?: string;              // scene child the toy lives in (for the renderer)
  xf: Xf;
  b: Bounds6;                 // model-space bounds of the toy (unscaled)
  p: Behaviour;               // behaviour params (model space, unscaled)
  parts: Record<string, Bounds6>; // model-space bounds of named moving parts
}
export interface PropDef {
  id: string;
  zone: string;
  model?: string;
  shape: 'box' | 'ball';
  half: V3;                   // box half extents (world scale) or [r,r,r]
  offset: V3;                 // collider centre relative to the model origin (world scale, unrotated)
  pos: V3; rot: number; scale: number;
  mass: number;
  color?: string;
  restitution?: number;
  tag?: string;               // 'ball', 'giant', 'basketball', 'can' ...
}
export interface RenderItem {
  id: string; model?: string; shape?: string; zone: string; stage: 'hall' | 'garden';
  xf: Xf; size?: V3; color?: string;
  exclude?: string[];         // scene child names not drawn (signs)
  moving?: string[];          // node names driven by toys/props (kept out of batching)
  static: boolean;            // true → merged into the zone batch
}
export interface WorldDef {
  layout: Layout;
  statics: ColliderDef[];
  toys: ToyDef[];
  props: PropDef[];
  render: RenderItem[];
  signs: number;
  interactives: Record<string, number>;   // zone → count of interactive objects
  playableModels: Set<string>;            // model ids that received a behaviour
}

const INTERACTIVE_COLLIDERS = new Set(['bounce', 'dynamic', 'joint']);

function unionBounds(list: Bounds6[]): Bounds6 {
  const b: Bounds6 = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const n of list) for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], n[i]); b[i + 3] = Math.max(b[i + 3], n[i + 3]); }
  return b;
}

// Model-space box → world collider (rotation about Y only).
export function boxCollider(xf: Xf, b: Bounds6, extra: Partial<ColliderDef> = {}, shrink = 0): ColliderDef {
  const c = xfPoint(xf, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
  const h: V3 = [Math.max(0.02, (b[3] - b[0]) / 2 - shrink), Math.max(0.02, (b[4] - b[1]) / 2), Math.max(0.02, (b[5] - b[2]) / 2 - shrink)].map(v => v * xf.scale) as V3;
  return { shape: 'box', c, h, q: quatY(xf.rot), ...extra };
}
export function trunkCollider(xf: Xf, b: Bounds6, extra: Partial<ColliderDef> = {}, radius?: number): ColliderDef {
  const sx = (b[3] - b[0]) * xf.scale, sz = (b[5] - b[2]) * xf.scale, height = (b[4] - Math.max(b[1], 0)) * xf.scale;
  const r = radius ?? Math.min(0.35, Math.max(0.12, 0.12 * Math.min(sx, sz)));
  const base = xfPoint(xf, [(b[0] + b[3]) / 2, Math.max(b[1], 0), (b[2] + b[5]) / 2]);
  return { shape: 'cyl', c: [base[0], base[1] + height / 2, base[2]], h: [r, height / 2, r], ...extra };
}

export function buildWorld(layout: Layout, bounds: BoundsTable): WorldDef {
  const def: WorldDef = { layout, statics: [], toys: [], props: [], render: [], signs: 0, interactives: {}, playableModels: new Set() };
  const count = (zone: string) => { def.interactives[zone] = (def.interactives[zone] || 0) + 1; };

  // Ground + walls.
  const { min, max } = layout.bounds;
  def.statics.push({ shape: 'box', c: [(min[0] + max[0]) / 2, -0.5, (min[1] + max[1]) / 2], h: [(max[0] - min[0]) / 2 + 20, 0.5, (max[1] - min[1]) / 2 + 20], tag: 'ground' });
  for (const w of layout.walls) {
    const dx = w.to[0] - w.from[0], dz = w.to[1] - w.from[1], len = Math.hypot(dx, dz);
    const a = Math.atan2(dx, dz); // yaw whose forward is the wall direction
    def.statics.push({ shape: 'box', c: [(w.from[0] + w.to[0]) / 2, w.height / 2, (w.from[1] + w.to[1]) / 2], h: [w.thickness / 2, w.height / 2, len / 2], q: quatY(a), tag: 'wall' });
  }

  for (const pl of layout.placements) {
    if (pl.sign) def.signs++;
    const stage = pl.stage || (layout.zones.find(z => z.id === pl.zone)?.stage ?? 'hall');
    const mb = pl.model ? bounds[pl.model] : undefined;
    if (pl.model && !mb) throw new Error(`No bounds for model ${pl.model} (run tools/build-models.mjs)`);
    const xf: Xf = { pos: pl.pos, rot: (pl.rot || 0) * Math.PI / 180, scale: pl.scale ?? 1 };
    const whole: Bounds6 = mb ? [...mb.min, ...mb.max] as Bounds6 : procBounds(pl);
    const item: RenderItem = { id: pl.id, model: pl.model, shape: pl.shape, zone: pl.zone, stage, xf, size: pl.size, color: pl.color, static: true, moving: [], exclude: [] };
    def.render.push(item);

    const addToy = (id: string, beh: Behaviour, b: Bounds6, scope: string | undefined) => {
      const parts: Record<string, Bounds6> = {};
      const keys: string[] = ([] as string[]).concat(beh.parts || [], beh.seats || [], beh.part ? [beh.part] : []);
      if (mb) for (const key of keys) {
        const names = Object.keys(mb.nodes).filter(n => n.includes(key) && (!scope || n.startsWith(scope)) && n !== scope);
        // Keep only the top-most matching nodes (a node's children repeat its bounds).
        const tops = names.filter(n => !names.some(o => o !== n && n.startsWith(o + '/')));
        if (tops.length) { parts[key] = unionBounds(tops.map(n => mb.nodes[n])); item.moving!.push(...tops); }
      }
      def.toys.push({ id, type: beh.type, zone: pl.zone, model: pl.model, node: scope, xf, b, p: beh, parts });
      if (!['solid', 'area'].includes(beh.type)) count(pl.zone);
      if (pl.model) def.playableModels.add(pl.model + (scope ? '#' + scope.replace(/^\d+-/, '') : ''));
    };

    switch (pl.collider) {
      case 'none': if (pl.behaviour?.type) addToy(pl.id, pl.behaviour, whole, undefined); break;
      case 'box': def.statics.push(boxCollider(xf, whole, { owner: pl.id })); break;
      case 'trunk': def.statics.push(trunkCollider(xf, whole, { owner: pl.id })); break;
      case 'bounce':
        def.statics.push(bounceCollider(xf, whole, pl.id));
        addToy(pl.id, { type: 'bounce', ...(pl.behaviour || {}) }, whole, undefined);
        break;
      case 'dynamic': {
        item.static = false;
        def.props.push(propFrom(pl, xf, whole));
        count(pl.zone);
        if (pl.model) def.playableModels.add(pl.model);
        break;
      }
      case 'joint':
        if (!pl.behaviour) throw new Error(`${pl.id}: joint collider needs a behaviour`);
        addToy(pl.id, pl.behaviour, whole, undefined);
        break;
      case 'children': {
        if (!mb) throw new Error(`${pl.id}: children collider needs a model`);
        const tops = childNames(mb);
        for (const name of tops) {
          const rule = (pl.children || []).find(r => new RegExp(r.match).test(name));
          const b = mb.nodes[name];
          const kind = rule?.collider ?? 'box';
          if (kind === 'exclude') { item.exclude!.push(name); if (/sign|notice|briefing/.test(name)) { /* removed sign */ } continue; }
          const cid = `${pl.id}:${name.replace(/^\d+-/, '').slice(0, 24)}:${name.slice(0, 3)}`;
          if (rule?.behaviour?.type) { addToy(cid, rule.behaviour, b, name); if (kind === 'none' || kind === 'joint') continue; }
          if (kind === 'none') continue;
          if (kind === 'box') def.statics.push(boxCollider(xf, b, { owner: cid }));
          else if (kind === 'trunk') def.statics.push(trunkCollider(xf, b, { owner: cid }));
          else if (kind === 'bounce') {
            def.statics.push(bounceCollider(xf, b, cid));
            if (!rule?.behaviour) addToy(cid, { type: 'bounce' }, b, name);
          } else if (kind === 'dynamic') {
            item.moving!.push(name);
            const p = propFrom({ ...pl, id: cid, collider: 'dynamic', mass: rule?.behaviour?.mass ?? 12 }, xf, b);
            p.model = pl.model; (p as any).node = name;
            def.props.push(p); count(pl.zone);
          }
        }
        break;
      }
    }
    if (pl.collider === 'box' || pl.collider === 'trunk') {
      if (pl.behaviour) addToy(pl.id, pl.behaviour, whole, undefined);
    }
  }
  return def;
}

// Tall pads (wall trampolines) push you back; flat beds push you up.
function bounceCollider(xf: Xf, b: Bounds6, owner: string): ColliderDef {
  const tall = b[4] - b[1] > 1.5 * Math.min(b[3] - b[0], b[5] - b[2]);
  return boxCollider(xf, b, { owner, tag: tall ? 'bounceWall' : 'bounce' });
}

export function childNames(mb: ModelBounds) {
  return Object.keys(mb.nodes).filter(n => /^\d{3}-/.test(n) && !n.includes('/'));
}

function procBounds(pl: Placement): Bounds6 {
  const s = pl.size || [1, 1, 1];
  if (pl.shape === 'ball') return [-s[0] / 2, 0, -s[0] / 2, s[0] / 2, s[0], s[0] / 2];
  return [-s[0] / 2, 0, -s[2] / 2, s[0] / 2, s[1], s[2] / 2];
}

function propFrom(pl: Placement, xf: Xf, b: Bounds6): PropDef {
  const sx = (b[3] - b[0]) * xf.scale, sy = (b[4] - b[1]) * xf.scale, sz = (b[5] - b[2]) * xf.scale;
  const ball = pl.shape === 'ball';
  const half: V3 = ball ? [sx / 2, sx / 2, sx / 2] : [sx / 2, sy / 2, sz / 2];
  // The body's origin sits at the bottom centre of the model (or scene child).
  const base = xfPoint(xf, [(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2]);
  const offset: V3 = [0, half[1], 0];
  const vol = ball ? 4.19 * half[0] ** 3 : sx * sy * sz;
  const mass = pl.mass ?? Math.min(40, Math.max(1.5, vol * 60));
  return {
    id: pl.id, zone: pl.zone, model: pl.model, shape: ball ? 'ball' : 'box', half, offset,
    pos: base, rot: xf.rot, scale: xf.scale, mass, color: pl.color,
    restitution: pl.behaviour?.restitution ?? (ball ? 0.7 : 0.1), tag: pl.behaviour?.tag ?? (ball ? 'ball' : 'prop')
  };
}

// Helpers for behaviours: turn a model-space point of a toy into world space.
export const toyPoint = (t: ToyDef, p: V3) => xfPoint(t.xf, p);
export function axisQuat(xf: Xf, axis: 'x' | 'y' | 'z', angle: number): Q {
  const local: V3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
  return quatMul(quatY(xf.rot), quatAxis(local, angle));
}
