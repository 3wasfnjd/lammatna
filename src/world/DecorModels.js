// Loads decorative GLB/glTF props from a data-only layout.
// Placements may ask for lightweight colliders (`collide`); those are added to
// the local movement/camera solids only and never change room or minigame state.
import { TransformNode, Mesh } from '../babylon.js';
import { SOLIDS } from '../../shared/playground.js';
import { BOUNCE_PADS } from '../../shared/physics.js';

let supportPromise;
function gltfSupport() {
  supportPromise ??= import('../characters/glbSupport.js');
  return supportPromise;
}

function safeSize(v) {
  return Number.isFinite(v) && Math.abs(v) > 1e-5 ? Math.abs(v) : 1;
}

async function loadContainer(scene, url, cache) {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const { LoadAssetContainerAsync } = await gltfSupport();
      return LoadAssetContainerAsync(url, scene);
    })());
  }
  return cache.get(url);
}

function fitAndPlace(root, placement) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scaling.setAll(1);
  root.computeWorldMatrix(true);

  const first = root.getHierarchyBoundingVectors(true);
  const size = first.max.subtract(first.min);

  if (Array.isArray(placement.targetSize) && placement.targetSize.length === 3) {
    root.scaling.set(
      placement.targetSize[0] / safeSize(size.x),
      placement.targetSize[1] / safeSize(size.y),
      placement.targetSize[2] / safeSize(size.z)
    );
  } else {
    root.scaling.setAll(Number.isFinite(placement.scale) ? placement.scale : 1);
  }

  const rot = placement.rotation || [0, placement.rotationY || 0, 0];
  root.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  const p = placement.position || [0, 0, 0];
  root.position.set(p[0] || 0, 0, p[2] || 0);
  root.computeWorldMatrix(true);

  // Ground the imported model at the requested Y after scale/rotation.
  // Starter scenes (`origin: true`) keep their own floor level instead.
  if (!placement.origin) {
    const grounded = root.getHierarchyBoundingVectors(true);
    root.position.y += (p[1] || 0) - grounded.min.y;
  } else root.position.y = p[1] || 0;
  root.computeWorldMatrix(true);
}

// Children of starter scenes that are flooring, lighting rigs or flat mats: no collider.
const WALKABLE = /floor|tile|lawn|path|surface|truss|mat-set|pad-strip|rug|edge-piece|court-edge|flower-bed|queue-rail|sign-set|safety-sign/;
const BOUNCY = /trampoline-bed|performance-trampoline|angled-trampoline|airbag/;

function boxOf(node) {
  node.computeWorldMatrix(true);
  const { min, max } = node.getHierarchyBoundingVectors(true);
  return { min: [min.x, Math.max(0, min.y), min.z], max: [max.x, max.y, max.z] };
}

function addColliders(root, placement) {
  const mode = placement.collide;
  if (!mode) return 0;
  const solids = [];
  if (mode === 'box') solids.push(boxOf(root));
  else if (mode === 'trunk') {
    const b = boxOf(root), cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    solids.push({ min: [cx - 0.25, 0, cz - 0.25], max: [cx + 0.25, Math.min(b.max[1], 2.5), cz + 0.25] });
  } else if (mode === 'children') {
    // Starter scenes: one wrapper node holds every prop as a direct child.
    let holder = root;
    while (holder.getChildren().length === 1) holder = holder.getChildren()[0];
    for (const child of holder.getChildren()) {
      const name = (child.name || '').split(':').pop().toLowerCase();
      if (WALKABLE.test(name)) continue;
      const b = boxOf(child);
      const h = b.max[1] - b.min[1], w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      if (!Number.isFinite(h) || w * d < 0.02 || b.min[1] > 2) continue; // tiny or overhead
      if (BOUNCY.test(name)) {
        // A trampoline is a low walkable top that throws you back up.
        const top = Math.min(0.42, Math.max(0.15, b.max[1]));
        const pad = { min: [b.min[0] + 0.15, 0, b.min[2] + 0.15], max: [b.max[0] - 0.15, top, b.max[2] - 0.15] };
        BOUNCE_PADS.push({ ...pad, power: 11 });
        solids.push(pad);
        continue;
      }
      solids.push(b);
    }
  }
  for (const s of solids) SOLIDS.push({ kind: 'decor', ...s, source: placement.id });
  return solids.length;
}

// Merge a big starter scene into a handful of meshes (one per material and vertex layout).
function mergeByMaterial(root) {
  const groups = new Map(), out = [];
  for (const mesh of root.getChildMeshes(false)) {
    if (!(mesh instanceof Mesh) || !mesh.material || !mesh.getTotalVertices()) { out.push(mesh); continue; }
    const key = `${mesh.material.uniqueId}|${mesh.getVerticesDataKinds().sort().join()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }
  for (const list of groups.values()) {
    if (list.length < 2) { out.push(...list); continue; }
    // Vertices are baked in world space, so the merged mesh stays unparented.
    const merged = Mesh.MergeMeshes(list, true, true);
    if (merged) { merged.name = `${root.name}:merged`; out.push(merged); }
  }
  return out;
}

export async function loadDecorModels(scene, layoutUrl = 'assets/imported/decor/layout.json') {
  const response = await fetch(layoutUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Decor layout failed: ${response.status}`);
  const layout = await response.json();
  const cache = new Map();
  const roots = [];

  for (const placement of layout.placements || []) {
    try {
      const container = await loadContainer(scene, placement.model, cache);
      const root = new TransformNode(`decor:${placement.id}`, scene);
      const entries = container.instantiateModelsToScene(
        name => `decor:${placement.id}:${name}`,
        false,
        { doNotInstantiate: true }
      );
      for (const node of entries.rootNodes) node.parent = root;
      for (const group of entries.animationGroups || []) group.stop();

      fitAndPlace(root, placement);
      addColliders(root, placement);
      const meshes = placement.merge ? mergeByMaterial(root) : root.getChildMeshes(false);
      for (const mesh of meshes) {
        mesh.isPickable = false;
        if (mesh instanceof Mesh) mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
      }
      root.freezeWorldMatrix();
      roots.push(root);
    } catch (err) {
      console.warn(`[lammatna] decor ${placement.id} failed`, err);
    }
  }

  scene.metadata = { ...(scene.metadata || {}), bouncePads: BOUNCE_PADS }; // handy for debugging/tests
  return roots;
}
