import { resolve } from 'node:path';
import { runLiveJourneyEvaluation } from './live-journey-runner.mjs';

const args = process.argv.slice(2);
const options = new Map();
let live = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--live') {
    live = true;
    continue;
  }
  if (!['--config', '--corpus', '--output'].includes(arg) || !args[index + 1])
    throw new Error('Use --corpus FILE --output DIRECTORY [--config FILE --live].');
  options.set(arg, args[++index]);
}
const corpusPath = options.get('--corpus') ?? resolve(import.meta.dirname, 'j1-j3-corpus.json');
const outputDirectory = options.get('--output') ?? resolve('artifacts/agent-evaluation/live-journeys');
const report = await runLiveJourneyEvaluation({
  corpusPath,
  configPath: options.get('--config'),
  outputDirectory,
  live,
});
process.stdout.write(
  `J1–J3 live evaluation: ${report.status}; ${report.rows.length} trials; ${report.requestsUsed} model requests.\n`,
);
if (report.status !== 'passed') process.exitCode = 2;
