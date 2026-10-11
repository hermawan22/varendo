import assert from 'node:assert/strict';
import { validateRunner } from './runner-evidence.mjs';
export const PROJECTS = ['chromium', 'firefox', 'webkit'];
export const REPRODUCIBILITY = { capturesPerSource: 2, byteIdenticalRepeats: true, maxDiffPixels: 0, threshold: 0 };
export function parseOptions(args) {
  const options = { probe: false, full: false, project: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (seen.has(arg)) throw Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--probe') options.probe = true;
    else if (arg === '--full') options.full = true;
    else if (arg === '--shard' && PROJECTS.includes(args[index + 1])) options.project = args[++index];
    else throw Error('Usage: run.mjs [--probe] [--full | --shard chromium|firefox|webkit]');
  }
  if (options.full && options.project) throw Error('Full and browser-shard modes are distinct');
  return options;
}
export function testInventory(report, executed = false) {
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright reported errors');
  const ids = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        if (executed) {
          assert.equal(test.expectedStatus, 'passed', 'Expected failures are not capture evidence');
          assert.equal(test.status, 'expected', 'Capture did not pass');
          assert.equal(test.results.length, 1, 'Missing or repeated test execution');
          assert.equal(test.results[0].status, 'passed', 'Skipped, cancelled or failed capture');
        }
        assert.ok(PROJECTS.includes(test.projectName), 'Unknown browser project');
        ids.push(`${test.projectName}:${spec.id}`);
      }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  return unique(ids, 'tests');
}
function unique(values, label) {
  assert.ok(values.length > 0, `Empty ${label}`);
  assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);
  return [...values].sort();
}
function captureInventory(capture, planned, project) {
  assert.deepEqual(unique(capture.tests, 'tests'), planned, 'Incomplete planned test inventory');
  assert.equal(capture.images.length, 954, 'Incomplete browser PNG inventory');
  for (const image of capture.images) {
    assert.match(image.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(image.path.includes(`-${project}/`) && !image.path.includes('..'), 'Wrong browser PNG path');
  }
  return unique(
    capture.images.map((image) => image.path),
    'PNG paths',
  );
}
function validateShard(report, options) {
  const { probe, source, fixtureSHA, runner, baselineSHA, planned } = options;
  assert.equal(report.status, probe ? 'probe-reproducible-unapproved' : 'passed');
  assert.equal(report.approved, !probe);
  assert.equal(report.scope, 'browser-shard');
  assert.equal(report.candidateSHA, source, 'Wrong candidate SHA');
  assert.equal(report.candidateDirty, false, 'Dirty candidate');
  assert.equal(report.sourceBuilt, true, 'Source was not built');
  assert.equal(report.fixtureSHA, fixtureSHA, 'Wrong fixture SHA');
  assert.deepEqual(report.runner, runner, 'Wrong runner identity');
  assert.deepEqual(report.selection, { project: null, batch: null, grep: null }, 'Selection filters are forbidden');
  assert.deepEqual(report.reproducibility, REPRODUCIBILITY);
  const labels = probe
    ? ['candidate', 'candidate-repeat']
    : ['baseline', 'baseline-repeat', 'candidate', 'candidate-repeat'];
  assert.deepEqual(Object.keys(report.captures).sort(), labels.sort(), 'Incomplete capture sequence');
  const tests = planned.filter((id) => id.startsWith(`${report.project}:`));
  assert.equal(tests.length, 610, 'Expected complete browser test plan');
  for (const capture of Object.values(report.captures)) captureInventory(capture, tests, report.project);
  assert.deepEqual(report.captures.candidate, report.captures['candidate-repeat'], 'Nondeterministic candidate');
  if (!probe) {
    assert.equal(report.baselineSHA, baselineSHA, 'Wrong baseline SHA');
    assert.equal(report.comparisonPassed, true, 'Pixel comparison failed');
    assert.deepEqual(report.captures.baseline, report.captures['baseline-repeat'], 'Nondeterministic baseline');
    assert.deepEqual(
      report.captures.baseline.images.map((image) => image.path),
      report.captures.candidate.images.map((image) => image.path),
    );
  }
  return { tests, images: report.captures.candidate.images.map((image) => image.path) };
}
export function validateShards(reports, options) {
  validateRunner(options.runner);
  assert.match(options.source, /^[a-f0-9]{40}$/u);
  assert.match(options.fixtureSHA, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    reports.map((report) => report.project).sort(),
    [...PROJECTS].sort(),
    'Missing or duplicate browser shard',
  );
  const planned = unique(options.planned, 'planned tests');
  assert.equal(planned.length, 1830, 'Expected full release test inventory');
  const inventories = reports.map((report) => validateShard(report, { ...options, planned }));
  assert.deepEqual(
    unique(
      inventories.flatMap((item) => item.tests),
      'union tests',
    ),
    planned,
  );
  const images = unique(
    inventories.flatMap((item) => item.images),
    'union PNG paths',
  );
  assert.equal(images.length, 2862);
  return {
    status: options.probe ? 'probe-reproducible-unapproved' : 'passed',
    approved: !options.probe,
    scope: 'full',
    candidateSHA: options.source,
    fixtureSHA: options.fixtureSHA,
    runner: options.runner,
    projects: PROJECTS,
    tests: planned.length,
    images: images.length,
  };
}
