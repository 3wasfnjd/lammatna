// Model pipeline: copies every model that world/layout.json (and the character
// list) uses from ../assets/imported into public/models/<id>.glb, packed as a
// single GLB with deduplicated data, and writes world/model-bounds.json with the
// bounds of each model and of each named node, so colliders can be built on the
// server and in tests without parsing GLBs.
//
//   node tools/build-models.mjs          only models the layout uses
//   node tools/build-models.mjs --all    every model in the catalog (gallery)
//   node tools/build-models.mjs --ktx2   also encode textures to KTX2 (ETC1S).
//     Off by default: Babylon's KTX2 transcoders load from cdn.babylonjs.com,
//     and the palette textures here are already tiny (see README).
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from './catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const v3 = join(here, '..');
const out = join(v3, 'public', 'models');
const args = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const layout = JSON.parse(await readFile(join(v3, 'world', 'layout.json'), 'utf8').catch(() => '{"placements":[]}'));
const all = catalog();
let ids;
if (args.includes('--all')) ids = Object.keys(all);
else {
  const used = new Set([...(layout.placements || []).map(p => p.model), ...(layout.alwaysLoad || [])]);
  ids = [...used].filter(Boolean);
}
const missing = ids.filter(id => !all[id]);
if (missing.length) throw new Error('Unknown model ids: ' + missing.join(', '));

const bounds = {};
const round = v => Math.round(v * 1000) / 1000;
let total = 0;
for (const id of ids.sort()) {
  const doc = await io.read(all[id]);
  await doc.transform(dedup(), prune({ keepLeaves: true }));
  // Big RGBA atlases are shrunk to 512 px (the Tiny Treats palette is 1024).
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'png', resize: [512, 512] }));
  if (args.includes('--ktx2')) {
    const { ktx2 } = await import('ktx2-encoder/gltf-transform');
    const imageDecoder = async buffer => {
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(data), width: info.width, height: info.height };
    };
    await doc.transform(ktx2({ isUASTC: false, generateMipmap: true, imageDecoder }));
  }
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const nodes = {};
  scene.traverse(n => {
    if (!n.getName() || n === scene) return;
    let hasMesh = false;
    n.traverse(c => { if (c.getMesh()) hasMesh = true; });
    if (!hasMesh) return;
    const nb = getBounds(n);
    nodes[n.getName()] = [...nb.min.map(round), ...nb.max.map(round)];
  });
  bounds[id] = { min: b.min.map(round), max: b.max.map(round), nodes };
  const file = join(out, id + '.glb');
  await mkdir(dirname(file), { recursive: true });
  await io.write(file, doc);
  total += (await stat(file)).size;
}

// Remove outputs that are no longer used.
async function clean(dir, prefix = '') {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await clean(p, prefix + e.name + '/');
    else if (e.name.endsWith('.glb') && !ids.includes(prefix + e.name.replace(/\.glb$/, ''))) await rm(p);
  }
}
if (!args.includes('--all')) await clean(out);
await writeFile(join(v3, 'world', 'model-bounds.json'), JSON.stringify(bounds));
console.log(`${ids.length} models → public/models (${(total / 1024 / 1024).toFixed(2)} MB); world/model-bounds.json written`);
