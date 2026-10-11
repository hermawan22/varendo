import { resolve } from 'node:path';
for (const key of ['AELIQO_VISUAL_BASELINE', 'AELIQO_VISUAL_CANDIDATE', 'AELIQO_VISUAL_DIFF']) {
  if (!process.env[key]) throw Error(`Missing ${key}`);
}
export default {
  testDir: '.',
  testMatch: 'regression.compare.spec.mjs',
  workers: 1,
  retries: 0,
  updateSnapshots: 'none',
  snapshotPathTemplate: `${resolve(process.env.AELIQO_VISUAL_BASELINE)}/{arg}{ext}`,
  outputDir: resolve(process.env.AELIQO_VISUAL_DIFF),
  reporter: [['list'], ['json', { outputFile: resolve(process.env.AELIQO_VISUAL_DIFF, 'results.json') }]],
  expect: { toMatchSnapshot: { threshold: 0, maxDiffPixels: 0 } },
};
