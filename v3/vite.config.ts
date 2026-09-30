import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Source page lives in client/; the build writes index.html + build/ into v3/
// itself, so GitHub Pages serves the game at /lammatna/v3/. Models stay in
// public/models (committed once) and are fetched from there in both modes.
export default defineConfig({
  root: 'client',
  base: './',
  publicDir: '../public',
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'build',
    copyPublicDir: false,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  // Rapier without its 4 MB base64 blob: the .wasm is a separate cached file
  // (client/generated is written by tools/rapier-split.mjs, run by npm scripts).
  resolve: { alias: { '@dimforge/rapier3d-compat': fileURLToPath(new URL('./client/generated/rapier.mjs', import.meta.url)) } },
  server: { port: 5173, host: true },
  preview: { port: 4173 }
});
