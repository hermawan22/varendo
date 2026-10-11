import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/release/verify-quality-evidence.mjs');
const revision = 'a'.repeat(40);
const kinds = ['typecheck', 'unit', 'browser', 'packages', 'performance', 'lint', 'security', 'boundaries'];

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceRevision: revision,
    status: 'passed',
    sourceChangedDuringRun: false,
    results: kinds.map((kind) => ({ kind, exitCode: 0, log: { sha256: 'b'.repeat(64) } })),
    ...overrides,
  };
}

test('release accepts only passing same-source quality evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-quality-evidence-'));
  const path = join(directory, 'ci.json');
  try {
    await writeFile(path, JSON.stringify(evidence()));
    const result = await execute(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, GITHUB_SHA: revision, AELIQO_CI_EVIDENCE_PATH: path },
    });
    assert.match(result.stdout, /"commands":8/u);

    await writeFile(path, JSON.stringify(evidence({ sourceRevision: 'c'.repeat(40) })));
    await assert.rejects(
      execute(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: revision, AELIQO_CI_EVIDENCE_PATH: path },
      }),
      /exact release source revision/u,
    );

    await writeFile(
      path,
      JSON.stringify(evidence({ results: evidence().results.filter(({ kind }) => kind !== 'performance') })),
    );
    await assert.rejects(
      execute(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: revision, AELIQO_CI_EVIDENCE_PATH: path },
      }),
      /missing the performance boundary/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
