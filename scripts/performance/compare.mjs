#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, totalmem, release } from 'node:os';
import { execute, output } from '../visual/process.mjs';
import { withBaseline } from '../visual/source.mjs';
import { compareMeasurements, validateBudget } from './policy.mjs';
import { writeArchiveManifest, verifyArchive } from './provenance.mjs';
import { runPairs, runWorkloads } from './workloads.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const probe = args[0] === '--probe';
if (args.length && !(probe && args.length === 3 && args[1] === '--source' && /^[a-f0-9]{40}$/u.test(args[2])))
  throw Error('Usage: node scripts/performance/compare.mjs [--probe --source <exact SHA>]');
const destination = resolve('artifacts/performance-paired', new Date().toISOString().replaceAll(':', '-'));
await mkdir(destination, { recursive: true });
const report = {
  status: 'failed',
  approved: false,
  artifacts: destination,
  observations: [],
  measurementHost: {
    cpuModels: [...new Set(cpus().map((cpu) => cpu.model))],
    logicalCPUs: cpus().length,
    memoryBytes: totalmem(),
    kernel: release(),
  },
};
const saveReport = () => writeFile(join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

async function describe(source, label) {
  const path = join(destination, `${label}-environment.json`);
  execute(source, 'node', ['scripts/performance/describe.mjs', path]);
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertClean(sourceSHA) {
  assert.equal(output(root, 'git', ['rev-parse', 'HEAD']), sourceSHA, 'Candidate source changed');
  assert.equal(output(root, 'git', ['status', '--porcelain']), '', 'Paired comparison requires clean candidate');
}

async function measure(baseline, baselineSHA, candidateSHA) {
  const sources = { baseline, candidate: root };
  const shas = { baseline: baselineSHA, candidate: candidateSHA };
  const manifests = {};
  const manifestPaths = {};
  for (const [label, source] of Object.entries(sources)) {
    manifestPaths[label] = join(destination, `${label}-source.json`);
    manifests[label] = await writeArchiveManifest(root, shas[label], source, manifestPaths[label]);
    execute(source, 'pnpm', ['build:platform']);
  }
  return runPairs(
    async (label, pair) => {
      assert.ok(await verifyArchive(sources[label], manifests[label]), 'Source bytes changed before measurement');
      const result = await runWorkloads(
        sources[label],
        shas[label],
        manifestPaths[label],
        join(destination, `pair-${pair}`, label),
      );
      assert.ok(await verifyArchive(sources[label], manifests[label]), 'Source bytes changed during measurement');
      return result;
    },
    async (entry) => {
      report.observations.push(entry);
      await saveReport();
    },
  );
}

async function run() {
  const budget = JSON.parse(await readFile(join(root, 'scripts/performance/budget.json'), 'utf8'));
  if (!probe) validateBudget(budget);
  const candidateSHA = output(root, 'git', ['rev-parse', 'HEAD']);
  const baselineSHA = probe ? args[2] : budget.baselineSHA;
  assertClean(candidateSHA);
  if (probe) assert.equal(candidateSHA, baselineSHA, 'Stability probe requires identical explicit source SHAs');
  Object.assign(report, {
    candidateSHA,
    baselineSHA,
    review: probe ? null : budget.review,
    policy: { relative: budget.relative, absolute: budget.absolute, pairs: budget.pairs },
  });
  execute(root, 'pnpm', ['install', '--frozen-lockfile']);
  const candidate = await describe(root, 'candidate');
  if (!probe) {
    assert.deepEqual(candidate.runner, budget.runner, 'Runner differs from reviewed performance environment');
    assert.equal(candidate.workloadSHA, budget.workloadSHA, 'Performance workload changed; review required');
  }
  Object.assign(report, candidate);
  await withBaseline(root, baselineSHA, async (baseline) => {
    assert.deepEqual(await describe(baseline, 'baseline'), candidate, 'Baseline runner or workload differs');
    const samples = await measure(baseline, baselineSHA, candidateSHA);
    report.comparison = compareMeasurements(samples.baseline, samples.candidate, budget);
  });
  assertClean(candidateSHA);
  if (!report.comparison.passed) throw Error('Paired performance regression exceeds candidate 20% AND 2ms policy');
  report.status = probe ? 'stable-probe-unapproved' : 'passed';
  report.approved = !probe;
}

try {
  await run();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await saveReport();
  console.log(JSON.stringify(report, null, 2));
}
