// Cloudflare Workers refuse to compile WebAssembly from bytes at runtime, and
// rapier3d-compat ships its WASM inlined as base64. This writes a copy of the
// Rapier module that imports the .wasm file instead (Wrangler turns a .wasm
// import into a precompiled WebAssembly.Module). wrangler.toml aliases
// '@dimforge/rapier3d-compat' to the copy, so shared/ code is unchanged.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'node_modules', '@dimforge', 'rapier3d-compat', 'dist');
const original = await readFile(join(dist, 'rapier.mjs'), 'utf8');
const re = /module_or_path:[\w$]+\.toByteArray\("[A-Za-z0-9+/=]+"\)(\.buffer)?/;
if (!re.test(original)) throw new Error('rapier.mjs layout changed: inlined wasm not found');

// Two copies: the Worker imports the module; the browser fetches the file (Vite emits it as an asset).
const targets = [
  ['server/generated', `import __rapierWasm from './rapier_wasm3d_bg.wasm';\n`, 'module_or_path:__rapierWasm'],
  ['client/generated', '', "module_or_path:new URL('./rapier_wasm3d_bg.wasm', import.meta.url)"]
];
for (const [dir, head, repl] of targets) {
  const out = join(here, '..', dir);
  await mkdir(out, { recursive: true });
  const src = head + original.replace(re, repl);
  await writeFile(join(out, 'rapier.mjs'), src.replace(/\/\/# sourceMappingURL=.*$/m, ''));
  await copyFile(join(dist, 'rapier_wasm3d_bg.wasm'), join(out, 'rapier_wasm3d_bg.wasm'));
  console.log(`${dir}/rapier.mjs (${(src.length / 1024).toFixed(0)} KB) + rapier_wasm3d_bg.wasm`);
}
