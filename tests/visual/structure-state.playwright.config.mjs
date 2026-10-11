import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_VISUAL_STRUCTURE_STATE_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'structure-states.spec.ts',
  workers: 1,
  timeout: 30_000,
  outputDir: resolve(repositoryRoot, 'artifacts/visual-structure-states'),
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(repositoryRoot, 'artifacts/visual-structure-states/results.json') }],
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
  },
  webServer: {
    cwd: repositoryRoot,
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/tests/visual/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
