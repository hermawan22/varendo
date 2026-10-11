import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({
  ...base,
  testMatch: 'app-continuity.spec.ts',
  workers: 1,
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({ name, use: { browserName: name } })),
  webServer: {
    ...base.webServer,
    command: base.webServer.command.replace('browser/vite.config.mjs', 'browser/app-continuity.vite.config.mjs'),
  },
});
