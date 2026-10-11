import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort } from '../shared/port.mjs';

const siteRoot = resolve(import.meta.dirname, '../..');
const port = await testPort('AELIQO_SITE_VISUAL_BASELINE_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'visual-baseline.spec.ts',
  timeout: 60_000,
  workers: 1,
  outputDir: resolve(siteRoot, 'artifacts/site-visual-baseline/test-results'),
  use: {
    baseURL: origin,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    cwd: siteRoot,
    url: `${origin}/playground/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
