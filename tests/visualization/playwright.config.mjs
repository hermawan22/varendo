import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_HIERARCHY_TEST_PORT');
export default defineConfig({
  outputDir: '../../artifacts/visualization-browser',
  testDir: '.',
  testMatch: 'browser.spec.ts',
  timeout: 30000,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/visualization/index.html`,
    reuseExistingServer: false,
  },
});
