import { resolve } from 'node:path';
import base from './playwright.config.mjs';
if (!process.env.AELIQO_VISUAL_CAPTURE) throw Error('Expected isolated capture output directory');
const outputDir = resolve(process.env.AELIQO_VISUAL_CAPTURE);
export default {
  ...base,
  outputDir,
  retries: 0,
  repeatEach: 1,
  updateSnapshots: 'none',
  reporter: [['list'], ['json', { outputFile: resolve(outputDir, 'results.json') }]],
};
