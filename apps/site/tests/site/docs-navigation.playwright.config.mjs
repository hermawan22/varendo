import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort } from '../shared/port.mjs';

const configDirectory = import.meta.dirname;
const repositoryRoot = resolve(configDirectory, '../..');
const port = await testPort('AELIQO_SITE_DOCS_NAVIGATION_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: configDirectory,
  testMatch: 'docs-navigation.spec.ts',
  timeout: 60_000,
  workers: 1,
  outputDir: resolve(repositoryRoot, 'artifacts/site-docs-navigation'),
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    cwd: repositoryRoot,
    url: `${origin}/docs/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
