import { defineConfig } from '@playwright/test';
import controls from './controls.playwright.config.mjs';
export default defineConfig({
  ...controls,
  testMatch: 'visualization-containers.spec.ts',
  outputDir: '../../artifacts/design-visualization-containers',
});
