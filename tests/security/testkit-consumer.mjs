import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build,
  pack,
  install and exercise the internal @varendo/testkit boundary.
 *
 * The consumer is created in the operating-system temporary directory,
  outside
 * this pnpm workspace. It installs only exact local tarballs and npm packages,
  * so workspace links cannot satisfy an import. The report records the source
 * commit,
  candidate digest,
  package-lock hash,
  tarball hashes and environment.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const outputDirectory = join(root, 'artifacts', 'security-testkit-consumers');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'run-'));
const consumerDirectory = await mkdtemp(join(tmpdir(), 'varendo-testkit-consumer-'));

function run(argv, cwd, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout: options.timeout ?? 180_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const sha256 = (bytes) => hash(bytes);
const integrity = (bytes) => `sha512-${hash(bytes, 'sha512', 'base64')}`;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertRegularTree(path, label) {
  const stat = await lstat(path);
  assert(!stat.isSymbolicLink(), `${label} is a symlink: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) await assertRegularTree(join(path, entry), label);
  } else {
    assert(stat.isFile(), `${label} is not a regular file: ${path}`);
  }
}

function packageManifest(name) {
  return JSON.parse(
    run(
      ['node', '-e', `process.stdout.write(JSON.stringify(require('./package.json')))`],
      join(root, 'packages', name),
    ),
  );
}

const sourceCommit = run(['git', 'rev-parse', 'HEAD'], root).trim();
const sourceStatusBefore = run(['git', 'status', '--porcelain'], root).trim();
assert.equal(sourceStatusBefore, '', 'Consumer proof requires a clean source worktree.');
const globalDigestBefore = run(['node', 'scripts/source-digest.mjs'], root).trim();
assert.match(globalDigestBefore, /^[0-9a-f]{64}$/);

const manifests = {
  core: packageManifest('core'),
  runtime: packageManifest('runtime'),
  testkit: packageManifest('testkit'),
};
assert.deepEqual(
  Object.values(manifests).map((manifest) => [manifest.name, manifest.version]),
  [
    ['@varendo/core', RELEASE_VERSION],
    ['@varendo/runtime', RELEASE_VERSION],
    ['@varendo/testkit', RELEASE_VERSION],
  ],
);
for (const manifest of Object.values(manifests)) {
  assert.equal(manifest.license, 'Apache-2.0');
  if (manifest.name === '@varendo/testkit') assert.equal(manifest.private, true);
  else assert.notEqual(manifest.private, true);
  const exportKey = manifest.name === '@varendo/runtime' ? './results' : '.';
  assert.equal(typeof manifest.exports?.[exportKey]?.import, 'string');
  assert.equal(typeof manifest.exports?.[exportKey]?.types, 'string');
}

// Build every artifact from source before packing it. Build outputs are ignored
// generated files and are never accepted as source-digest evidence.
run(['pnpm', 'build'], join(root, 'packages', 'core'));
run(['pnpm', 'build'], join(root, 'packages', 'runtime'));
run(['pnpm', 'build'], join(root, 'packages', 'testkit'));

const artifactDefinitions = [
  ['core', `varendo-core-${RELEASE_VERSION}.tgz`],
  ['runtime', `varendo-runtime-${RELEASE_VERSION}.tgz`],
  ['testkit', `varendo-testkit-${RELEASE_VERSION}.tgz`],
];
const artifacts = [];
for (const [directoryName, fileName] of artifactDefinitions) {
  const directory = join(root, 'packages', directoryName);
  const path = join(runDirectory, fileName);
  run(['pnpm', 'pack', '--out', path], directory);
  const bytes = await readFile(path);
  const manifest = manifests[directoryName];
  const packedManifest = JSON.parse(run(['tar', '-xOf', path, 'package/package.json'], root));
  const expectedPackedManifest = structuredClone(manifest);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, version] of Object.entries(expectedPackedManifest[field] ?? {})) {
      if (version === 'workspace:*' || version === 'workspace:^' || version === 'workspace:~') {
        expectedPackedManifest[field][dependency] = RELEASE_VERSION;
      }
    }
  }
  assert.deepEqual(packedManifest, expectedPackedManifest, `${manifest.name} packed manifest drift`);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(
      !JSON.stringify(packedManifest[field] ?? {}).includes('workspace:'),
      `${manifest.name} contains workspace dependency alias`,
    );
  }
  const entries = run(['tar', '-tzf', path], root).trim().split('\n').filter(Boolean);
  for (const entry of entries) {
    assert(
      entry.startsWith('package/') && !entry.split('/').includes('..'),
      `${manifest.name} archive traversal: ${entry}`,
    );
  }
  assert(entries.includes('package/LICENSE'), `${manifest.name} tarball has no LICENSE`);
  if (manifest.private) {
    assert(!entries.includes('package/README.md'), `${manifest.name} tarball duplicates internal documentation`);
  } else {
    assert(entries.includes('package/README.md'), `${manifest.name} tarball has no README.md`);
  }
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${manifest.name} source leaked into tarball`);
  const packedLicense = await new Promise((resolve, reject) => {
    const child = spawnSync('tar', ['-xOf', path, 'package/LICENSE'], { encoding: 'buffer' });
    if (child.error || child.status !== 0) reject(child.error ?? new Error(String(child.stderr)));
    else resolve(child.stdout);
  });
  const repositoryLicense = await readFile(join(root, 'LICENSE'));
  assert.deepEqual(packedLicense, repositoryLicense, `${manifest.name} license differs from repository license`);
  artifacts.push({
    name: manifest.name,
    version: manifest.version,
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    integrity: integrity(bytes),
    entries,
    licenseSha256: sha256(packedLicense),
  });
}

await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
run(
  [
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    ...artifacts.map((artifact) => artifact.path),
    'typescript@7.0.2',
  ],
  consumerDirectory,
);

const consumerReal = await realpath(consumerDirectory);
const lockBytes = await readFile(join(consumerDirectory, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const artifact of artifacts) {
  const location = `node_modules/${artifact.name}`;
  const lockEntry = lock.packages[location];
  assert.equal(lockEntry.version, artifact.version);
  assert.equal(lockEntry.integrity, artifact.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate installed ${artifact.name}`,
  );
  const installed = join(consumerDirectory, location);
  const installedReal = await realpath(installed);
  assert(installedReal.startsWith(`${consumerReal}/node_modules/`), `${artifact.name} escaped consumer node_modules`);
  await assertRegularTree(installed, `Installed ${artifact.name}`);
}
assert.equal(lock.packages['node_modules/@varendo/testkit'].dependencies['@varendo/runtime'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/zod'].version, '4.5.4');
assert.match(lock.packages['node_modules/zod'].integrity, /^sha512-/);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/testkit/node_modules/')),
  [],
);
for (const artifact of artifacts) {
  const installedDirectory = join(consumerDirectory, 'node_modules', artifact.name);
  for (const entry of artifact.entries) {
    if (entry.endsWith('/')) continue;
    const relativeEntry = entry.slice('package/'.length);
    const installedPath = join(installedDirectory, relativeEntry);
    const stat = await lstat(installedPath);
    assert(
      stat.isFile() && !stat.isSymbolicLink(),
      `Installed ${artifact.name} entry is not a regular file: ${relativeEntry}`,
    );
  }
}
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

// The TypeScript check imports two public package boundaries and the locally
// packed internal testkit with the consumer's declarations. No workspace source
// or package aliases are visible.
await writeFile(
  join(consumerDirectory, 'consumer.ts'),
  `
import {CONTRACT_VERSION,
  type ResultRef,
} from '@varendo/core';
import {createResultStore, type ResultEvent, type ResultBeginInput} from '@varendo/runtime/results';
import {assertDeniedSnapshot, collectResultEvents, rowsFromResultSnapshot} from '@varendo/testkit';
const ref: ResultRef = {id: 'consumer-result', revision: 'source-1', outputId: 'rows', queryDigest: 'query-1', scopeDigest: 'scope-1'};
const key: ResultBeginInput = {principalKey: 'consumer-principal', scopeDigest: 'scope-1', policyRevision: 'policy-1', queryDigest: 'query-1', catalogRevision: 'catalog-1', functionRegistryDigest: 'functions-1', sourceRevision: 'source-1', outputId: 'rows', taskId: 'task-1', requestId: 'request-1'};
const store = createResultStore();
const handle = store.begin(key);
const event: ResultEvent = {kind: 'error', requestId: 'request-1', error: {code: 'consumer', message: 'probe', retryable: false}};
void [CONTRACT_VERSION, ref, handle, event, assertDeniedSnapshot, collectResultEvents, rowsFromResultSnapshot];
`,
);
await writeFile(
  join(consumerDirectory, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ['ES2022', 'DOM'],
      },
      files: ['consumer.ts'],
    },
    null,
    2,
  ),
);
run([join(consumerDirectory, 'node_modules', '.bin', 'tsc'), '-p', 'tsconfig.json'], consumerDirectory);

await writeFile(
  join(consumerDirectory, 'runtime-probe.mjs'),
  `
import assert from 'node:assert/strict';
import {createResultStore} from '@varendo/runtime/results';
import {assertDeniedSnapshot, collectResultEvents, rowsFromResultSnapshot} from '@varendo/testkit';

const ref = {id: 'consumer-result', revision: 'source-1', outputId: 'rows', queryDigest: 'query-1', scopeDigest: 'scope-1'};
const field = {id: 'id', label: 'ID', type: {value: 'text', nullable: false}, role: 'identity'};
const descriptor = {
  version: '1', ref, taskId: 'task-1', fields: [field], identity: ['id'], rowGrain: ['id'],
  counts: {loaded: 2, population: {kind: 'exact', value: 2, populationDigest: 'population-1'}},
  precision: {kind: 'exact'}, coverage: {kind: 'complete', populationDigest: 'population-1'},
  consistency: {kind: 'snapshot', snapshotId: 'snapshot-1', sourceRevisions: {employees: 'source-1'}},
  evidence: {kind: 'observed', source: {id: 'employees', revision: 'source-1'}}, filters: [], warnings: [], lineage: [],
};
const key = {principalKey: 'consumer-principal', scopeDigest: 'scope-1', policyRevision: 'policy-1', queryDigest: 'query-1', catalogRevision: 'catalog-1', functionRegistryDigest: 'functions-1', sourceRevision: 'source-1', outputId: 'rows', taskId: 'task-1', requestId: 'request-1', populationDigest: 'population-1'};
const events = [
  {kind: 'descriptor', descriptor},
  {kind: 'batch', result: ref, sequence: 0, rows: [{id: 'a'}, {id: 'b'}]},
  {kind: 'complete', result: ref, finalCoverage: descriptor.coverage},
];
async function* from(values) { for (const value of values) yield value; }
const store = createResultStore();
const handle = store.begin(key);
for await (const _update of handle.subscribe(from(events))) { /* consume */ }
assert.equal(handle.snapshot().status, 'ready');
assert.equal(rowsFromResultSnapshot(handle.snapshot()).length, 2);
store.revoke({principalKey: 'consumer-principal', scopeDigest: 'scope-1', policyRevision: 'policy-1'});
assertDeniedSnapshot(handle.snapshot(), 'data.authorization-revoked');
assert.equal(rowsFromResultSnapshot(handle.snapshot()).length, 0);

const collected = await collectResultEvents(from(events));
assert.equal(collected.length, 3);
let overflowClosed = false;
const runaway = {
  [Symbol.asyncIterator]() {
    return {
      async next() { return {done: false, value: events[0]}; },
      async return() { overflowClosed = true; return {done: true, value: undefined}; },
    };
  },
};
await assert.rejects(() => collectResultEvents(runaway, {maxEvents: 2, maxRows: 2, timeoutMs: 1_000}), (error) => error?.name === 'ResultCollectionLimitError');
assert.equal(overflowClosed, true);

let abortClosed = false;
const controller = new AbortController();
const pending = {
  [Symbol.asyncIterator]() {
    return {
      next() { return new Promise(() => undefined); },
      async return() { abortClosed = true; return {done: true, value: undefined}; },
    };
  },
};
const pendingCollection = collectResultEvents(pending, {maxEvents: 2, maxRows: 2, timeoutMs: 1_000, signal: controller.signal});
await Promise.resolve();
controller.abort('consumer revoke');
await assert.rejects(pendingCollection, (error) => error?.name === 'AbortError');
assert.equal(abortClosed, true);

let syncClosed = false;
let added = 0;
let removed = 0;
const listeners = new Set();
const signal = {
  aborted: false,
  reason: undefined,
  addEventListener(_type, listener) { added += 1; listeners.add(listener); },
  removeEventListener(_type, listener) { removed += 1; listeners.delete(listener); },
};
const synchronousFailure = {
  [Symbol.asyncIterator]() {
    return {
      next() { throw new Error('consumer sync source failure'); },
      async return() { syncClosed = true; return {done: true, value: undefined}; },
    };
  },
};
await assert.rejects(() => collectResultEvents(synchronousFailure, {maxEvents: 2, maxRows: 2, timeoutMs: 1_000, signal}), /consumer sync source failure/);
assert.equal(syncClosed, true);
assert.equal(added, 1);
assert.equal(removed, 1);
assert.equal(listeners.size, 0);
store.dispose();
console.log(JSON.stringify({readyRows: 2, revokedRows: 0, defaultEvents: collected.length, overflowClosed, abortClosed, syncClosed, syncAbortListeners: {added, removed, remaining: listeners.size}}));
`,
);
const probeOutput = run(['node', 'runtime-probe.mjs'], consumerDirectory).trim();
const probe = JSON.parse(probeOutput.split('\n').at(-1));
assert.deepEqual(probe, {
  readyRows: 2,
  revokedRows: 0,
  defaultEvents: 3,
  overflowClosed: true,
  abortClosed: true,
  syncClosed: true,
  syncAbortListeners: { added: 1, removed: 1, remaining: 0 },
});

const globalDigestAfter = run(['node', 'scripts/source-digest.mjs'], root).trim();
const sourceStatusAfter = run(['git', 'status', '--porcelain'], root).trim();
assert.equal(sourceStatusAfter, '', 'Consumer proof changed tracked source files.');
assert.equal(globalDigestAfter, globalDigestBefore, 'Candidate digest changed during consumer proof.');

const environment = {
  node: process.version,
  npm: run(['npm', '--version'], consumerDirectory).trim(),
  pnpm: run(['pnpm', '--version'], root).trim(),
  typescript: '7.0.2',
  os: platform(),
  release: release(),
  arch: arch(),
  cpus: cpus().length,
};
const report = {
  passed: true,
  sourceCommit,
  sourceStatusBefore,
  sourceStatusAfter,
  globalDigestBefore,
  globalDigestAfter,
  artifacts: artifacts.map(({ path: artifactPath, ...artifact }) => artifact),
  consumerDirectory,
  consumerPackageLock: {
    path: join(runDirectory, 'consumer-package-lock.json'),
    sha256: sha256(lockBytes),
    packageCount: Object.keys(lock.packages).length,
  },
  checks: {
    fullApacheLicenses: true,
    privateTestkit: true,
    noWorkspaceAliases: true,
    noInstalledSymlinks: true,
    strictTypeScript: true,
    resultStoreRevocation: true,
    boundedCollectionDefault: true,
    overflowCleanup: true,
    abortCleanup: true,
    synchronousThrowCleanup: true,
  },
  probe,
  environment,
};
await writeFile(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
