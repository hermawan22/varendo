import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort } from '../shared/port.mjs';

const configDirectory = import.meta.dirname;
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_PERFORMANCE_PERCEIVED_INPUT_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'perceived-input.spec.ts',
  timeout: 120_000,
  workers: 1,
  outputDir: resolve(repositoryRoot, 'artifacts/performance-perceived-input'),
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm build:runtime && pnpm build:web && ./node_modules/.bin/vite build --config tests/performance/perceived-input.vite.config.mjs --mode production && ./node_modules/.bin/vite preview --config tests/performance/perceived-input.vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/tests/performance/perceived-input.html`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
