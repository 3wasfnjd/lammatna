// Print the node tree of selected children: node tools/dump-tree.mjs file.glb pattern
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
const re = new RegExp(process.argv[3] || '.');
const scene = doc.getRoot().listScenes()[0];
let tops = scene.listChildren();
if (tops.length === 1 && tops[0].listChildren().length) tops = tops[0].listChildren();
const show = (n, d) => {
  const b = getBounds(n);
  const f = a => a.map(v => v.toFixed(2)).join(',');
  console.log(`${'  '.repeat(d)}${n.getName()} t[${f(n.getTranslation())}] r[${f(n.getRotation())}] s[${f(n.getScale())}] min[${f(b.min)}] max[${f(b.max)}] ${n.getMesh() ? 'mesh:' + n.getMesh().listPrimitives().map(p => p.getMaterial()?.getName()).join('+') : ''}`);
  n.listChildren().forEach(c => show(c, d + 1));
};
for (const n of tops) if (re.test(n.getName())) show(n, 0);
