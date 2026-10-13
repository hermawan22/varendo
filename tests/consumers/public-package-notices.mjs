/** Verify the five published packages carry the canonical legal files. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PUBLIC_PACKAGES } from '../../scripts/release/candidate-lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const publicPackages = PUBLIC_PACKAGES;
const workspacePackages = [...publicPackages, 'testkit'];

function run(argv, cwd) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

for (const name of workspacePackages) {
  const manifest = JSON.parse(await readFile(join(root, 'packages', name, 'package.json'), 'utf8'));
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.private === true, name === 'testkit', `${manifest.name} public/private classification drift`);
}

const output = await mkdtemp(join(tmpdir(), 'varendo-public-notices-'));
try {
  for (const name of publicPackages) {
    const directory = join(root, 'packages', name);
    run(['pnpm', 'pack', '--out', join(output, `${name}.tgz`)], directory);
    const entries = run(['tar', '-tzf', join(output, `${name}.tgz`)], root)
      .trim()
      .split('\n');
    assert(entries.includes('package/NOTICE'), `@varendo/${name} tarball is missing NOTICE`);
    assert(entries.includes('package/LICENSE'), `@varendo/${name} tarball is missing LICENSE`);
    assert(
      await readFile(join(root, 'docs/packages', `${name}.md`)),
      `@varendo/${name} has no canonical package guide`,
    );
  }
  console.log(JSON.stringify({ passed: true, publicPackages, internalWorkspace: '@varendo/testkit' }, null, 2));
} finally {
  await rm(output, { recursive: true, force: true });
}
