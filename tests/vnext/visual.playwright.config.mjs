import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_VNEXT_VISUAL_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: resolve(configDirectory, 'browser'),
  testMatch: 'visual-journeys.spec.ts',
  outputDir: resolve(repositoryRoot, 'artifacts/vnext-visual/test-results'),
  timeout: 60_000,
  workers: 1,
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({ name, use: { browserName: name } })),
  use: {
    baseURL: origin,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tests/vnext/server.mjs ${port}`,
    cwd: repositoryRoot,
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
