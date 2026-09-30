// Print each child of a starter scene with its world bounds: node tools/dump-children.mjs file.glb
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
const scene = doc.getRoot().listScenes()[0];
let tops = scene.listChildren();
if (tops.length === 1) tops = tops[0].listChildren();
for (const n of tops) {
  const b = getBounds(n);
  const c = b.min.map((v, i) => ((v + b.max[i]) / 2).toFixed(2));
  const s = b.min.map((v, i) => (b.max[i] - v).toFixed(2));
  console.log(`${n.getName().padEnd(34)} c ${c.join(',').padEnd(20)} s ${s.join(',').padEnd(18)} kids ${n.listChildren().length} mesh ${n.getMesh() ? n.getMesh().listPrimitives().map(p => p.getMaterial()?.getName()).join('+') : '-'}`);
}
