import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { captureFamilies } from '../../scripts/visual/families.mjs';
import { captureArguments } from '../../scripts/visual/capture.mjs';
import { testInventory } from '../../scripts/visual/shards.mjs';

function suite(file, id) {
  return {
    file,
    specs: [
      {
        id,
        tests: [
          { projectName: 'firefox', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] },
        ],
      },
    ],
  };
}
const plan = () => ({ suites: [suite('first.spec.ts', 'one'), suite('second.spec.ts', 'two')], errors: [] });
async function fixture(mutate = () => {}) {
  const destination = join(await mkdtemp(join(tmpdir(), 'aeliqo-families-')), 'candidate');
  const calls = [];
  const run = async (file, directory) => {
    calls.push(file);
    const report = { suites: [structuredClone(plan().suites.find((item) => item.file === file))], errors: [] };
    const trace = join(directory, 'output-' + file, 'trace.zip');
    report.suites[0].specs[0].tests[0].results[0].attachments = [{ name: 'trace', path: trace }];
    mutate(report, calls.length);
    await mkdir(join(directory, 'output-' + file), { recursive: true });
    await writeFile(join(directory, 'output-' + file, 'capture.png'), file);
    await writeFile(trace, 'raw trace');
    await writeFile(join(directory, 'results.json'), JSON.stringify(report));
    await writeFile(join(directory, '.last-run.json'), '{}');
  };
  return { destination, calls, run };
}
test('runs planned families sequentially once and preserves raw reports plus flat capture paths', async () => {
  const f = await fixture();
  await captureFamilies(f.destination, plan(), f.run);
  assert.deepEqual(f.calls, ['first.spec.ts', 'second.spec.ts']);
  const report = JSON.parse(await readFile(join(f.destination, 'results.json'), 'utf8'));
  assert.deepEqual(testInventory(report, true), testInventory(plan()));
  for (const item of report.suites) {
    const attachment = item.specs[0].tests[0].results[0].attachments[0];
    assert.ok(attachment.path.startsWith(f.destination + '-families/'));
    assert.equal(await readFile(attachment.path, 'utf8'), 'raw trace');
  }
  for (const file of f.calls) {
    assert.equal(await readFile(join(f.destination, 'output-' + file, 'capture.png'), 'utf8'), file);
    await access(join(f.destination + '-families', file, 'results.json'));
  }
});
for (const [label, mutate] of [
  ['missing test', (r) => (r.suites[0].specs = [])],
  ['duplicate test', (r) => r.suites[0].specs.push(r.suites[0].specs[0])],
  ['wrong test', (r) => (r.suites[0].specs[0].id = 'other')],
  ['extra test', (r) => r.suites[0].specs.push(suite('extra.spec.ts', 'extra').specs[0])],
  ['expected failure', (r) => (r.suites[0].specs[0].tests[0].expectedStatus = 'failed')],
  ['failed test', (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'failed')],
  ['cancelled test', (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'interrupted')],
  ['skipped test', (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped')],
  ['retried test', (r) => r.suites[0].specs[0].tests[0].results.push({ status: 'passed' })],
  ['missing result', (r) => (r.suites[0].specs[0].tests[0].results = [])],
  ['report error', (r) => r.errors.push({ message: 'failure' })],
])
  test(`rejects ${label}, retains raw output, and stops before next family`, async () => {
    const f = await fixture(mutate);
    await assert.rejects(captureFamilies(f.destination, plan(), f.run));
    assert.deepEqual(f.calls, ['first.spec.ts']);
    await access(join(f.destination + '-families', 'first.spec.ts', 'results.json'));
    await assert.rejects(access(join(f.destination, 'results.json')));
  });
test('rejects missing family report and process failure without continuing', async () => {
  for (const run of [
    async () => {},
    async () => {
      throw Error('process failed');
    },
  ]) {
    const f = await fixture();
    await assert.rejects(captureFamilies(f.destination, plan(), run));
    await assert.rejects(access(join(f.destination, 'results.json')));
  }
});
test('retains earlier reports and failed-family output without publishing an incomplete union', async () => {
  const f = await fixture();
  await assert.rejects(
    captureFamilies(f.destination, plan(), async (file, directory) => {
      await f.run(file, directory);
      if (file === 'second.spec.ts') throw Error('process failed after report');
    }),
  );
  assert.deepEqual(f.calls, ['first.spec.ts', 'second.spec.ts']);
  for (const file of f.calls) await access(join(f.destination + '-families', file, 'results.json'));
  await assert.rejects(access(join(f.destination, 'results.json')));
});
test('rejects a stale populated destination before running any family', async () => {
  const f = await fixture();
  await mkdir(f.destination);
  await writeFile(join(f.destination, 'results.json'), '{}');
  await assert.rejects(captureFamilies(f.destination, plan(), f.run), /empty/);
  assert.deepEqual(f.calls, []);
});
test('rejects duplicate or unsafe planned family paths before execution', async () => {
  for (const file of ['first.spec.ts', '../outside.spec.ts']) {
    const p = plan();
    p.suites[1].file = file;
    const f = await fixture();
    await assert.rejects(captureFamilies(f.destination, p, f.run));
    assert.deepEqual(f.calls, []);
  }
});
test('rejects output collisions rather than overwriting earlier images', async () => {
  const f = await fixture();
  await assert.rejects(
    captureFamilies(f.destination, plan(), async (file, directory) => {
      await f.run(file, directory);
      await mkdir(join(directory, 'collision'));
      await writeFile(join(directory, 'collision', 'capture.png'), file);
    }),
    /collision/i,
  );
  await assert.rejects(access(join(f.destination, 'results.json')));
});

for (const project of ['chromium', 'firefox', 'webkit'])
  test(`real Playwright parser keeps every unfiltered ${project} family separate from its project option`, async () => {
    const destination = await mkdtemp(join(tmpdir(), 'aeliqo-family-cli-'));
    const args = captureArguments(project, { batch: null, grep: null });
    function list(extra = []) {
      const result = spawnSync('pnpm', [...args, ...extra, '--list', '--reporter=json'], {
        encoding: 'utf8',
        env: { ...process.env, AELIQO_VISUAL_CAPTURE: destination },
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    }
    const complete = list();
    const actual = [];
    for (const family of complete.suites) {
      const report = list([`tests/visual/${family.file}`]);
      assert.deepEqual(testInventory(report), testInventory({ suites: [family] }));
      actual.push(...testInventory(report));
    }
    assert.deepEqual(actual.sort(), testInventory(complete));
    assert.ok(actual.every((id) => id.startsWith(`${project}:`)));
  });
