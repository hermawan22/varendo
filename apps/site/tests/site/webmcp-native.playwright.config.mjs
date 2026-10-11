import { defineConfig } from '@playwright/test';
import { testPort } from '../shared/port.mjs';
const port = await testPort('AELIQO_NATIVE_PLAYGROUND_PORT');
export default defineConfig({
  testDir: '.',
  testMatch: 'webmcp-native.spec.ts',
  workers: 1,
  timeout: 45_000,
  outputDir: '../../artifacts/webmcp-native',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    launchOptions: { args: ['--enable-features=WebMCPTesting'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    cwd: new URL('../../', import.meta.url).pathname,
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/playground/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
