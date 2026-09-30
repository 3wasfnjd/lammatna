// Copies the runtime files (no sources, tools or tests) into site/ for the Cloudflare Worker.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(root + 'site', { recursive: true, force: true });
await mkdir(root + 'site', { recursive: true });
for (const path of ['index.html', 'styles.css', 'icon.svg', 'dist', 'assets']) await cp(root + path, root + 'site/' + path, { recursive: true });
console.log('Packaged the game into site/.');
