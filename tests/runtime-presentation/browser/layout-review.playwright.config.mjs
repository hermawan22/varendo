import base from './app-continuity.playwright.config.mjs';
export default {
  ...base,
  testMatch: 'layout-review.spec.ts',
  outputDir: '../../../artifacts/layout-independent-review',
};
