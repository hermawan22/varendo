#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixtureDigest } from './environment.mjs';
import { approveInputs } from './policy.mjs';
import { plannedTests } from './inventory.mjs';
import { validateShards } from './shards.mjs';
import { output } from './process.mjs';
const root = process.cwd();
const args = process.argv.slice(2);
const probe = args.includes('--probe');
if (args.some((arg) => arg !== '--probe') || args.length > 1) throw Error('Usage: aggregate.mjs [--probe]');
const destination = resolve('artifacts/visual-aggregate');
const report = { status: 'failed', approved: false };
async function readReports() {
  const directory = resolve('artifacts/visual-shard-reports');
  const reports = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), 'Unexpected shard artifact');
    reports.push(JSON.parse(await readFile(join(directory, entry.name, 'report.json'), 'utf8')));
  }
  return reports;
}
try {
  assert.equal(process.env.VISUAL_SHARD_RESULT, 'success', 'A browser shard failed, was skipped or cancelled');
  for (const key of ['AELIQO_VISUAL_PROJECT', 'AELIQO_VISUAL_BATCH', 'AELIQO_VISUAL_GREP'])
    assert.ok(!process.env[key], 'Full aggregate rejects selection filters');
  const source = output(root, 'git', ['rev-parse', 'HEAD']);
  assert.equal(source, process.env.SOURCE_SHA, 'Aggregate checkout differs from expected source');
  assert.equal(output(root, 'git', ['status', '--porcelain']), '', 'Aggregate source is dirty');
  const reports = await readReports();
  const metadata = JSON.parse(await readFile(join(root, 'scripts/visual/baseline.json'), 'utf8'));
  if (!probe) approveInputs(metadata);
  const runner = probe ? reports[0]?.runner : metadata.runner;
  const fixtureSHA = await fixtureDigest(root);
  if (!probe) assert.equal(fixtureSHA, metadata.fixtureSHA, 'Approved fixtures differ');
  const planned = plannedTests(root, join(destination, 'planned'));
  Object.assign(
    report,
    validateShards(reports, { probe, source, fixtureSHA, runner, baselineSHA: metadata.baselineSHA, planned }),
  );
  if (!probe) Object.assign(report, { baselineSHA: metadata.baselineSHA, review: metadata.review });
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
