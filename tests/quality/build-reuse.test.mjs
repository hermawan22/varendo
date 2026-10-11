import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const helper = resolve(root, 'scripts/reuse-build.mjs');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-build-reuse-'));
  const command = join(directory, 'build.mjs');
  await writeFile(
    command,
    `
    import {mkdir, readFile, writeFile} from 'node:fs/promises';
    const count = Number(await readFile('count', 'utf8').catch(() => '0')) + 1;
    await writeFile('count', String(count));
    await mkdir('dist', {recursive: true});
    await writeFile('dist/index.js', 'export const count = ' + count + ';\\n');
    if (process.env.FAIL_BUILD === '1') process.exit(7);
  `,
  );
  return { directory, command };
}

function run(directory, command, environment = {}) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.AELIQO_BUILD_REUSE_DIRECTORY;
  delete childEnvironment.FAIL_BUILD;
  return spawnSync(process.execPath, [helper, 'fixture', 'dist', '--', process.execPath, command], {
    cwd: directory,
    env: { ...childEnvironment, ...environment },
    encoding: 'utf8',
  });
}

test('standalone package builds always execute', async () => {
  const { directory, command } = await fixture();
  try {
    assert.equal(run(directory, command).status, 0);
    assert.equal(run(directory, command).status, 0);
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one quality invocation reuses a successful build with complete outputs', async () => {
  const { directory, command } = await fixture();
  const reuse = await mkdtemp(join(tmpdir(), 'aeliqo-build-markers-'));
  try {
    const environment = { AELIQO_BUILD_REUSE_DIRECTORY: reuse };
    assert.equal(run(directory, command, environment).status, 0);
    const second = run(directory, command, environment);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Reusing fixture build/u);
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '1');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(reuse, { recursive: true, force: true });
  }
});

test('a failed build is not marked reusable', async () => {
  const { directory, command } = await fixture();
  const reuse = await mkdtemp(join(tmpdir(), 'aeliqo-build-markers-'));
  try {
    assert.equal(run(directory, command, { AELIQO_BUILD_REUSE_DIRECTORY: reuse, FAIL_BUILD: '1' }).status, 7);
    assert.equal(run(directory, command, { AELIQO_BUILD_REUSE_DIRECTORY: reuse }).status, 0);
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(reuse, { recursive: true, force: true });
  }
});

test('a missing recorded output invalidates the marker', async () => {
  const { directory, command } = await fixture();
  const reuse = await mkdtemp(join(tmpdir(), 'aeliqo-build-markers-'));
  try {
    const environment = { AELIQO_BUILD_REUSE_DIRECTORY: reuse };
    assert.equal(run(directory, command, environment).status, 0);
    await unlink(join(directory, 'dist/index.js'));
    assert.equal(run(directory, command, environment).status, 0);
    await access(join(directory, 'dist/index.js'));
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(reuse, { recursive: true, force: true });
  }
});

test('same-name output corruption invalidates the marker', async () => {
  const { directory, command } = await fixture();
  const reuse = await mkdtemp(join(tmpdir(), 'aeliqo-build-markers-'));
  try {
    const environment = { AELIQO_BUILD_REUSE_DIRECTORY: reuse };
    assert.equal(run(directory, command, environment).status, 0);
    await writeFile(join(directory, 'dist/index.js'), 'corrupt\n');
    assert.equal(run(directory, command, environment).status, 0);
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '2');
    assert.equal(await readFile(join(directory, 'dist/index.js'), 'utf8'), 'export const count = 2;\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(reuse, { recursive: true, force: true });
  }
});

test('a failed rebuild cannot leave an earlier marker reusable', async () => {
  const { directory, command } = await fixture();
  const reuse = await mkdtemp(join(tmpdir(), 'aeliqo-build-markers-'));
  try {
    const environment = { AELIQO_BUILD_REUSE_DIRECTORY: reuse };
    assert.equal(run(directory, command, environment).status, 0);
    await unlink(join(directory, 'dist/index.js'));
    assert.equal(run(directory, command, { ...environment, FAIL_BUILD: '1' }).status, 7);
    assert.equal(run(directory, command, environment).status, 0);
    assert.equal(await readFile(join(directory, 'count'), 'utf8'), '3');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(reuse, { recursive: true, force: true });
  }
});

test('logged commands return elapsed seconds with their exit code', () => {
  const script = `
import json, pathlib, sys, tempfile
sys.path.insert(0, 'scripts')
import quality
with tempfile.TemporaryFile() as log:
    result = quality.run_timed_logged_command([sys.executable, '-c', 'import time; time.sleep(0.02)'], pathlib.Path('.'), log, 2)
print(json.dumps(result))
`;
  const result = spawnSync('python3', ['-c', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [code, elapsedSeconds] = JSON.parse(result.stdout);
  assert.equal(code, 0);
  assert(elapsedSeconds >= 0.01);
});
