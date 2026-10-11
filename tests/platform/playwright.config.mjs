import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_PLATFORM_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: origin,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `./node_modules/.bin/vite examples/platform --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
