// Model ids used by world/layout.json → source files in ../assets/imported.
//   tt/<name>   Tiny Treats Fun Playground     arc/<name>  Kenney Mini Arcade
//   fur/<name>  Kenney Furniture Kit           chr/<name>  Kenney Mini Characters
//   scn/park, scn/trampoline                   the two starter scenes
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'imported');
const packs = [
  ['tt', 'playground/tiny-treats-fun-playground', '.gltf'],
  ['arc', 'arcade/kenney-mini-arcade', '.glb'],
  ['fur', 'furniture/kenney-furniture-kit', '.glb'],
  ['chr', 'characters/kenney-mini-characters/Models/GLB format', '.glb']
];

export function catalog() {
  const out = { 'scn/park': join(base, 'playground/city-park-playground-starter.glb'), 'scn/trampoline': join(base, 'trampoline/trampoline-park-soft-play-starter.glb') };
  for (const [prefix, dir, ext] of packs) {
    for (const f of readdirSync(join(base, dir))) if (f.endsWith(ext)) out[`${prefix}/${f.slice(0, -ext.length)}`] = join(base, dir, f);
  }
  return out;
}
