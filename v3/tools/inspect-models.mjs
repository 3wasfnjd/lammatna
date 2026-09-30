// Inspect every model in ../assets/imported and write docs/models.json.
// Usage: node tools/inspect-models.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const base = join(root, 'assets', 'imported');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const licences = [
  [/playground\/city-park/, 'CC0 1.0 (3dassets.dev)'],
  [/trampoline\//, 'CC0 1.0 (3dassets.dev)'],
  [/tiny-treats/, 'CC0 1.0 (Tiny Treats / Isa Lousberg)'],
  [/kenney-furniture/, 'CC0 1.0 (Kenney)'],
  [/kenney-mini-arcade/, 'CC0 1.0 (Kenney)'],
  [/kenney-mini-characters/, 'CC0 1.0 (Kenney)']
];

const files = (await walk(base)).sort();
const result = [];
for (const file of files) {
  const doc = await io.read(file);
  const r = doc.getRoot();
  const scene = r.getDefaultScene() || r.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  let tris = 0;
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    tris += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  }
  // Children: for single-root scenes list the root's children.
  let tops = scene.listChildren();
  if (tops.length === 1 && tops[0].listChildren().length) tops = tops[0].listChildren();
  const bytes = (await stat(file)).size + (file.endsWith('.gltf') ? (await stat(file.replace(/\.gltf$/, '.bin'))).size : 0);
  const rel = relative(root, file);
  result.push({
    file: rel,
    bytes,
    size,
    min: b.min.map(v => +v.toFixed(3)),
    meshes: r.listMeshes().length,
    triangles: Math.round(tris),
    children: tops.map(n => n.getName()),
    childBounds: tops.length > 20 ? tops.map(n => { const cb = getBounds(n); return { name: n.getName(), min: cb.min.map(v => +v.toFixed(3)), max: cb.max.map(v => +v.toFixed(3)) }; }) : undefined,
    materials: r.listMaterials().map(m => m.getName()),
    textures: r.listTextures().map(t => t.getURI() || t.getName() || t.getMimeType()),
    animations: r.listAnimations().map(a => a.getName()),
    skins: r.listSkins().length,
    joints: r.listSkins().flatMap(s => s.listJoints().map(j => j.getName())),
    licence: (licences.find(([re]) => re.test(rel)) || [0, '?'])[1]
  });
}
await mkdir(join(here, '..', 'docs'), { recursive: true });
await writeFile(join(here, '..', 'docs', 'models.json'), JSON.stringify(result, null, 1));
console.log(`${result.length} models`);
for (const m of result) console.log(`${m.file.replace('assets/imported/', '')} | ${(m.bytes / 1024).toFixed(0)}KB | ${m.size.join('x')} | min ${m.min.join(',')} | meshes ${m.meshes} tris ${m.triangles} | kids ${m.children.length}: ${m.children.slice(0, 8).join(',')} | mats ${m.materials.join(',')} | anim ${m.animations.length} skins ${m.skins}`);
