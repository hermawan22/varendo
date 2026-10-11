import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_VNEXT_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: resolve(configDirectory, 'browser'),
  testMatch: '**/*.spec.ts',
  testIgnore: '**/visual-journeys.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: origin,
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
