// Inspect a character GLB before wiring it into shared/characters.js:
// size and orientation, rig (skins / joints), animation clips, and a
// suggested config block.  Usage: node tools/inspect-glb.mjs path/to/model.glb [characterId]
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ANIMATION_STATES, CHARACTERS } from '../shared/characters.js';

export function parseGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + jsonLength)));
}

// Walk the node tree applying translation/scale (rotation ignored for a quick estimate).
export function summarise(gltf) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = (index, offset, scale) => {
    const node = gltf.nodes[index];
    const t = node.translation || [0, 0, 0], s = node.scale || [1, 1, 1];
    const o = offset.map((v, i) => v + t[i] * scale[i]), sc = scale.map((v, i) => v * s[i]);
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc?.min) continue;
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], o[i] + acc.min[i] * sc[i]);
          max[i] = Math.max(max[i], o[i] + acc.max[i] * sc[i]);
        }
      }
    }
    for (const child of node.children || []) visit(child, o, sc);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const root of scene?.nodes || []) visit(root, [0, 0, 0], [1, 1, 1]);
  const size = max.map((v, i) => v - min[i]);
  const joints = (gltf.skins || []).flatMap(s => s.joints.map(j => gltf.nodes[j].name || `node${j}`));
  const animations = (gltf.animations || []).map((a, i) => a.name || `animation${i}`);
  return { min, max, size, meshes: gltf.meshes?.length || 0, skins: gltf.skins?.length || 0, joints, animations, materials: gltf.materials?.length || 0 };
}

// Match clip names to our states by common naming conventions.
export function suggestMapping(animations) {
  const hints = {
    idle: ['idle', 'stand', 'breath'], walk: ['walk'], run: ['run', 'jog', 'sprint'], jump: ['jump'], fall: ['fall', 'air'],
    land: ['land'], sit: ['sit'], swing: ['swing'], slide: ['slide'], carry: ['carry', 'hold'], carryWalk: ['carrywalk', 'carry_walk', 'carrying'],
    wave: ['wave', 'hello'], laugh: ['laugh'], clap: ['clap'], celebrate: ['celebrat', 'cheer', 'victory', 'dance']
  };
  const mapping = {};
  for (const state of ANIMATION_STATES) {
    const found = animations.find(a => hints[state].some(h => a.toLowerCase().replace(/[^a-z_]/g, '').includes(h)));
    if (found) mapping[state] = found;
  }
  return mapping;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, id] = process.argv.slice(2);
  if (!file) { console.log('Usage: node tools/inspect-glb.mjs model.glb [papa|mama|nasser|joud|najd]'); process.exit(1); }
  const gltf = parseGlb(await readFile(file));
  const info = summarise(gltf);
  const upAxis = info.size[1] >= Math.max(info.size[0], info.size[2]) ? 'Y (ok)' : info.size[2] > info.size[1] ? 'Z — probably needs rotation' : 'unclear';
  console.log(`${basename(file)}
  size (x, y, z): ${info.size.map(v => v.toFixed(3)).join(', ')}  → height ${info.size[1].toFixed(3)} (up axis: ${upAxis})
  feet at y = ${info.min[1].toFixed(3)}
  meshes ${info.meshes}, materials ${info.materials}, skins ${info.skins}, joints ${info.joints.length}
  animations: ${info.animations.join(', ') || '(none)'}`);
  if (info.joints.length) console.log(`  hand-like joints: ${info.joints.filter(j => /hand/i.test(j)).join(', ') || '(none found)'}`);
  const mapping = suggestMapping(info.animations);
  const missing = ANIMATION_STATES.filter(s => !mapping[s]);
  const target = id && CHARACTERS[id] ? CHARACTERS[id].look.height : info.size[1];
  const hand = info.joints.find(j => /right.?hand/i.test(j)) || info.joints.find(j => /hand/i.test(j));
  console.log(`\nSuggested model block for shared/characters.js${id ? ` (${id})` : ''}:
model: {
  type: 'glb', url: 'assets/characters/${basename(file)}',
  targetHeight: ${target.toFixed(2)}, rotationY: 0, offset: [0, 0, 0],
  animations: ${JSON.stringify(mapping)},
  attach: ${hand ? `{ carry: '${hand}' }` : '{}'}
}`);
  if (missing.length) console.log(`\nStates without a clip (fall back to the nearest clip): ${missing.join(', ')}`);
}
