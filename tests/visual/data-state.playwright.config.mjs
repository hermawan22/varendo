import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_VISUAL_DATA_STATES_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'data-states.spec.ts',
  outputDir: resolve(repositoryRoot, 'artifacts/visual-data-states'),
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: resolve(repositoryRoot, 'artifacts/visual-data-states/results.json') }]],
  fullyParallel: false,
  workers: 1,
  use: { baseURL: origin, trace: 'retain-on-failure', locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/tests/visual/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
