import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execute } from '../visual/process.mjs';
import { PAIR_ORDER } from './policy.mjs';

export async function runPairs(run, observe) {
  const samples = { baseline: [], candidate: [] };
  for (const [index, order] of PAIR_ORDER.entries()) {
    for (const label of order) {
      const measurement = await run(label, index + 1);
      samples[label].push(measurement);
      await observe({ pair: index + 1, label, measurement });
    }
  }
  return samples;
}

async function reportFile(directory, name) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) matches.push(join(entry.parentPath, entry.name));
  }
  assert.equal(matches.length, 1, `Expected exactly one ${name}`);
  return JSON.parse(await readFile(matches[0], 'utf8'));
}

export function measurements(layout, visualization, sourceSHA) {
  assert.equal(layout.sourceCommit, sourceSHA, 'Layout source mismatch');
  assert.equal(visualization.sourceCommit, sourceSHA, 'Visualization source mismatch');
  assert.equal(layout.sourceChangedDuringRun, false, 'Layout source changed during measurement');
  for (const key of ['enforced', 'targetedReducerWithinBudget', 'largeGeometryWithinBudget', 'tracePhasesAvailable'])
    assert.equal(layout.budgetAssertions?.[key], true, `Required absolute assertion: ${key}`);
  const result = {
    layoutEventP95Ms: layout.trace?.layout?.p95Ms,
    visualizationMutationLayoutP95Ms: visualization.timing?.p95Ms,
  };
  for (const value of Object.values(result))
    assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Missing finite timing sample');
  return result;
}

export async function runWorkloads(source, sourceSHA, manifest, destination) {
  const env = {
    AELIQO_SOURCE_COMMIT: sourceSHA,
    AELIQO_SOURCE_ARCHIVE_MANIFEST: manifest,
    AELIQO_RUN_PERFORMANCE: '1',
    AELIQO_ENFORCE_PERFORMANCE_BUDGETS: '1',
    AELIQO_PERFORMANCE_PAIR_OUTPUT: destination,
    TZ: 'UTC',
  };
  execute(
    source,
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'tests/performance/paired-browser.playwright.config.mjs',
      '--grep',
      'records first/subsequent observations',
    ],
    env,
  );
  execute(
    source,
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'tests/performance/paired-visualization.playwright.config.mjs'],
    env,
  );
  const layout = await reportFile(join(destination, 'layout'), 'performance-report.json');
  const visualization = await reportFile(join(destination, 'visualization'), 'adverse-visualization-report.json');
  return measurements(layout, visualization, sourceSHA);
}
