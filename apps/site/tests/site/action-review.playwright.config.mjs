import base from './playwright.config.mjs';

export default {
  ...base,
  testMatch: 'action-review.spec.ts',
  outputDir: '../../artifacts/site-browser/action-review-output',
  projects: ['chromium', 'firefox', 'webkit'].flatMap((browserName) =>
    [360, 768, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: { browserName, viewport: { width, height: 960 } },
    })),
  ),
};
