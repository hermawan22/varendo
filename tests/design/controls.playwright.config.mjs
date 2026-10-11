import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_CONTROL_DESIGN_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.',
  testMatch: ['controls.spec.ts', 'rtl-semantics.spec.ts', 'split-pane.spec.ts'],
  timeout: 30_000,
  outputDir: '../../artifacts/design-controls',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map((browserName) => ({ name: browserName, use: { browserName } })),
  webServer: {
    command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${origin}/tests/design/controls.html`,
    reuseExistingServer: false,
  },
});
