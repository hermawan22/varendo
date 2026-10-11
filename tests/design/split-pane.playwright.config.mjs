import { defineConfig } from '@playwright/test';
import base from './controls.playwright.config.mjs';
export default defineConfig({
  ...base,
  testMatch: 'split-pane.spec.ts',
  outputDir: '../../artifacts/design-split-pane',
});
