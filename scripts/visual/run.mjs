#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { capture, compare, selection } from './capture.mjs';
import { approveInputs, runCaptures, verifyRepeat, verifyCandidateSource } from './policy.mjs';
import { execute, output } from './process.mjs';
import { withBaseline } from './source.mjs';
import { parseOptions, REPRODUCIBILITY } from './shards.mjs';
import { captureEvidence, plannedTests } from './inventory.mjs';

const root = process.cwd();
const { probe, full, project } = parseOptions(process.argv.slice(2));
const destination = resolve('artifacts/visual-regression', new Date().toISOString().replaceAll(':', '-'));
await mkdir(destination, { recursive: true });
const selected = selection();
const localScope = Object.values(selected).some(Boolean) ? 'selected' : 'full';
const scope = project ? 'browser-shard' : localScope;
const report = {
  status: 'failed',
  approved: false,
  sourceBuilt: false,
  candidateDirty: false,
  project,
  captures: {},
  scope,
  selection: selected,
  artifacts: destination,
};

async function checkedCapture(source, label) {
  const directory = join(destination, label);
  const planned = project ? plannedTests(source, directory, project) : undefined;
  const result = await capture(source, directory, project);
  if (planned) {
    const evidence = await captureEvidence(directory, planned);
    assert.equal(evidence.tests.length, 610, 'Expected full browser test inventory');
    assert.equal(evidence.images.length, 954, 'Expected full browser PNG inventory');
    report.captures[label] = evidence;
  }
  return result;
}

async function describe(source, label) {
  const path = join(destination, `${label}-environment.json`);
  execute(source, 'node', ['scripts/visual/describe.mjs', path]);
  return JSON.parse(await readFile(path, 'utf8'));
}

function candidateSource() {
  return {
    sha: output(root, 'git', ['rev-parse', 'HEAD']),
    dirty: output(root, 'git', ['status', '--porcelain']).length > 0,
  };
}

async function probeCandidate() {
  const before = candidateSource();
  report.candidateSHA = before.sha;
  report.candidateDirty = before.dirty;
  if (scope !== 'selected') {
    execute(root, 'pnpm', ['install', '--frozen-lockfile']);
    execute(root, 'pnpm', ['build:platform']);
    report.sourceBuilt = true;
  }
  Object.assign(report, await describe(root, 'candidate'));
  const first = await checkedCapture(root, 'candidate');
  const repeat = await checkedCapture(root, 'candidate-repeat');
  report.images = (await verifyRepeat(first, repeat)).length;
  const after = candidateSource();
  report.candidateDirty = before.dirty || after.dirty;
  verifyCandidateSource(before, after);
  report.status = 'probe-reproducible-unapproved';
}

async function gate() {
  const metadata = JSON.parse(await readFile(join(root, 'scripts/visual/baseline.json'), 'utf8'));
  approveInputs(metadata);
  if (output(root, 'git', ['status', '--porcelain']))
    throw Error('Approved comparison requires a clean candidate checkout');
  report.baselineSHA = metadata.baselineSHA;
  report.candidateSHA = output(root, 'git', ['rev-parse', 'HEAD']);
  report.review = metadata.review;
  execute(root, 'pnpm', ['install', '--frozen-lockfile']);
  const candidate = await describe(root, 'candidate');
  assert.deepEqual(candidate.runner, metadata.runner, 'Candidate runner differs from approved environment');
  assert.equal(candidate.fixtureSHA, metadata.fixtureSHA, 'Candidate fixture change requires a reviewed baseline');
  Object.assign(report, candidate);
  await withBaseline(root, metadata.baselineSHA, async (baseline) => {
    const previous = await describe(baseline, 'baseline');
    assert.deepEqual(previous, candidate, 'Baseline fixtures or runner differ from candidate');
    execute(baseline, 'pnpm', ['build:platform']);
    execute(root, 'pnpm', ['build:platform']);
    report.sourceBuilt = true;
    await runCaptures({
      baseline,
      candidate: root,
      capture: checkedCapture,
      compare: (first, next) => compare(root, first, next, destination),
    });
  });
  assert.equal(
    output(root, 'git', ['rev-parse', 'HEAD']),
    report.candidateSHA,
    'Candidate source changed during capture',
  );
  if (output(root, 'git', ['status', '--porcelain'])) throw Error('Candidate changed during capture');
  report.comparisonPassed = true;
  report.status = 'passed';
  report.approved = true;
}

try {
  if ((full || project) && Object.values(selected).some(Boolean))
    throw Error('Full visual gate rejects selection filters');
  if (probe) await probeCandidate();
  else await gate();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.reproducibility = REPRODUCIBILITY;
  if (project) {
    await mkdir(resolve('artifacts/visual-shard-report'), { recursive: true });
    await writeFile(resolve('artifacts/visual-shard-report/report.json'), JSON.stringify(report, null, 2));
  }
  await writeFile(join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
