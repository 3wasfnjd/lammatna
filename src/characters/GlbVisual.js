// Final-asset visual: a GLB configured in shared/characters.js. It exposes the
// same interface as PlaceholderVisual so controllers, cameras and multiplayer
// never know which one they are driving.
import { TransformNode, Vector3 } from '../babylon.js';
import { customizeGlb } from './glbCustomize.js';

// Missing clips fall back to the nearest sensible one.
const FALLBACK = {
  run: 'walk', carryWalk: 'walk', carry: 'idle', land: 'idle', fall: 'jump', swing: 'sit', slide: 'sit',
  wave: 'idle', laugh: 'idle', clap: 'idle', celebrate: 'idle', jump: 'idle', sit: 'idle', walk: 'idle'
};

let loaderPromise = null;
function loadGltfSupport() {
  loaderPromise ??= import('./glbSupport.js');
  return loaderPromise;
}

export async function createGlbVisual(scene, def, model, kit) {
  const { LoadAssetContainerAsync } = await loadGltfSupport();
  const container = await LoadAssetContainerAsync(model.url, scene);
  const visual = new GlbVisual(scene, def, model, container);
  // Optional recolouring and accessories from the character config.
  await customizeGlb(visual, model, scene, kit, url => LoadAssetContainerAsync(url, scene));
  return visual;
}

export class GlbVisual {
  constructor(scene, def, model, container) {
    this.def = def;
    this.model = model;
    this.root = new TransformNode(`${def.id}-glb-root`, scene);
    this.offset = new TransformNode('glb-offset', scene);
    this.offset.parent = this.root;
    const entries = container.instantiateModelsToScene(n => `${def.id}:${n}`, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) node.parent = this.offset;
    this.meshes = this.offset.getChildMeshes(false);
    for (const m of this.meshes) m.isPickable = false;

    this.offset.rotation.y = model.rotationY || 0;
    let scale = model.scale || 1;
    this.offset.scaling.setAll(scale);
    this.offset.computeWorldMatrix(true);
    const { min, max } = this.offset.getHierarchyBoundingVectors(true);
    const height = max.y - min.y;
    if (model.targetHeight && height > 0) {
      scale *= model.targetHeight / height;
      this.offset.scaling.setAll(scale);
    }
    const o = model.offset || [0, 0, 0];
    // Stand on the floor: bounding-box feet at y = 0 unless an offset overrides it.
    this.offset.position.set(o[0], o[1] - min.y * (scale / (model.scale || 1)), o[2]);
    this.height = (model.targetHeight || height * scale);

    this.groups = new Map(entries.animationGroups.map(g => [g.name.replace(`${def.id}:`, ''), g]));
    for (const g of this.groups.values()) { g.stop(); g.setWeightForAllAnimatables(0); }
    this.current = null;
    this.fading = [];

    const bone = model.attach?.carry && this.offset.getChildTransformNodes(false).find(n => n.name.endsWith(model.attach.carry));
    this.carryAnchor = new TransformNode('carry', scene);
    if (bone) { this.carryAnchor.parent = bone; }
    else { this.carryAnchor.parent = this.root; this.carryAnchor.position.set(0, this.height * 0.55, 0.35); }
    this.seatHeight = model.seatHeight ?? this.height * 0.28;
  }

  clipFor(anim) {
    let state = anim, guard = 0;
    while (state && guard++ < 4) {
      const name = this.model.animations?.[state];
      if (name && this.groups.has(name)) return this.groups.get(name);
      state = FALLBACK[state];
    }
    return this.groups.get(this.model.animations?.idle) || null;
  }

  update(dt, anim) {
    const next = this.clipFor(anim);
    if (next !== this.current) {
      if (this.current) this.fading.push({ group: this.current, weight: 1 });
      this.current = next;
      if (next) { next.start(true); next.setWeightForAllAnimatables(0); this.currentWeight = 0; }
    }
    if (this.current) {
      this.currentWeight = Math.min(1, (this.currentWeight || 0) + dt / 0.2);
      this.current.setWeightForAllAnimatables(this.currentWeight);
    }
    this.fading = this.fading.filter(f => {
      if (f.group === this.current) return false;
      f.weight -= dt / 0.2;
      if (f.weight <= 0) { f.group.stop(); return false; }
      f.group.setWeightForAllAnimatables(f.weight);
      return true;
    });
  }

  setExpression() {}
  shadowMeshes() { return this.meshes; }
  dispose() { this.root.dispose(false, false); }
}

export { Vector3 };
