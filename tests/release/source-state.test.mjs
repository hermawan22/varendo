import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  RELEASE_SOURCE_STATUS_ARGS,
  assertReleaseSourceClean,
  isReleaseSourceClean,
} from '../../scripts/release/source-state.mjs';

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
}

test('release source status rejects tracked and non-ignored untracked changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'varendo-source-state-'));
  try {
    git(directory, 'init', '--quiet');
    await writeFile(join(directory, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(directory, 'tracked.txt'), 'clean\n');
    git(directory, 'add', '.gitignore', 'tracked.txt');
    git(
      directory,
      '-c',
      'user.name=Varendo Test',
      '-c',
      'user.email=test@invalid.example',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );

    assert.equal(isReleaseSourceClean(git(directory, ...RELEASE_SOURCE_STATUS_ARGS)), true);

    await writeFile(join(directory, 'untracked.ts'), 'export const injected = true;\n');
    const untrackedStatus = git(directory, ...RELEASE_SOURCE_STATUS_ARGS);
    assert.match(untrackedStatus, /^\?\? untracked\.ts$/mu);
    assert.throws(
      () => assertReleaseSourceClean(untrackedStatus, 'Building test artifact'),
      /tracked or non-ignored untracked changes/u,
    );

    await rm(join(directory, 'untracked.ts'));
    await writeFile(join(directory, 'tracked.txt'), 'modified\n');
    assert.equal(isReleaseSourceClean(git(directory, ...RELEASE_SOURCE_STATUS_ARGS)), false);

    await writeFile(join(directory, 'tracked.txt'), 'clean\n');
    await writeFile(join(directory, 'ignored.txt'), 'derived output\n');
    assert.equal(isReleaseSourceClean(git(directory, ...RELEASE_SOURCE_STATUS_ARGS)), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('every source-sensitive producer uses the shared all-untracked contract', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const paths = ['scripts/release/candidate.mjs', 'scripts/release/publish.mjs', 'scripts/docs/build-public-docs.mjs'];
  for (const path of paths) {
    const source = await readFile(resolve(root, path), 'utf8');
    assert.match(source, /RELEASE_SOURCE_STATUS_ARGS/u, path);
    assert.doesNotMatch(source, /untracked-files=no/u, path);
  }
});
