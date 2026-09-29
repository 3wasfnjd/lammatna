// Bundles the Babylon.js client into dist/ with tree-shaken deep imports and
// stamps index.html with a content hash so GitHub Pages caches never go stale.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function sourceHash() {
  const hash = createHash('sha256');
  const walk = async dir => {
    for (const e of (await readdir(join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.js')) { hash.update(p); hash.update(await readFile(join(root, p))); }
    }
  };
  await walk('src'); await walk('shared');
  hash.update(await readFile(join(root, 'styles.css')));
  hash.update(await readFile(join(root, 'tools/build.mjs')));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  hash.update(JSON.stringify(pkg.dependencies));
  return hash.digest('hex').slice(0, 12);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const stamp = await sourceHash();
  const html = await readFile(join(root, 'index.html'), 'utf8');
  if (check) {
    let built = '';
    try { built = JSON.parse(await readFile(join(root, 'dist/stamp.json'), 'utf8')).stamp; } catch { /* missing */ }
    if (built !== stamp || !html.includes(`dist/lammatna.js?v=${stamp}`)) throw new Error('Lammatna bundle is stale: run npm run build');
    console.log(`Lammatna bundle ${stamp} is current.`);
  } else {
    await rm(join(root, 'dist'), { recursive: true, force: true });
    const result = await build({
      entryPoints: { lammatna: join(root, 'src/main.js') },
      outdir: join(root, 'dist'), bundle: true, splitting: true, format: 'esm', minify: true,
      target: ['es2020', 'safari15'], chunkNames: 'chunks/[name]-[hash]', metafile: true, legalComments: 'none'
    });
    await writeFile(join(root, 'dist/stamp.json'), JSON.stringify({ stamp }) + '\n');
    const out = html.replace(/dist\/lammatna\.js\?v=[\w]+/, `dist/lammatna.js?v=${stamp}`).replace(/styles\.css\?v=[\w]+/, `styles.css?v=${stamp}`);
    await writeFile(join(root, 'index.html'), out);
    const main = result.metafile.outputs[Object.keys(result.metafile.outputs).find(k => k.endsWith('dist/lammatna.js'))];
    console.log(`Lammatna ${stamp}: main bundle ${(main.bytes / 1024).toFixed(0)} KB`);
  }
}
