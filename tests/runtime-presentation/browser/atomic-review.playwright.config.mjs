import base from './app-transaction.playwright.config.mjs';
export default {
  ...base,
  testMatch: 'atomic-review.spec.ts',
  outputDir: '../../../artifacts/atomic-independent-review',
  webServer: {
    ...base.webServer,
    command: base.webServer.command.replace('browser/vite.config.mjs', 'browser/atomic-review.vite.config.mjs'),
  },
};
