/**
 * Node-side production-package workload probe.
 *
 * Run after building core/runtime/web. Timing is opt-in because concurrent
 * builds make a noisy baseline. The JSON report keeps first/subsequent raw samples
 * and the environment beside the derived p50/p95 values.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, release, totalmem } from 'node:os';
import {
  environmentSnapshot,
  firstSubsequent,
  percentile,
  runMediumPlanner,
  runRuntimeResourceCycles,
  runTargetedReducer,
} from './workloads.mjs';

const root = resolve(import.meta.dirname, '../..');
const timingEnabled = process.env.AELIQO_RUN_PERFORMANCE === '1';
const sourceCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const medium = timingEnabled
  ? await firstSubsequent('medium-planner', async () => runMediumPlanner())
  : { label: 'medium-planner', skipped: true };
const reducer = timingEnabled
  ? await firstSubsequent('targeted-reducer', async () => runTargetedReducer(100))
  : { label: 'targeted-reducer', skipped: true };
const functionalMedium = runMediumPlanner({ timed: false });
const functionalReducer = await runTargetedReducer(100, { timed: false });
const resources = runRuntimeResourceCycles(100);
const report = {
  sourceCommit,
  timingEnabled,
  environment: {
    ...environmentSnapshot(),
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? null,
    totalMemoryBytes: totalmem(),
    osRelease: release(),
  },
  workloads: {
    medium: {
      functional: functionalMedium,
      observations: medium,
      budgetMsP95: 16,
      plannerDurationsP95Ms: timingEnabled
        ? percentile(
            medium.results.subsequent.map((sample) => sample.durationMs),
            0.95,
          )
        : undefined,
      budgetAssertion: timingEnabled
        ? percentile(
            medium.results.subsequent.map((sample) => sample.durationMs),
            0.95,
          ) <= 16
        : undefined,
    },
    targetedReducer: {
      functional: { ...functionalReducer, rawMs: undefined },
      observations: reducer,
      budgetMsP95: 4,
      dispatchP95Ms: timingEnabled
        ? percentile(
            reducer.results.subsequent.flatMap((sample) => sample.rawMs),
            0.95,
          )
        : undefined,
      budgetAssertion: timingEnabled
        ? percentile(
            reducer.results.subsequent.flatMap((sample) => sample.rawMs),
            0.95,
          ) <= 4
        : undefined,
    },
    cleanup: { functional: resources, budgetAssertion: resources.bounded },
  },
  notes: [
    'Node probe exercises production package exports after the package builds.',
    'Browser standalone controls, local HTTP source fixture, DOM geometry, Chromium timeline trace and 100 mount/dispose cycles are in browser.spec.ts.',
    'A skipped timing section is not a pass; run with AELIQO_RUN_PERFORMANCE=1 on an isolated runner for measurements.',
  ],
};
if (
  timingEnabled &&
  (!report.workloads.medium.budgetAssertion ||
    !report.workloads.targetedReducer.budgetAssertion ||
    !report.workloads.cleanup.budgetAssertion)
)
  process.exitCode = 1;
const outputDirectory = process.env.AELIQO_PERFORMANCE_OUTPUT ?? join(root, 'artifacts/performance-workloads');
await mkdir(outputDirectory, { recursive: true });
const output = join(outputDirectory, `runtime-${Date.now()}.json`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      output,
      sourceCommit,
      timingEnabled,
      medium: functionalMedium,
      reducer: {
        iterations: functionalReducer.iterations,
        successful: functionalReducer.successful,
        unrelatedRoutes: functionalReducer.unrelatedRoutes,
      },
      cleanup: resources,
    },
    null,
    2,
  ),
);
