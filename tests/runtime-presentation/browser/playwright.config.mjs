import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../../shared/port.mjs';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '../../..');
const port = await testPort('AELIQO_PRESENTATION_ADAPTATION_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'browser.spec.ts',
  timeout: 30_000,
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `./node_modules/.bin/vite --config tests/runtime-presentation/browser/vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/tests/runtime-presentation/browser/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
