import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_VERTICAL_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.',
  testMatch: 'hr-browser.spec.ts',
  timeout: 30_000,
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `node tests/vertical-slice/server.mjs ${port}`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: origin,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
