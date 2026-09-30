// Print a top-down max-height map of a model: node tools/heightmap.mjs public/models/tt/slide_A.glb [cell] [nodeFilter]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const [file, cellArg = '0.25', filter = ''] = process.argv.slice(2);
const cell = +cellArg;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
const pts = [];
const scene = doc.getRoot().listScenes()[0];
scene.traverse(n => {
  const m = n.getMesh(); if (!m || (filter && !n.getName().includes(filter))) return;
  const w = n.getWorldMatrix();
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const v = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const x = w[0]*v[0]+w[4]*v[1]+w[8]*v[2]+w[12], y = w[1]*v[0]+w[5]*v[1]+w[9]*v[2]+w[13], z = w[2]*v[0]+w[6]*v[1]+w[10]*v[2]+w[14];
      pts.push([x, y, z]);
    }
  }
});
const minx = Math.min(...pts.map(p => p[0])), maxx = Math.max(...pts.map(p => p[0]));
const minz = Math.min(...pts.map(p => p[2])), maxz = Math.max(...pts.map(p => p[2]));
const W = Math.ceil((maxx - minx) / cell) + 1, H = Math.ceil((maxz - minz) / cell) + 1;
const g = Array.from({ length: H }, () => Array(W).fill(-1));
for (const [x, y, z] of pts) { const i = Math.floor((z - minz) / cell), j = Math.floor((x - minx) / cell); g[i][j] = Math.max(g[i][j], y); }
console.log(`x ${minx.toFixed(2)}..${maxx.toFixed(2)}  z ${minz.toFixed(2)}..${maxz.toFixed(2)}  cell ${cell}; rows = z ascending, cols = x ascending; value = max y*10`);
for (let i = 0; i < H; i++) console.log((minz + i * cell).toFixed(2).padStart(6) + ' ' + g[i].map(v => v < 0 ? ' .' : String(Math.round(v * 10)).padStart(2)).join(' '));
