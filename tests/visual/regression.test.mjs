import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveInputs, imageInventory, verifyRepeat, runCaptures } from '../../scripts/visual/policy.mjs';

const approved = {
  status: 'approved',
  baselineSHA: 'a'.repeat(40),
  fixtureSHA: 'b'.repeat(64),
  review: 'https://example.test/review/1',
  runner: { container: `sha256:${'c'.repeat(64)}` },
};
test('Chromium visual captures use a fixed software raster path without changing the other engines', async () => {
  const { default: config } = await import('./playwright.config.mjs');
  assert.deepEqual(
    config.projects.map(({ name }) => name),
    ['chromium', 'firefox', 'webkit'],
  );
  assert.deepEqual(config.projects[0].use.launchOptions, {
    args: ['--disable-gpu', '--disable-skia-runtime-opts', '--disable-partial-raster'],
  });
  assert.equal(config.projects[1].use.launchOptions, undefined);
  assert.equal(config.projects[2].use.launchOptions, undefined);
});
test('unapproved metadata cannot run a baseline comparison', () => {
  assert.throws(() => approveInputs({ ...approved, status: 'candidate' }), /approved/u);
});
test('approval requires exact immutable source and fixture hashes and runner', () => {
  for (const patch of [{ baselineSHA: 'HEAD' }, { fixtureSHA: '' }, { review: '' }, { runner: {} }]) {
    assert.throws(() => approveInputs({ ...approved, ...patch }));
  }
  assert.doesNotThrow(() => approveInputs(approved));
});
test('double capture rejects empty, missing, and changing images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-policy-'));
  const first = join(dir, 'first');
  const second = join(dir, 'second');
  await mkdir(first);
  await mkdir(second);
  await assert.rejects(verifyRepeat(first, second), /No PNG/u);
  await writeFile(join(first, 'state.png'), 'first');
  await assert.rejects(verifyRepeat(first, second), /No PNG|inventory/u);
  await writeFile(join(second, 'state.png'), 'second');
  await assert.rejects(verifyRepeat(first, second), /nondeterministic/u);
  await writeFile(join(second, 'state.png'), 'first');
  assert.equal((await verifyRepeat(first, second)).length, 1);
  assert.deepEqual(await imageInventory(first), ['state.png']);
});
test('capture failure stops before comparison; differences never overwrite baseline', async () => {
  const events = [];
  const capture = async (source, label) => {
    events.push(label);
    if (label === 'baseline-repeat') throw Error('capture failed');
    return source;
  };
  await assert.rejects(
    runCaptures({
      baseline: 'base',
      candidate: 'next',
      capture,
      verify: async () => {},
      compare: async () => events.push('compare'),
    }),
    /capture failed/u,
  );
  assert.deepEqual(events, ['baseline', 'baseline-repeat']);
  const dir = await mkdtemp(join(tmpdir(), 'visual-immutable-'));
  const baseline = join(dir, 'base.png');
  await writeFile(baseline, 'reviewed');
  await assert.rejects(
    runCaptures({
      baseline,
      candidate: 'next',
      capture: async (source) => source,
      verify: async () => {},
      compare: async () => {
        throw Error('pixel difference');
      },
    }),
    /pixel difference/u,
  );
  assert.equal(await readFile(baseline, 'utf8'), 'reviewed');
});
test('both sources must pass double capture before comparing', async () => {
  const events = [];
  await runCaptures({
    baseline: 'base',
    candidate: 'next',
    capture: async (_, label) => {
      events.push(label);
      return label;
    },
    verify: async (a, b) => events.push(`${a}=${b}`),
    compare: async () => events.push('compare'),
  });
  assert.deepEqual(events, [
    'baseline',
    'baseline-repeat',
    'baseline=baseline-repeat',
    'candidate',
    'candidate-repeat',
    'candidate=candidate-repeat',
    'compare',
  ]);
});

test('CLI fails closed for unapproved source and refuses filtered full runs', async () => {
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'visual-cli-'));
  await mkdir(join(directory, 'scripts/visual'), { recursive: true });
  const metadata = join(directory, 'scripts/visual/baseline.json');
  await writeFile(metadata, JSON.stringify({ status: 'unapproved' }));
  const script = new URL('../../scripts/visual/run.mjs', import.meta.url).pathname;
  const rejected = spawnSync(process.execPath, [script, '--full'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, AELIQO_VISUAL_PROJECT: '', AELIQO_VISUAL_BATCH: '', AELIQO_VISUAL_GREP: '' },
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /has not been approved/u);
  assert.equal(await readFile(metadata, 'utf8'), JSON.stringify({ status: 'unapproved' }));
  const selected = spawnSync(process.execPath, [script, '--probe', '--full'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, AELIQO_VISUAL_PROJECT: 'chromium' },
  });
  assert.equal(selected.status, 1);
  assert.match(selected.stdout, /rejects selection filters/u);
});

test('hosted CI image identity can replace a container digest without inventing one', () => {
  const runner = {
    container: null,
    hostImage: { provider: 'github-actions', os: 'ubuntu24', version: '20260920.1.0' },
  };
  assert.doesNotThrow(() => approveInputs({ ...approved, runner }));
  for (const version of ['latest', '', 'ubuntu-latest']) {
    assert.throws(() =>
      approveInputs({ ...approved, runner: { ...runner, hostImage: { ...runner.hostImage, version } } }),
    );
  }
});

test('review evidence must identify an actual record, not an arbitrary truthy value', () => {
  for (const review of [{}, [], true, 123, '   ']) {
    assert.throws(() => approveInputs({ ...approved, review }), /review evidence/u);
  }
});

test('fixture identity binds capture and comparison code but excludes approval metadata', async () => {
  const { fixtureDigest } = await import('../../scripts/visual/environment.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'visual-fixture-'));
  await mkdir(join(directory, 'catalog'), { recursive: true });
  await mkdir(join(directory, 'scripts/visual'), { recursive: true });
  await mkdir(join(directory, 'tests/visual'), { recursive: true });
  await writeFile(join(directory, 'catalog/components.json'), '{}');
  await writeFile(join(directory, 'scripts/visual/capture.mjs'), 'capture v1');
  await writeFile(join(directory, 'scripts/visual/baseline.json'), 'unapproved');
  await writeFile(join(directory, 'tests/visual/regression.capture.playwright.config.mjs'), 'config v1');
  const first = await fixtureDigest(directory);
  await writeFile(join(directory, 'scripts/visual/baseline.json'), 'approved');
  assert.equal(await fixtureDigest(directory), first);
  await writeFile(join(directory, 'scripts/visual/capture.mjs'), 'capture v2');
  const second = await fixtureDigest(directory);
  assert.notEqual(second, first);
  await writeFile(join(directory, 'tests/visual/regression.capture.playwright.config.mjs'), 'config v2');
  assert.notEqual(await fixtureDigest(directory), second);
});

test('container identity does not depend on the mutable hosted image label', async () => {
  const { runnerIdentity } = await import('../../scripts/visual/environment.mjs');
  const env = {
    GITHUB_ACTIONS: 'true',
    ImageOS: 'ubuntu24',
    ImageVersion: '20260920.1.0',
    AELIQO_VISUAL_CONTAINER_DIGEST: `sha256:${'c'.repeat(64)}`,
  };
  assert.deepEqual(runnerIdentity(env), runnerIdentity({ ...env, ImageVersion: '20260927.1.0' }));
  assert.equal(runnerIdentity(env).hostImage, null);
  assert.notDeepEqual(
    runnerIdentity({ ...env, AELIQO_VISUAL_CONTAINER_DIGEST: undefined }),
    runnerIdentity({ ...env, AELIQO_VISUAL_CONTAINER_DIGEST: undefined, ImageVersion: '20260927.1.0' }),
  );
});

test('clean probe evidence fails if the source becomes dirty or moves during capture', async () => {
  const { verifyCandidateSource } = await import('../../scripts/visual/policy.mjs');
  const before = { sha: 'a'.repeat(40), dirty: false };
  assert.throws(() => verifyCandidateSource(before, { ...before, dirty: true }), /became dirty/u);
  assert.throws(() => verifyCandidateSource(before, { ...before, sha: 'b'.repeat(40) }), /source changed/u);
  assert.doesNotThrow(() => verifyCandidateSource(before, before));
  assert.doesNotThrow(() => verifyCandidateSource({ ...before, dirty: true }, { ...before, dirty: true }));
});

test('visual fixtures build and serve the canonical production entry in a port-isolated directory', async () => {
  const { default: capture } = await import('./playwright.config.mjs');
  const { default: fixture } = await import('./vite.config.mjs');
  assert.match(capture.webServer.command, /vite build --config tests\/visual\/vite\.config\.mjs/u);
  assert.match(capture.webServer.command, /&& .*vite preview --config tests\/visual\/vite\.config\.mjs/u);
  assert.equal(capture.webServer.reuseExistingServer, false);
  assert.equal(capture.webServer.timeout, 30000);
  assert.equal(fixture.publicDir, false);
  assert.equal(fixture.base, '/');
  assert.equal(fixture.build.rollupOptions.input, join(fixture.root, 'tests/visual/index.html'));
  assert.equal(fixture.build.outDir, join(fixture.root, 'artifacts/visual-fixture', process.env.AELIQO_VISUAL_PORT));
  assert.equal(fixture.build.emptyOutDir, true);
  assert.equal(fixture.build.sourcemap, false);
});

test('production visual fixtures reject missing or unsafe ports and isolate different servers', async () => {
  const previous = process.env.AELIQO_VISUAL_PORT;
  try {
    for (const port of [undefined, '', '0', '-1', '65536', '../outside', '12.5']) {
      if (port === undefined) delete process.env.AELIQO_VISUAL_PORT;
      else process.env.AELIQO_VISUAL_PORT = port;
      await assert.rejects(
        import(`./vite.config.mjs?invalid=${encodeURIComponent(String(port))}`),
        /AELIQO_VISUAL_PORT/u,
      );
    }
    const directories = [];
    for (const port of ['4931', '4932']) {
      process.env.AELIQO_VISUAL_PORT = port;
      const { default: fixture } = await import(`./vite.config.mjs?valid=${port}`);
      directories.push(fixture.build.outDir);
      assert.equal(fixture.build.outDir, join(fixture.root, 'artifacts/visual-fixture', port));
    }
    assert.notEqual(directories[0], directories[1]);
  } finally {
    if (previous === undefined) delete process.env.AELIQO_VISUAL_PORT;
    else process.env.AELIQO_VISUAL_PORT = previous;
  }
});
