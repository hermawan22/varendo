import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({
  ...base,
  testMatch: 'app-transaction.spec.ts',
  workers: 1,
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({ name, use: { browserName: name } })),
});
