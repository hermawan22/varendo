import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort } from '../shared/port.mjs';

const configDirectory = import.meta.dirname;
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_PERFORMANCE_ADVERSE_VISUALIZATION_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'adverse-visualization.spec.ts',
  timeout: 120_000,
  workers: 1,
  outputDir: resolve(repositoryRoot, 'artifacts/performance-adverse-visualization'),
  use: {
    baseURL: origin,
    browserName: 'chromium',
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build:platform && ./node_modules/.bin/vite build --config tests/performance/adverse-visualization.vite.config.mjs --mode production && ./node_modules/.bin/vite preview --config tests/performance/adverse-visualization.vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/tests/performance/adverse-visualization.html`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
