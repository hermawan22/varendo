import { resolve } from 'node:path';
for (const key of ['VARENDO_VISUAL_BASELINE', 'VARENDO_VISUAL_CANDIDATE', 'VARENDO_VISUAL_DIFF']) {
  if (!process.env[key]) throw Error(`Missing ${key}`);
}
export default {
  testDir: '.',
  testMatch: 'regression.compare.spec.mjs',
  workers: 1,
  retries: 0,
  updateSnapshots: 'none',
  snapshotPathTemplate: `${resolve(process.env.VARENDO_VISUAL_BASELINE)}/{arg}{ext}`,
  outputDir: resolve(process.env.VARENDO_VISUAL_DIFF),
  reporter: [['list'], ['json', { outputFile: resolve(process.env.VARENDO_VISUAL_DIFF, 'results.json') }]],
  expect: { toMatchSnapshot: { threshold: 0, maxDiffPixels: 0 } },
};
