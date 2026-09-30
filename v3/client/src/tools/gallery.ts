// Dev-only page: /gallery.html?ids=tt/slide_A,tt/swing_A_large&cols=3 lays the
// models out on a grid with labels, for checking scale and orientation.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/loaders/glTF/2.0';

const q = new URLSearchParams(location.search);
const ids = (q.get('ids') || '').split(',').filter(Boolean);
const cols = +(q.get('cols') || 4);
const cell = +(q.get('cell') || 6);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.87, 0.9, 0.93, 1);
new HemisphericLight('h', new Vector3(0.3, 1, 0.2), scene);
const rows = Math.ceil(ids.length / cols);
const cam = new ArcRotateCamera('c', -Math.PI / 2 + +(q.get('yaw') || 0.5), +(q.get('pitch') || 1.0), Math.max(cols, rows) * cell * 1.25, new Vector3((cols - 1) * cell / 2, 0, -(rows - 1) * cell / 2), scene);
cam.attachControl(canvas, true);
const g = CreateGround('g', { width: cols * cell, height: rows * cell }, scene);
g.position.set((cols - 1) * cell / 2, -0.01, -(rows - 1) * cell / 2);
const base = import.meta.env.DEV ? 'models/' : 'public/models/';
const labels: [HTMLElement, Vector3][] = [];
await Promise.all(ids.map(async (id, i) => {
  const c = await LoadAssetContainerAsync(base + id + '.glb', scene);
  c.addAllToScene();
  const root = c.meshes[0];
  const pos = new Vector3((i % cols) * cell, 0, -Math.floor(i / cols) * cell);
  root.position.addInPlace(pos);
  if (q.get('origin') !== '1') {
    const { min, max } = root.getHierarchyBoundingVectors();
    root.position.x -= (min.x + max.x) / 2 - pos.x;
    root.position.z -= (min.z + max.z) / 2 - pos.z;
  }
  const el = document.createElement('div'); el.className = 'l'; el.textContent = id; document.body.appendChild(el);
  labels.push([el, pos]);
}));
engine.runRenderLoop(() => {
  scene.render();
  for (const [el, p] of labels) {
    const s = Vector3.Project(p, Matrix.Identity(), scene.getTransformMatrix(), cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    el.style.left = s.x / engine.getHardwareScalingLevel() + 'px'; el.style.top = s.y + 'px';
  }
});
(window as any).galleryReady = true;
