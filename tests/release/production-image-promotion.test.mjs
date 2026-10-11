import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publisher = fileURLToPath(new URL('../../apps/site/scripts/ci/publish-production-image.sh', import.meta.url));
const fakeTools = new URL('./fixtures/production-image-tools.mjs', import.meta.url).href;
const image = 'ghcr.io/hermawan22/varendo-web';
const digest = 'sha256:' + 'a'.repeat(64);
const fluxTag = /^[0-9a-f]{40}-[0-9]+-[0-9]+$/u;

async function runPublisher(t, mode = 'success', environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-image-promotion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Release fixture']);
  git(['config', 'user.email', 'release@example.invalid']);
  await mkdir(join(directory, 'packages/core'), { recursive: true });
  await writeFile(join(directory, 'release-metadata.json'), JSON.stringify({ version: '0.7.0' }));
  await writeFile(join(directory, 'packages/core/package.json'), JSON.stringify({ version: '0.7.0' }));
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'Trusted release fixture']);
  const source = git(['rev-parse', 'HEAD']);
  const policy = join(directory, 'artifacts/site-release-policy');
  await mkdir(policy, { recursive: true });
  await writeFile(
    join(policy, 'registry-consumer.json'),
    JSON.stringify({
      version: '0.7.0',
      expectedSourceRevision: source,
      provenanceVerified: true,
      packages: Array(5).fill({}),
    }),
  );
  await writeFile(
    join(policy, 'export-consumer.json'),
    JSON.stringify({
      schema: 'aeliqo.export-registry.v1',
      status: 'passed',
      version: '0.7.0',
      sourceRevision: source,
      scenarios: Array(4).fill({ build: 'passed' }),
      tags: Array(5).fill('0.7.0'),
    }),
  );
  const binary = join(directory, 'fake-bin');
  const runner = join(directory, 'runner');
  await mkdir(binary);
  await mkdir(runner);
  for (const command of ['docker', 'curl', 'python3', 'tar', 'sha256sum'])
    await writeFile(join(binary, command), '#!/usr/bin/env node\nimport ' + JSON.stringify(fakeTools) + ';\n', {
      mode: 0o755,
    });
  const log = join(directory, 'calls.jsonl');
  const registry = join(directory, 'registry.json');
  await writeFile(log, '');
  await writeFile(registry, JSON.stringify({ tags: {} }));
  const result = spawnSync('bash', [publisher], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: 'bounded-test-token',
      GH_ACTOR: 'hermawan22',
      GH_TRIGGERING_ACTOR: 'hermawan22',
      GH_REPO: 'hermawan22/varendo',
      SOURCE_SHA: source,
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      RUNNER_TEMP: runner,
      AELIQO_EXPORT_VERIFIED_VERSION: '0.7.0',
      AELIQO_REGISTRY_SOURCE: source,
      IMAGE_TEST_LOG: log,
      IMAGE_TEST_REGISTRY: registry,
      IMAGE_TEST_MODE: mode,
      IMAGE_TEST_PYTHON: execFileSync('which', ['python3'], { encoding: 'utf8' }).trim(),
      IMAGE_TEST_SHA256: execFileSync('which', ['sha256sum'], { encoding: 'utf8' }).trim(),
      PATH: binary + ':' + process.env.PATH,
      ...environment,
    },
  });
  return {
    result,
    directory,
    source,
    calls: (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
    registry: JSON.parse(await readFile(registry, 'utf8')),
  };
}

const eligible = (state) =>
  Object.keys(state.registry.tags).filter((reference) => fluxTag.test(reference.slice(reference.lastIndexOf(':') + 1)));

for (const mode of ['provenance-failure', 'sbom-failure', 'scan-failure']) {
  test(`${mode} never publishes a Flux-eligible image`, async (t) => {
    const state = await runPublisher(t, mode);
    assert.notEqual(state.result.status, 0, state.result.stderr);
    assert.equal(Object.keys(state.registry.tags).length, 1, 'Only the candidate image can have been pushed.');
    assert.deepEqual(eligible(state), []);
    assert.equal(
      state.calls.some(({ command, args }) => command === 'docker' && args[2] === 'create'),
      false,
    );
    await assert.rejects(readFile(join(state.directory, 'apps/site/artifacts/production-image/image.json')), {
      code: 'ENOENT',
    });
  });
}

test('successful gates promote the scanned OCI index and preserve its attestations and final artifact', async (t) => {
  const state = await runPublisher(t);
  assert.equal(state.result.status, 0, state.result.stderr);
  const reference = `${image}:${state.source}-123-2`;
  assert.deepEqual(eligible(state), [reference]);
  const quarantine = Object.keys(state.registry.tags).find((value) => value !== reference);
  assert.ok(quarantine);
  assert.deepEqual(state.registry.tags[reference], state.registry.tags[quarantine]);
  const promotion = state.calls.findIndex(
    ({ command, args }) => command === 'docker' && args[1] === 'imagetools' && args[2] === 'create',
  );
  const scan = state.calls.findIndex(({ command, args }) => command === 'trivy' && args.includes('--severity'));
  assert.ok(promotion > scan && scan >= 0, 'The severity gate must finish before promotion.');
  assert.ok(state.calls[promotion].args.includes('--prefer-index=false'));
  assert.equal(state.calls[promotion].args.at(-1), `${image}@${digest}`);
  const artifact = JSON.parse(
    await readFile(join(state.directory, 'apps/site/artifacts/production-image/image.json'), 'utf8'),
  );
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.tag, `${state.source}-123-2`);
  assert.equal(artifact.digest, digest);
  assert.equal(artifact.reference, `${image}@${digest}`);
  assert.equal(artifact.provenance.verifiedFromRegistry, true);
});

test('main advancing during successful gates leaves the superseded image quarantined', async (t) => {
  const state = await runPublisher(t, 'main-advanced');
  assert.notEqual(state.result.status, 0, state.result.stderr);
  assert.equal(state.registry.branchChecks, 2);
  assert.equal(Object.keys(state.registry.tags).length, 1);
  assert.deepEqual(eligible(state), []);
  assert.ok(state.calls.some(({ command, args }) => command === 'trivy' && args.includes('--severity')));
  assert.equal(
    state.calls.some(({ command, args }) => command === 'docker' && args[2] === 'create'),
    false,
  );
  await assert.rejects(readFile(join(state.directory, 'apps/site/artifacts/production-image/image.json')), {
    code: 'ENOENT',
  });
});

for (const mode of ['copy-digest-mismatch', 'registry-digest-mismatch']) {
  test(`${mode} rejects successful release evidence`, async (t) => {
    const state = await runPublisher(t, mode);
    assert.notEqual(state.result.status, 0, state.result.stderr);
    await assert.rejects(readFile(join(state.directory, 'apps/site/artifacts/production-image/image.json')), {
      code: 'ENOENT',
    });
  });
}

for (const [mode, environment] of [
  ['main-mismatch', {}],
  ['success', { GH_TRIGGERING_ACTOR: 'other' }],
]) {
  test(`release ownership rejects ${mode === 'main-mismatch' ? 'stale main' : 'another triggering actor'} before any push`, async (t) => {
    const state = await runPublisher(t, mode, environment);
    assert.notEqual(state.result.status, 0, state.result.stderr);
    assert.deepEqual(state.registry.tags, {});
  });
}
