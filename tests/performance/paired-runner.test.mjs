import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareMeasurements, validateBudget, PAIR_ORDER } from '../../scripts/performance/policy.mjs';
import { verifyArchive, createSourceGuard } from '../../scripts/performance/provenance.mjs';
const budget = {
  status: 'approved',
  runner: { container: `sha256:${'c'.repeat(64)}` },
  baselineSHA: 'a'.repeat(40),
  workloadSHA: 'b'.repeat(64),
  review: 'docs/review.md',
  relative: { fraction: 0.2, milliseconds: 2 },
  absolute: { reducerP95Ms: 4, mountedRows: 100 },
  pairs: 3,
};
const sample = (layout, visualization) => ({
  layoutEventP95Ms: layout,
  visualizationMutationLayoutP95Ms: visualization,
});
test('paired order alternates and comparison requires three complete finite samples per source', () => {
  assert.deepEqual(PAIR_ORDER, [
    ['baseline', 'candidate'],
    ['candidate', 'baseline'],
    ['baseline', 'candidate'],
  ]);
  assert.throws(() => compareMeasurements([sample(10, 10)], [sample(10, 10)], budget));
  assert.throws(() =>
    compareMeasurements(
      [sample(NaN, 10), sample(10, 10), sample(10, 10)],
      [sample(10, 10), sample(10, 10), sample(10, 10)],
      budget,
    ),
  );
});
test('relative regression must exceed BOTH reviewed limits and reports baseline variation', () => {
  const baseline = [sample(10, 10), sample(11, 10), sample(9, 10)];
  const small = compareMeasurements(baseline, [sample(12, 11), sample(12, 11), sample(12, 11)], budget);
  assert.equal(small.passed, true);
  const regression = compareMeasurements(baseline, [sample(13, 15), sample(14, 15), sample(12.5, 16)], budget);
  assert.equal(regression.passed, false);
  assert.equal(regression.metrics.layoutEventP95Ms.baseline.median, 10);
  assert.equal(regression.metrics.layoutEventP95Ms.baseline.maximum, 11);
});
test('unapproved budgets cannot gate and existing absolute budgets cannot be weakened', () => {
  assert.doesNotThrow(() => validateBudget(budget));
  assert.throws(() => validateBudget({ ...budget, status: 'candidate' }));
  assert.throws(() => validateBudget({ ...budget, absolute: { ...budget.absolute, reducerP95Ms: 5 } }));
  assert.throws(() => validateBudget({ ...budget, absolute: { ...budget.absolute, mountedRows: 101 } }));
});
function blob(text) {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
test('archive provenance hashes actual bytes and rejects edited, missing, or escaping source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeliqo-perf-source-'));
  const entry = { path: 'source.txt', mode: '100644', oid: blob('source') };
  const manifest = { sourceSHA: 'a'.repeat(40), entries: [entry] };
  await writeFile(join(root, entry.path), 'source');
  assert.equal(await verifyArchive(root, manifest), true);
  await writeFile(join(root, entry.path), 'modified');
  assert.equal(await verifyArchive(root, manifest), false);
  assert.equal(await verifyArchive(root, { ...manifest, entries: [{ ...entry, path: 'missing.txt' }] }), false);
  await assert.rejects(verifyArchive(root, { ...manifest, entries: [{ ...entry, path: '../escape.txt' }] }));
});
test('archive environment alone is not source proof and guard rechecks tree bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeliqo-perf-guard-'));
  await mkdir(join(root, 'artifacts'));
  await writeFile(join(root, 'source.txt'), 'source');
  const manifestPath = join(root, 'artifacts/source.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      sourceSHA: 'a'.repeat(40),
      entries: [{ path: 'source.txt', mode: '100644', oid: blob('source') }],
    }),
  );
  await assert.rejects(
    createSourceGuard(root, {
      AELIQO_SOURCE_COMMIT: 'a'.repeat(40),
      AELIQO_SOURCE_ARCHIVE_MANIFEST: join(root, 'absent.json'),
    }),
  );
  const guard = await createSourceGuard(root, {
    AELIQO_SOURCE_COMMIT: 'a'.repeat(40),
    AELIQO_SOURCE_ARCHIVE_MANIFEST: manifestPath,
  });
  assert.equal(await guard.current(), true);
  await writeFile(join(root, 'source.txt'), 'altered');
  assert.equal(await guard.current(), false);
});

test('pairs stop on a failed workload and preserve completed observations', async () => {
  const { runPairs } = await import('../../scripts/performance/workloads.mjs');
  const calls = [];
  const observations = [];
  await assert.rejects(
    runPairs(
      async (label, pair) => {
        calls.push(`${pair}:${label}`);
        if (calls.length === 3) throw Error('failed workload');
        return sample(1, 1);
      },
      (entry) => observations.push(entry),
    ),
  );
  assert.deepEqual(calls, ['1:baseline', '1:candidate', '2:candidate']);
  assert.equal(observations.length, 2);
});
test('planner timing is diagnostic while remaining budgets and exact source reports stay enforced', async () => {
  const { measurements } = await import('../../scripts/performance/workloads.mjs');
  const source = 'a'.repeat(40);
  const layout = {
    sourceCommit: source,
    sourceChangedDuringRun: false,
    plannerP95Ms: 500,
    trace: { layout: { p95Ms: 1 } },
    budgetAssertions: {
      enforced: true,
      targetedReducerWithinBudget: true,
      largeGeometryWithinBudget: true,
      tracePhasesAvailable: true,
    },
  };
  const visualization = { sourceCommit: source, timing: { p95Ms: 2 } };
  assert.deepEqual(measurements(layout, visualization, source), sample(1, 2));
  assert.equal(layout.plannerP95Ms, 500);
  for (const key of ['targetedReducerWithinBudget', 'largeGeometryWithinBudget', 'tracePhasesAvailable']) {
    assert.throws(() =>
      measurements(
        { ...layout, budgetAssertions: { ...layout.budgetAssertions, [key]: false } },
        visualization,
        source,
      ),
    );
  }
  assert.throws(() => measurements({ ...layout, sourceChangedDuringRun: true }, visualization, source));
  assert.throws(() => measurements(layout, { ...visualization, sourceCommit: 'b'.repeat(40) }, source));
  assert.throws(() =>
    measurements(
      { ...layout, budgetAssertions: { ...layout.budgetAssertions, enforced: false } },
      visualization,
      source,
    ),
  );
});

test('paired config preserves each workload and removes only the orchestrator-owned platform build', async () => {
  const { pairedConfig } = await import('../../scripts/performance/config.mjs');
  const before = process.env.AELIQO_PERFORMANCE_PAIR_OUTPUT;
  process.env.AELIQO_PERFORMANCE_PAIR_OUTPUT = '/tmp/aeliqo-paired-config';
  try {
    const base = {
      testMatch: 'workload.spec.ts',
      use: { locale: 'de-DE', timezoneId: 'Europe/Berlin' },
      webServer: { command: 'pnpm build:platform && vite build && vite preview' },
    };
    const config = pairedConfig(base, 'layout');
    assert.equal(config.testMatch, base.testMatch);
    assert.equal(config.use.locale, 'de-DE');
    assert.equal(config.webServer.command, 'vite build && vite preview');
    assert.equal(config.retries, 0);
    assert.throws(() => pairedConfig({ ...base, webServer: { command: 'different' } }, 'layout'));
  } finally {
    if (before === undefined) delete process.env.AELIQO_PERFORMANCE_PAIR_OUTPUT;
    else process.env.AELIQO_PERFORMANCE_PAIR_OUTPUT = before;
  }
});

test('real gate fails closed while budget is unapproved and never rewrites approval metadata', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'aeliqo-perf-unapproved-'));
  await mkdir(join(root, 'scripts/performance'), { recursive: true });
  const path = join(root, 'scripts/performance/budget.json');
  const before = JSON.stringify({ status: 'unapproved' });
  await writeFile(path, before);
  const result = spawnSync(
    process.execPath,
    [new URL('../../scripts/performance/compare.mjs', import.meta.url).pathname],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /budget has not been approved/u);
  assert.equal(await readFile(path, 'utf8'), before);
});
