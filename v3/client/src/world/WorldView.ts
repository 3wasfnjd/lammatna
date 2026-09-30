// Renders the world from the WorldDef: loads models in two stages (the hall,
// then the garden), merges static geometry per area+material, instances
// repeated props, and drives moving parts from the mirror physics.
import {
  Mesh, InstancedMesh, TransformNode, Vector3, Quaternion, Matrix, Color3, Color4, CreateTorus, CreateCylinder, CreateSphere,
  StandardMaterial, type Scene, type AbstractMesh
} from '../babylon';
import type { Assets } from './assets';
import type { WorldDef, RenderItem, PropDef } from '../../../shared/world';
import type { NetClient } from '../net/NetClient';
import { toyParts, bodyMatrix, type PartSpec } from './poses';
import { buildFloors, buildWalls, buildShape, ballTemplate, type Built } from './procedural';
import * as T from '../../../shared/toys';

const CHUNK = 28;
const GRID_COLORS = ['#FF595E', '#1982C4', '#FFCA3A', '#8AC926'];
export const PLAYER_COLORS = ['#FF595E', '#1982C4', '#FFCA3A', '#8AC926', '#6A4C93'];

interface Moving { mesh: AbstractMesh; pose: () => Matrix; base: Matrix; inv0: Matrix }
interface PropView { index: number; mesh: AbstractMesh; base: Matrix; inv0: Matrix; ball?: number }
interface Bed { toyId: string; mesh: Mesh; y0: number; t: number }
interface Sway { toyId: string; mesh: AbstractMesh; pivot: Vector3; base: Matrix; t: number }

export class WorldView {
  scene: Scene; a: Assets; def: WorldDef; net: NetClient;
  batches = new Map<string, Mesh[]>();
  merged: Mesh[] = [];
  moving: Moving[] = [];
  props: PropView[] = [];
  beds: Bed[] = [];
  sways: Sway[] = [];
  live: Mesh[] = [];
  grids = new Map<string, Mesh>();
  piles = new Map<string, Mesh[]>();
  propTemplates = new Map<string, { mesh: Mesh; P0: Matrix }>();
  ballTpl: Mesh | null = null;
  staged = { hall: false, garden: false };
  shadowCasters: AbstractMesh[] = [];
  expectedModels = new Set<string>();

  constructor(scene: Scene, a: Assets, def: WorldDef, net: NetClient) {
    this.scene = scene; this.a = a; this.def = def; this.net = net;
    for (const it of def.render) if (it.model) this.expectedModels.add(it.model);
  }

  async loadStage(stage: 'hall' | 'garden', progress: (f: number) => void) {
    if (stage === 'hall') {
      this.addBuilt(buildFloors(this.scene, this.a, this.def.layout));
      this.addBuilt(buildWalls(this.scene, this.a, this.def.layout));
    }
    const items = this.def.render.filter(i => i.stage === stage);
    let done = 0;
    // Load all models of the stage in parallel, then place in layout order.
    const models = [...new Set(items.filter(i => i.model).map(i => i.model!))];
    await Promise.all(models.map(m => this.a.load(m).then(() => progress(++done / (models.length + 1)))));
    for (const it of items) {
      if (it.model) await this.placeModel(it);
      else this.placeShape(it);
    }
    this.flush(stage);
    this.staged[stage] = true;
    progress(1);
  }

  addBuilt(b: Built) {
    for (const m of b.statics) this.batch(m);
    for (const m of b.live) { this.live.push(m); if ((m as any).grid) this.grids.set(m.name, m); m.receiveShadows = true; }
  }

  // Untextured opaque colours become vertex colours so a whole area shares one material.
  vcMat: StandardMaterial | null = null;
  toVertexColor(m: Mesh) {
    const mat = m.material as StandardMaterial | null;
    if (!mat || !(mat instanceof StandardMaterial) || mat.diffuseTexture || mat.alpha < 1 || mat.emissiveColor.r + mat.emissiveColor.g + mat.emissiveColor.b > 0.05) return;
    if (m.material?.name.startsWith('hall-floor') || m.material?.name === 'lawn') return;
    const n = m.getTotalVertices();
    const cols = new Float32Array(n * 4);
    const c = mat.diffuseColor;
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b, 1], i * 4);
    m.setVerticesData('color', cols, false, 4);
    if (!this.vcMat) {
      this.vcMat = new StandardMaterial('vc', this.scene);
      this.vcMat.specularColor = new Color3(0.06, 0.06, 0.06);
    }
    m.material = this.vcMat;
  }

  batch(m: Mesh) {
    this.toVertexColor(m);
    m.computeWorldMatrix(true);
    const c = m.getBoundingInfo().boundingBox.centerWorld;
    const big = m.getBoundingInfo().boundingBox.extendSizeWorld.length() > CHUNK;
    const key = `${big ? 'big' : Math.floor(c.x / CHUNK) + ',' + Math.floor(c.z / CHUNK)}|${m.material?.name || 'none'}|${(m as any).stage || ''}`;
    let list = this.batches.get(key);
    if (!list) this.batches.set(key, list = []);
    list.push(m);
  }

  flush(stage: string) {
    for (const [key, list] of this.batches) {
      if (!list.length) continue;
      const mat = list[0].material;
      if (list.length > 1) sameAttributes(list);
      const merged = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = 'batch:' + key;
      merged.material = mat;
      merged.receiveShadows = true;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      if (!key.startsWith('big')) merged.addLODLevel(stage === 'garden' ? 75 : 95, null);
      this.merged.push(merged);
    }
    this.batches.clear();
  }

  placeShape(it: RenderItem) {
    const prop = this.def.props.find(p => p.id === it.id);
    if (it.shape === 'ball' && prop) { this.addBall(prop); return; }
    if (it.shape === 'pit') this.fillPit(it);
    this.addBuilt(buildShape(this.scene, this.a, it));
  }

  // Decorative balls filling a ball pit (one thin-instanced draw call).
  fillPit(it: RenderItem) {
    const s = it.size || [6, 0.5, 6];
    const src = CreateSphere('pit-balls', { diameter: 0.3, segments: 6 }, this.scene);
    const mat = new StandardMaterial('pit-balls', this.scene); mat.specularColor = new Color3(0.3, 0.3, 0.3);
    src.material = mat;
    const n = 260, mats = new Float32Array(n * 16), cols = new Float32Array(n * 4);
    const palette = [[1, 0.35, 0.37], [0.1, 0.51, 0.77], [1, 0.79, 0.23], [0.54, 0.79, 0.15], [0.9, 0.45, 0.85]];
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = Math.cos(it.xf.rot), sn = Math.sin(it.xf.rot);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * (s[0] - 0.6), z = (r() - 0.5) * (s[2] - 0.6), y = 0.16 + r() * 0.28;
      Matrix.Translation(it.xf.pos[0] + x * c + z * sn, y, it.xf.pos[2] - x * sn + z * c).copyToArray(mats, i * 16);
      cols.set([...palette[i % 5], 1], i * 4);
    }
    src.thinInstanceSetBuffer('matrix', mats, 16);
    src.thinInstanceSetBuffer('color', cols, 4);
    src.isPickable = false;
    src.addLODLevel(60, null);
  }

  addBall(p: PropDef) {
    if (!this.ballTpl) { this.ballTpl = ballTemplate(this.scene); this.ballTpl.isVisible = true; this.ballTpl.position.set(0, -50, 0); }
    const inst = this.ballTpl.createInstance('ball:' + p.id);
    inst.instancedBuffers.color = Color4.FromColor3(Color3.FromHexString(p.color || '#FF595E'), 1);
    inst.scaling.setAll(p.half[0] * 2);
    inst.position.set(p.pos[0], p.pos[1] + p.half[0], p.pos[2]);
    const index = this.net.sim.propById.get(p.id)!.index;
    this.props.push({ index, mesh: inst, base: Matrix.Identity(), inv0: Matrix.Identity(), ball: p.half[0] });
    this.shadowCasters.push(inst);
  }

  async placeModel(it: RenderItem) {
    const cont = await this.a.load(it.model!);
    const inst = cont.instantiateModelsToScene(n => n, false, { doNotInstantiate: true });
    const holder = new TransformNode('place:' + it.id, this.scene);
    holder.position.set(...it.xf.pos);
    holder.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), it.xf.rot);
    holder.scaling.setAll(it.xf.scale);
    for (const r of inst.rootNodes) r.parent = holder;
    holder.computeWorldMatrix(true);
    // glTF re-used meshes arrive as instances: turn them into real meshes so they can be merged.
    for (const m of holder.getChildMeshes(false)) {
      if (m instanceof InstancedMesh) {
        const c = m.sourceMesh.clone(m.name, m.parent, true, false);
        c.position.copyFrom(m.position);
        c.rotationQuaternion = m.rotationQuaternion ? m.rotationQuaternion.clone() : null;
        if (!c.rotationQuaternion) c.rotation.copyFrom(m.rotation);
        c.scaling.copyFrom(m.scaling);
        c.material = m.sourceMesh.material;
        m.dispose();
      }
    }
    const meshes = holder.getChildMeshes(false).filter(m => m instanceof Mesh && m.getTotalVertices() > 0) as Mesh[];
    for (const m of meshes) { m.computeWorldMatrix(true); m.material = this.a.canonical(it.model!, m.material); }

    const toys = this.net.sim.toys.filter(t => t.id === it.id || t.id.startsWith(it.id + ':'));
    const props = this.def.props.filter(p => p.id === it.id || (p.id.startsWith(it.id + ':') && (p as any).node));
    const groups = new Map<string, { spec?: PartSpec; toy?: T.Toy; prop?: PropDef; bed?: T.Toy; sway?: T.Toy; meshes: Mesh[] }>();
    const addTo = (key: string, g: any, m: Mesh) => { if (!groups.has(key)) groups.set(key, { ...g, meshes: [] }); groups.get(key)!.meshes.push(m); };

    for (const m of meshes) {
      const names: string[] = [];
      for (let n: any = m; n && n !== holder; n = n.parent) names.push(n.name.replace(/_primitive\d+$/, ''));
      if (it.exclude?.some(e => names.includes(e))) { m.dispose(); continue; }
      let placed = false;
      for (const toy of toys) {
        const scope = toy.def.node;
        if (scope && !names.includes(scope)) continue;
        const specs = toyParts(toy);
        specs.forEach((spec, si) => {
          if (placed) return;
          if (spec.match === null || names.some(n => n.includes(spec.match!) && (!scope || n.startsWith(scope)))) { addTo(`${toy.id}#${si}`, { spec, toy }, m); placed = true; }
        });
        if (placed) break;
        if (toy instanceof T.TreeToy) { addTo(`${toy.id}#tree`, { sway: toy }, m); placed = true; break; }
        if (toy instanceof T.BounceToy && isBed(m, toy)) { addTo(`${toy.id}#bed:${m.uniqueId}`, { bed: toy }, m); placed = true; break; }
      }
      if (placed) continue;
      const prop = props.find(p => p.id === it.id || names.includes((p as any).node));
      if (prop) { addTo('prop:' + prop.id, { prop }, m); continue; }
      (m as any).stage = it.stage;
      m.setParent(null);
      this.batch(m);
    }

    for (const [key, g] of groups) {
      const mesh = this.mergeGroup(key, g.meshes);
      if (!mesh) continue;
      if (g.spec) this.addMoving(mesh, g.spec);
      else if (g.prop) this.addPropMesh(g.prop, mesh, it);
      else if (g.bed) this.beds.push({ toyId: g.bed.id, mesh, y0: mesh.position.y, t: -9 });
      else if (g.sway) {
        const b = mesh.getBoundingInfo().boundingBox;
        const pivot = new Vector3(b.centerWorld.x, b.minimumWorld.y, b.centerWorld.z);
        this.sways.push({ toyId: g.sway.id, mesh, pivot, base: mesh.computeWorldMatrix(true).clone(), t: -9 });
        mesh.addLODLevel(80, null);
      }
    }
    holder.getChildTransformNodes(false).forEach(n => { if (!n.getChildMeshes().length) n.dispose(); });
  }

  mergeGroup(key: string, list: Mesh[]): Mesh | null {
    for (const m of list) { m.computeWorldMatrix(true); m.setParent(null); this.toVertexColor(m); }
    if (list.length > 1) sameAttributes(list);
    const mesh = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true, undefined, false, true);
    if (!mesh) return null;
    if (list.length === 1) mesh.bakeCurrentTransformIntoVertices();
    mesh.name = key;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    // Small moving things vanish in the distance (the static scenery stays).
    mesh.addLODLevel(55, null);
    return mesh;
  }

  addMoving(mesh: Mesh, spec: PartSpec) {
    let p0 = spec.pose();
    if (spec.center) {
      const c = mesh.getBoundingInfo().boundingBox.centerWorld;
      const r = new Quaternion(); p0.decompose(undefined, r, undefined);
      p0 = Matrix.Compose(Vector3.One(), r, c.clone());
    }
    this.moving.push({ mesh, pose: spec.pose, base: Matrix.Identity(), inv0: p0.clone().invert() });
    mesh.rotationQuaternion = new Quaternion();
    this.shadowCasters.push(mesh);
  }

  // Dynamic props: the first of a model is a merged mesh, later ones are instances of it.
  addPropMesh(p: PropDef, mesh: Mesh, it: RenderItem) {
    const sp = this.net.sim.propById.get(p.id)!;
    const b0 = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), p.rot), new Vector3(...p.pos));
    let view: PropView;
    const wholeModel = p.id === it.id && it.model;
    const tpl = wholeModel ? this.propTemplates.get(it.model!) : undefined;
    const P = Matrix.Compose(new Vector3(it.xf.scale, it.xf.scale, it.xf.scale), Quaternion.RotationAxis(Vector3.Up(), it.xf.rot), new Vector3(...it.xf.pos));
    if (tpl) {
      mesh.dispose();
      const inst = tpl.mesh.createInstance('prop:' + p.id);
      view = { index: sp.index, mesh: inst, base: tpl.P0.clone().invert().multiply(P), inv0: b0.invert() };
    } else {
      if (wholeModel) this.propTemplates.set(it.model!, { mesh, P0: P });
      view = { index: sp.index, mesh, base: Matrix.Identity(), inv0: b0.invert() };
    }
    view.mesh.rotationQuaternion = new Quaternion();
    this.props.push(view);
    this.shadowCasters.push(view.mesh);
  }

  // ------------------------------------------------------------ per frame
  private tmpS = new Vector3(); private tmpQ = new Quaternion(); private tmpP = new Vector3();
  setMatrix(mesh: AbstractMesh, m: Matrix) {
    m.decompose(this.tmpS, this.tmpQ, this.tmpP);
    mesh.scaling.copyFrom(this.tmpS);
    (mesh.rotationQuaternion ||= new Quaternion()).copyFrom(this.tmpQ);
    mesh.position.copyFrom(this.tmpP);
  }

  update(dt: number, time: number) {
    for (const mv of this.moving) this.setMatrix(mv.mesh, mv.base.multiply(mv.inv0).multiply(mv.pose()));
    const views = this.net.propViews();
    for (const pv of this.props) {
      const pr = this.net.sim.props[pv.index];
      const v = views.get(pv.index);
      const body = v ? Matrix.Compose(Vector3.One(), new Quaternion(v[3], v[4], v[5], v[6]), new Vector3(v[0], v[1], v[2])) : bodyMatrix(pr.body);
      if (pv.ball) {
        const q = new Quaternion(); const p = new Vector3(); body.decompose(undefined, q, p);
        pv.mesh.position.set(p.x, p.y + pv.ball, p.z);
        (pv.mesh.rotationQuaternion ||= new Quaternion()).copyFrom(q);
      } else this.setMatrix(pv.mesh, pv.base.multiply(pv.inv0).multiply(body));
    }
    for (const b of this.beds) {
      const age = time - b.t;
      const dip = age < 0.6 ? Math.sin(Math.min(1, age / 0.6) * Math.PI) * 0.16 * Math.exp(-age * 2) : 0;
      b.mesh.position.y = b.y0 - dip;
    }
    for (const s of this.sways) {
      const age = time - s.t;
      if (age > 3) continue;
      const a = Math.sin(age * 14) * 0.06 * Math.exp(-age * 1.6);
      const r = Matrix.Translation(-s.pivot.x, -s.pivot.y, -s.pivot.z).multiply(Matrix.RotationAxis(new Vector3(1, 0, 0.4).normalize(), a)).multiply(Matrix.Translation(s.pivot.x, s.pivot.y, s.pivot.z));
      this.setMatrix(s.mesh, s.base.multiply(r));
    }
    for (const m of this.live) if ((m as any).water) (m.material as StandardMaterial).emissiveColor.set(0.15 + Math.sin(time * 2) * 0.05, 0.35 + Math.sin(time * 2.3) * 0.05, 0.45);
    this.updateGrids(time);
    this.updatePiles();
    void dt;
  }

  bounce(toyId: string, time: number) { for (const b of this.beds) if (b.toyId === toyId) b.t = time; }
  shake(toyId: string, time: number) { for (const s of this.sways) if (s.toyId === toyId) s.t = time; }

  updateGrids(time: number) {
    for (const [id, mesh] of this.grids) {
      const toy = this.net.sim.toyById.get(id) as T.AreaToy | undefined;
      const g = (mesh as any).grid as { n: number; cols: Float32Array };
      const grid = toy?.grid || [];
      const c = new Color3();
      for (let k = 0; k < g.n * g.n; k++) {
        const v = grid.length ? grid[k] : -1;
        if (v >= 0) Color3.FromHexString(id === 'paint-arena' ? PLAYER_COLORS[v % 5] : GRID_COLORS[v % 4]).toLinearSpaceToRef(c), c.toGammaSpaceToRef(c);
        else if (id === 'color-floor') Color3.HSVtoRGBToRef(((k * 37 + time * 40) % 360), 0.55, 1, c);
        else c.set(0.62, 0.8, 0.45);
        g.cols.set([c.r, c.g, c.b, 1], k * 4);
      }
      mesh.thinInstanceBufferUpdated('color');
    }
  }

  updatePiles() {
    for (const toy of this.net.sim.toys) {
      if (!(toy instanceof T.ZoneToy) || toy.type !== 'sandbox') continue;
      let list = this.piles.get(toy.id);
      if (!list) this.piles.set(toy.id, list = []);
      const n = toy.piles.length / 3;
      while (list.length < n) {
        const m = CreateCylinder('pile', { diameterTop: 0.1, diameterBottom: 1.2, height: 1, tessellation: 10 }, this.scene);
        m.material = this.a.flat('#E9C46A');
        list.push(m);
      }
      list.forEach((m, i) => {
        m.setEnabled(i < n);
        if (i < n) { const h = toy.piles[i * 3 + 2]; m.scaling.set(0.4 + h, h, 0.4 + h); m.position.set(toy.piles[i * 3], h / 2, toy.piles[i * 3 + 1]); }
      });
    }
  }

  // Soft glowing halo under the nearest thing you can use.
  halo: Mesh | null = null;
  showHalo(at: [number, number, number] | null, time: number) {
    if (!this.halo) {
      this.halo = CreateTorus('halo', { diameter: 1.6, thickness: 0.09, tessellation: 36 }, this.scene);
      const m = new StandardMaterial('halo', this.scene);
      m.emissiveColor = new Color3(1, 0.85, 0.4); m.disableLighting = true; m.alpha = 0.8;
      this.halo.material = m; this.halo.isPickable = false;
    }
    this.halo.setEnabled(!!at);
    if (at) {
      this.halo.position.set(at[0], Math.max(0.05, at[1] < 0.3 ? 0.05 : at[1] - 0.2), at[2]);
      const s = 1 + Math.sin(time * 5) * 0.08;
      this.halo.scaling.set(s, 1, s);
    }
  }
}

// Merging needs identical vertex layouts: keep position/normal/uv, fill missing uvs.
const KEEP = ['position', 'normal', 'uv', 'color'];
function sameAttributes(list: Mesh[]) {
  for (const m of list) {
    for (const k of m.getVerticesDataKinds()) if (!KEEP.includes(k)) m.removeVerticesData(k);
    const n = m.getTotalVertices();
    if (!m.isVerticesDataPresent('uv')) m.setVerticesData('uv', new Float32Array(n * 2), false);
    if (!m.isVerticesDataPresent('normal')) m.createNormals(false);
  }
  // Colour must be all-or-nothing within a merge.
  if (list.some(m => m.isVerticesDataPresent('color')) && !list.every(m => m.isVerticesDataPresent('color')))
    for (const m of list) if (m.isVerticesDataPresent('color')) m.removeVerticesData('color');
}

// Trampoline beds: flat, wide meshes near the top of a bounce toy dip when bounced.
function isBed(m: Mesh, toy: T.Toy) {
  m.computeWorldMatrix(true);
  const bb = m.getBoundingInfo().boundingBox, e = bb.extendSizeWorld;
  const s = toy.def.xf.scale, b = toy.def.b;
  const top = toy.w([0, b[4], 0])[1];
  const area = (b[3] - b[0]) * (b[5] - b[2]) * s * s;
  return e.y < 0.06 && 4 * e.x * e.z > area * 0.3 && Math.abs(bb.maximumWorld.y - top) < 0.25;
}
