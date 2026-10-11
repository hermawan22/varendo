import { defineConfig } from '@playwright/test';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_SITE_TEST_PORT');
export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  workers: 1,
  timeout: 45000,
  outputDir: '../../artifacts/site-browser/test-output',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/playground/`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
