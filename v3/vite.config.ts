import { defineConfig } from 'vite';

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
  server: { port: 5173, host: true },
  preview: { port: 4173 }
});
