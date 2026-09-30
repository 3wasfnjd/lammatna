// Loads decorative GLB/glTF props from a data-only layout.
// This module deliberately does not create colliders or touch gameplay state.
import { TransformNode } from '../babylon.js';

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
  const grounded = root.getHierarchyBoundingVectors(true);
  root.position.y += (p[1] || 0) - grounded.min.y;
  root.computeWorldMatrix(true);
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
      for (const mesh of root.getChildMeshes(false)) {
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
      }
      root.freezeWorldMatrix();
      roots.push(root);
    } catch (err) {
      console.warn(`[lammatna] decor ${placement.id} failed`, err);
    }
  }

  return roots;
}
