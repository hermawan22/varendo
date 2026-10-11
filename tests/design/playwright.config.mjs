import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_DESIGN_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.',
  testMatch: 'baseline.spec.ts',
  timeout: 30_000,
  outputDir: '../../artifacts/design-browser',
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `./node_modules/.bin/vite examples/platform --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${origin}/design.html`,
    reuseExistingServer: false,
  },
});
