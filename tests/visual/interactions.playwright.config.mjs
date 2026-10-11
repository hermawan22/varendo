import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: ['data-interactions.spec.ts', 'compound-interactions.spec.ts', 'visualization-interactions.spec.ts'],
  outputDir: '../../artifacts/visual-interactions',
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: fileURLToPath(new URL('../../artifacts/visual-interactions/results.json', import.meta.url)) },
    ],
  ],
});
