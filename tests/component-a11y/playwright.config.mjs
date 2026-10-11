import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_COMPONENT_A11Y_PORT');
export default defineConfig({
  testDir: '.',
  testMatch: ['browser.spec.ts', 'visual.spec.ts'],
  outputDir: '../../artifacts/component-a11y',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/input/index.html`,
    reuseExistingServer: false,
  },
});
