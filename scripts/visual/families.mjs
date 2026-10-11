import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testInventory } from './shards.mjs';

function plannedFamilies(plan) {
  testInventory(plan);
  const files = plan.suites.map((suite) => suite.file);
  assert.equal(new Set(files).size, files.length, 'Duplicate planned family');
  for (const file of files) assert.match(file, /^[a-z0-9-]+\.spec\.ts$/u, 'Unsafe planned family path');
  return plan.suites.map((suite) => ({ file: suite.file, tests: testInventory({ suites: [suite] }) }));
}

async function copyOutputs(directory, destination, paths) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'results.json' || entry.name === '.last-run.json') continue;
    assert.ok(!entry.isSymbolicLink(), 'Unexpected capture symlink');
    assert.ok(!paths.has(entry.name), `Capture output collision: ${entry.name}`);
    paths.add(entry.name);
    await cp(join(directory, entry.name), join(destination, entry.name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

export async function captureFamilies(destination, plan, runFamily) {
  const families = plannedFamilies(plan);
  const reports = [];
  const directories = [];
  // Keep raw reports outside the flat image inventory, including on failure.
  await mkdir(destination, { recursive: true });
  assert.equal((await readdir(destination)).length, 0, 'Capture destination must be empty');
  for (const family of families) {
    const directory = join(destination + '-families', family.file);
    await mkdir(directory, { recursive: true });
    assert.equal((await readdir(directory)).length, 0, 'Family destination must be empty');
    await runFamily(family.file, directory);
    const report = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
    assert.deepEqual(testInventory(report, true), family.tests, 'Incomplete or unexpected family tests');
    reports.push(report);
    directories.push(directory);
  }
  const merged = { config: plan.config, suites: reports.flatMap((report) => report.suites), errors: [] };
  assert.deepEqual(testInventory(merged, true), testInventory(plan), 'Incomplete capture test union');
  const paths = new Set();
  for (const directory of directories) await copyOutputs(directory, destination, paths);
  await writeFile(join(destination, 'results.json'), `${JSON.stringify(merged, null, 2)}\n`);
}
