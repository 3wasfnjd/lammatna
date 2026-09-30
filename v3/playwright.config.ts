import { defineConfig } from '@playwright/test';

// Headless run against the production build (vite preview) plus the Node room
// server for the two-player test. WebGL runs on SwiftShader.
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }
  },
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npx tsx server/node-server.ts 8788', url: 'http://localhost:8788/health', reuseExistingServer: true, timeout: 60_000 }
  ]
});
