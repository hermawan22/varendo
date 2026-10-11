import base from './playwright.config.mjs';

export default {
  ...base,
  testMatch: 'playground-responsive.spec.ts',
  outputDir: '../../artifacts/site-browser/playground-responsive-output',
};
