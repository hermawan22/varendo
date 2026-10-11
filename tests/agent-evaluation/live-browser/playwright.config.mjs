import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPort } from '../../shared/port.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const port = await testPort('AELIQO_AGENT_LIVE_BROWSER_PORT');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: directory,
  testMatch: 'browser.spec.mjs',
  timeout: 30_000,
  use: { baseURL: origin, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `./node_modules/.bin/vite . --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `${origin}/tests/agent-evaluation/live-browser/browser.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
