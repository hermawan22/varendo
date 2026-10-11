import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions, testInventory, validateShards, PROJECTS } from '../../scripts/visual/shards.mjs';
const sha = 'a'.repeat(40);
const fixtureSHA = 'b'.repeat(64);
const runner = {
  container: `sha256:${'c'.repeat(64)}`,
  platform: 'linux/x64',
  node: 'v24.20.0',
  pnpm: '11.24.0',
  playwright: '1.63.0',
  browsers: Object.fromEntries(
    PROJECTS.map((project) => [project, { version: '153.0.0.0', executableSHA: 'c'.repeat(64) }]),
  ),
  fonts: { sha256: 'c'.repeat(64), files: 1, directories: ['/fonts'] },
  locale: 'en-US',
  timezone: 'UTC',
  deviceScaleFactor: 1,
  variants: ['1440x900/light/ltr', '768x900/light/ltr', '360x800/dark/rtl/200%-text'],
};
const planned = PROJECTS.flatMap((project) => Array.from({ length: 610 }, (_, i) => `${project}:test-${i}`));
const pngs = (project) =>
  Array.from({ length: 954 }, (_, i) => ({ path: `state-${i}-${project}/review.png`, sha256: 'd'.repeat(64) }));
function reports(probe = false) {
  return PROJECTS.map((project) => ({
    status: probe ? 'probe-reproducible-unapproved' : 'passed',
    approved: !probe,
    scope: 'browser-shard',
    project,
    selection: { project: null, batch: null, grep: null },
    candidateSHA: sha,
    candidateDirty: false,
    baselineSHA: probe ? undefined : 'e'.repeat(40),
    fixtureSHA,
    runner,
    sourceBuilt: true,
    captures: Object.fromEntries(
      (probe
        ? ['candidate', 'candidate-repeat']
        : ['baseline', 'baseline-repeat', 'candidate', 'candidate-repeat']
      ).map((label) => [label, { tests: planned.filter((id) => id.startsWith(`${project}:`)), images: pngs(project) }]),
    ),
    reproducibility: { capturesPerSource: 2, byteIdenticalRepeats: true, maxDiffPixels: 0, threshold: 0 },
    comparisonPassed: !probe,
  }));
}
const options = { source: sha, fixtureSHA, runner, baselineSHA: 'e'.repeat(40), planned, probe: false };
test('exact three browser shards combine into full source-bound acceptance', () => {
  const result = validateShards(reports(), options);
  assert.equal(result.tests, 1830);
  assert.equal(result.images, 2862);
  assert.equal(result.status, 'passed');
  assert.equal(result.approved, true);
});
test('probe has parity of complete repeats but can never approve', () => {
  const result = validateShards(reports(true), { ...options, probe: true });
  assert.equal(result.status, 'probe-reproducible-unapproved');
  assert.equal(result.approved, false);
  assert.throws(() => validateShards(reports(true), options));
});
for (const [label, mutate] of [
  ['missing shard', (r) => r.pop()],
  ['duplicate shard', (r) => (r[2] = r[1])],
  ['wrong source', (r) => (r[0].candidateSHA = 'f'.repeat(40))],
  ['wrong baseline', (r) => (r[0].baselineSHA = 'f'.repeat(40))],
  ['wrong fixture', (r) => (r[0].fixtureSHA = 'f'.repeat(64))],
  ['wrong runner', (r) => (r[0].runner = {})],
  ['cancelled', (r) => (r[0].status = 'cancelled')],
  ['failed', (r) => (r[0].status = 'failed')],
  ['dirty source', (r) => (r[0].candidateDirty = true)],
  ['not built', (r) => (r[0].sourceBuilt = false)],
  ['selected family', (r) => (r[0].selection.batch = 'catalog')],
  ['selected project bypass', (r) => (r[0].selection.project = 'chromium')],
  ['incomplete repeat', (r) => delete r[0].captures['baseline-repeat']],
  ['missing test', (r) => r[0].captures.candidate.tests.pop()],
  ['duplicate test', (r) => (r[0].captures.candidate.tests[1] = r[0].captures.candidate.tests[0])],
  ['unknown test', (r) => (r[0].captures.candidate.tests[0] = 'chromium:other')],
  ['missing screenshot', (r) => r[0].captures.candidate.images.pop()],
  ['duplicate screenshot', (r) => (r[0].captures.candidate.images[1] = r[0].captures.candidate.images[0])],
  ['nondeterministic repeat', (r) => (r[0].captures['candidate-repeat'].images[0].sha256 = 'e'.repeat(64))],
  ['different baseline pixels', (r) => (r[0].comparisonPassed = false)],
  ['changed reproduction contract', (r) => (r[0].reproducibility.threshold = 0.2)],
])
  test(`rejects ${label}`, () => {
    const r = reports();
    mutate(r);
    assert.throws(() => validateShards(r, options));
  });
test('explicit browser shard CLI is separate from full and selected-family commands', () => {
  assert.deepEqual(parseOptions(['--probe', '--shard', 'firefox']), { probe: true, full: false, project: 'firefox' });
  for (const args of [
    ['--shard'],
    ['--shard', 'other'],
    ['--full', '--shard', 'chromium'],
    ['--shard', 'chromium', '--shard', 'webkit'],
    ['--other'],
  ])
    assert.throws(() => parseOptions(args));
});
test('executed inventory rejects skipped, failed, interrupted, flaky, expected-failure or missing executions', () => {
  const fixture = () => ({
    suites: [
      {
        specs: [
          {
            id: 'one',
            tests: [
              {
                projectName: 'chromium',
                expectedStatus: 'passed',
                status: 'expected',
                results: [{ status: 'passed' }],
              },
            ],
          },
        ],
      },
    ],
    errors: [],
  });
  assert.deepEqual(testInventory(fixture(), true), ['chromium:one']);
  for (const status of ['skipped', 'failed', 'interrupted', 'timedOut']) {
    const f = fixture();
    f.suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => testInventory(f, true));
  }
  for (const change of [
    (t) => (t.results = []),
    (t) => t.results.push({ status: 'passed' }),
    (t) => (t.expectedStatus = 'failed'),
    (t) => (t.status = 'flaky'),
  ]) {
    const f = fixture();
    change(f.suites[0].specs[0].tests[0]);
    assert.throws(() => testInventory(f, true));
  }
  const error = fixture();
  error.errors.push({ message: 'interrupted' });
  assert.throws(() => testInventory(error, true));
});

test('real CLI rejects failed matrix and selected shard attempts before capture', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'visual-shard-cli-'));
  const aggregate = new URL('../../scripts/visual/aggregate.mjs', import.meta.url).pathname;
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const execution = spawnSync(process.execPath, [aggregate], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, VISUAL_SHARD_RESULT: result },
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stdout, /failed, was skipped or cancelled/u);
  }
  const run = new URL('../../scripts/visual/run.mjs', import.meta.url).pathname;
  const filtered = spawnSync(process.execPath, [run, '--probe', '--shard', 'chromium'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, AELIQO_VISUAL_BATCH: 'catalog' },
  });
  assert.equal(filtered.status, 1);
  assert.match(filtered.stdout, /rejects selection filters/u);
  const evidence = JSON.parse(await readFile(join(directory, 'artifacts/visual-shard-report/report.json'), 'utf8'));
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.approved, false);
});

for (const [name, patch] of [
  ['omitted', undefined],
  ['empty', {}],
  ['unpinned', { ...runner, container: 'latest' }],
  ['missing browser', { ...runner, browsers: {} }],
  ['missing font digest', { ...runner, fonts: {} }],
  ['wrong locale', { ...runner, locale: 'fr-FR' }],
  ['wrong toolchain', { ...runner, node: 'v22.0.0' }],
  ['missing platform', { ...runner, platform: undefined }],
  ['wrong variants', { ...runner, variants: [] }],
])
  test(`probe rejects consistently ${name} environment evidence`, () => {
    const r = reports(true).map((report) => ({ ...report, runner: patch }));
    assert.throws(() => validateShards(r, { ...options, probe: true, runner: patch }));
  });
