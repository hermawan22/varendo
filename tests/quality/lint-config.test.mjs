import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const binary = resolve(root, 'node_modules/oxlint/bin/oxlint');
const config = resolve(root, '.oxlintrc.json');

function lint(path) {
  return spawnSync(binary, ['--config', config, '--deny-warnings', path], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('source lint rejects a correctness violation and accepts valid JavaScript', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-lint-contract-'));
  try {
    const fixture = join(directory, 'fixture.mjs');
    await writeFile(fixture, 'const unused = 1;\n');
    const invalid = lint(fixture);
    assert.notEqual(invalid.status, 0);
    assert.match(`${invalid.stdout}\n${invalid.stderr}`, /no-unused-vars/u);

    await writeFile(fixture, 'export const used = 1;\n');
    const valid = lint(fixture);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
