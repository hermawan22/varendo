import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort } from '../shared/port.mjs';

const configDirectory = import.meta.dirname;
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_SITE_PAGE_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'site-page.spec.ts',
  timeout: 300_000,
  workers: 1,
  outputDir: resolve(repositoryRoot, 'artifacts/performance-site-page'),
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `AELIQO_STATIC_ROOT="${resolve(repositoryRoot, 'dist')}" AELIQO_LISTEN_ADDR="127.0.0.1:${port}" go run ./deploy/server.go`,
    cwd: repositoryRoot,
    url: `${origin}/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
