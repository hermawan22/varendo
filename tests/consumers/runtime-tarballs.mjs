import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the actual @varendo/core and @varendo/runtime packages
 * outside the workspace.
 *
 * This is a bounded data/results/regions/actions package-boundary check. It proves
 * strict consumer declarations,
  local execution,
  HTTP transport,
  region commits,
  * fresh-query restore,
  result leases,
  action confirmation and browser integration. It does not certify
 * every source adapter,
  the full query planner,
  or universal browser support.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  lstat,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const coreDirectory = join(root, 'packages', 'core');
const runtimeDirectory = join(root, 'packages', 'runtime');
const outputDirectory = join(root, 'artifacts', 'runtime-consumers');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'run-'));
const consumerDirectory = await mkdtemp(join(tmpdir(), 'varendo-runtime-consumer-'));

function run(argv, cwd, encoding = 'utf8', env = process.env) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding,
    env,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function sortedFiles(directory, excluded = new Set()) {
  const result = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (excluded.has(entry.name)) continue;
      const path = join(current, entry.name);
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `Refuse symlink in source tree: ${path}`);
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) result.push(path);
    }
  }
  await visit(directory);
  return result;
}

async function sourceDigest(directory) {
  const actual = await realpath(directory);
  const files = await sortedFiles(actual, new Set(['node_modules', 'dist', 'schemas']));
  const digest = createHash('sha256');
  for (const path of files) {
    digest
      .update(relative(actual, path).split('\\').join('/'))
      .update('\0')
      .update(await readFile(path));
  }
  return digest.digest('hex');
}

async function stagePackage(directory, manifest, shortName) {
  const stage = join(runDirectory, 'staged-packages', shortName);
  await mkdir(stage, { recursive: true });
  for (const path of manifest.files ?? []) {
    const source = path === 'README.md' ? join(root, 'docs/packages', `${shortName}.md`) : join(directory, path);
    await cp(source, join(stage, path), { recursive: true });
  }
  const stagedManifest = structuredClone(manifest);
  delete stagedManifest.devDependencies;
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(stagedManifest[field] ?? {})) {
      if (dependency.startsWith('@varendo/')) stagedManifest[field][dependency] = RELEASE_VERSION;
    }
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify(stagedManifest, null, 2) + '\n');
  return stage;
}

async function clearCompiledOutput(directory, allowedPattern) {
  if (!(await fileExists(directory))) return;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink(), `Refuse generated-output symlink: ${path}`);
    if (stat.isDirectory()) {
      await clearCompiledOutput(path, allowedPattern);
      await rmdir(path);
    } else {
      assert(stat.isFile() && allowedPattern.test(name), `Unexpected generated output: ${path}`);
      await unlink(path);
    }
  }
}

const coreManifest = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8'));
const runtimeManifest = JSON.parse(await readFile(join(runtimeDirectory, 'package.json'), 'utf8'));
assert.equal(coreManifest.name, '@varendo/core');
assert.equal(coreManifest.version, RELEASE_VERSION);
assert.equal(coreManifest.license, 'Apache-2.0');
assert.notEqual(coreManifest.private, true);
assert.equal(runtimeManifest.name, '@varendo/runtime');
assert.equal(runtimeManifest.version, RELEASE_VERSION);
assert.equal(runtimeManifest.license, 'Apache-2.0');
assert.notEqual(runtimeManifest.private, true);
assert.deepEqual(Object.keys(runtimeManifest.dependencies ?? {}), ['@varendo/core', 'zod']);
assert.equal(runtimeManifest.dependencies['@varendo/core'], 'workspace:*');
assert.deepEqual(Object.keys(runtimeManifest.peerDependencies ?? {}), []);
assert.deepEqual(Object.keys(runtimeManifest.optionalDependencies ?? {}), []);
assert.deepEqual(runtimeManifest.exports?.['./data'], {
  types: './dist/data/index.d.ts',
  import: './dist/data/index.js',
});
assert.deepEqual(runtimeManifest.exports?.['./audit'], {
  types: './dist/audit/index.d.ts',
  import: './dist/audit/index.js',
});
assert.deepEqual(runtimeManifest.exports?.['./surfaces'], {
  types: './dist/surfaces/index.d.ts',
  import: './dist/surfaces/index.js',
});
assert.deepEqual(runtimeManifest.exports?.['./scopes'], {
  types: './dist/scopes/index.d.ts',
  import: './dist/scopes/index.js',
});
assert.equal(runtimeManifest.exports?.['./data']?.types, './dist/data/index.d.ts');
assert.equal(runtimeManifest.exports?.['./data']?.import, './dist/data/index.js');
assert(await fileExists(join(runtimeDirectory, 'src', 'data')), 'Runtime data source is not ready');

const sourceDigestBefore = {
  core: await sourceDigest(coreDirectory),
  runtime: await sourceDigest(runtimeDirectory),
};
await clearCompiledOutput(join(coreDirectory, 'dist'), /(?:\.js|\.d\.ts|\.js\.map|\.d\.ts\.map|\.tsbuildinfo)$/);
await clearCompiledOutput(join(coreDirectory, 'schemas'), /\.schema\.json$/);
await clearCompiledOutput(join(runtimeDirectory, 'dist'), /(?:\.js|\.d\.ts|\.js\.map|\.d\.ts\.map|\.tsbuildinfo)$/);
run(['pnpm', 'build'], coreDirectory);
run(['pnpm', 'build'], runtimeDirectory);

const coreTarball = join(runDirectory, `varendo-core-${RELEASE_VERSION}.tgz`);
const runtimeTarball = join(runDirectory, `varendo-runtime-${RELEASE_VERSION}.tgz`);
const coreStage = await stagePackage(coreDirectory, coreManifest, 'core');
const runtimeStage = await stagePackage(runtimeDirectory, runtimeManifest, 'runtime');
run(['pnpm', 'pack', '--pack-destination', runDirectory], coreStage);
run(['pnpm', 'pack', '--pack-destination', runDirectory], runtimeStage);
const coreBytes = await readFile(coreTarball);
const runtimeBytes = await readFile(runtimeTarball);
const artifacts = [
  {
    name: coreManifest.name,
    version: coreManifest.version,
    path: coreTarball,
    bytes: coreBytes,
    sha256: hash(coreBytes),
    integrity: `sha512-${hash(coreBytes, 'sha512', 'base64')}`,
  },
  {
    name: runtimeManifest.name,
    version: runtimeManifest.version,
    path: runtimeTarball,
    bytes: runtimeBytes,
    sha256: hash(runtimeBytes),
    integrity: `sha512-${hash(runtimeBytes, 'sha512', 'base64')}`,
  },
];

const packedCoreManifest = JSON.parse(run(['tar', '-xOf', coreTarball, 'package/package.json'], root));
const packedRuntimeManifest = JSON.parse(run(['tar', '-xOf', runtimeTarball, 'package/package.json'], root));
assert.deepEqual(packedCoreManifest, coreManifest);
assert.equal(packedRuntimeManifest.name, '@varendo/runtime');
assert.equal(packedRuntimeManifest.version, RELEASE_VERSION);
assert.equal(packedRuntimeManifest.license, 'Apache-2.0');
assert.deepEqual(packedRuntimeManifest.exports, runtimeManifest.exports);
assert.deepEqual(Object.keys(packedRuntimeManifest.dependencies ?? {}), ['@varendo/core', 'zod']);
assert.equal(packedRuntimeManifest.dependencies['@varendo/core'], RELEASE_VERSION);
for (const manifest of [packedCoreManifest, packedRuntimeManifest]) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(
      !JSON.stringify(manifest[field] ?? {}).includes('workspace:'),
      `Workspace alias in ${manifest.name} ${field}`,
    );
  }
}

const coreEntries = run(['tar', '-tzf', coreTarball], root).trim().split('\n');
const runtimeEntries = run(['tar', '-tzf', runtimeTarball], root).trim().split('\n');
for (const [name, entries] of [
  ['@varendo/core', coreEntries],
  ['@varendo/runtime', runtimeEntries],
]) {
  for (const entry of entries) {
    assert(
      entry.startsWith('package/') && !entry.split('/').includes('..'),
      `Unexpected ${name} archive path: ${entry}`,
    );
  }
  assert(entries.includes('package/LICENSE'), `${name} archive is missing LICENSE`);
  assert(entries.includes('package/README.md'), `${name} archive is missing README.md`);
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${name} source leaked into package`);
}
assert(coreEntries.includes('package/dist/index.js'), 'Core dist entry is absent from tarball');
assert(runtimeEntries.includes('package/dist/data/index.js'), 'Runtime data dist entry is absent from tarball');
assert(runtimeEntries.includes('package/dist/data/index.d.ts'), 'Runtime data declarations are absent from tarball');
assert(runtimeEntries.includes('package/dist/audit/index.js'), 'Runtime audit dist entry is absent from tarball');
assert(runtimeEntries.includes('package/dist/audit/index.d.ts'), 'Runtime audit declarations are absent from tarball');
assert(runtimeEntries.includes('package/dist/surfaces/index.js'), 'Runtime surfaces dist entry is absent from tarball');
assert(
  runtimeEntries.includes('package/dist/surfaces/local-data.js'),
  'Runtime local binding dist entry is absent from tarball',
);
assert(
  runtimeEntries.includes('package/dist/surfaces/index.d.ts'),
  'Runtime surfaces declarations are absent from tarball',
);
assert(
  runtimeEntries.includes('package/dist/surfaces/local-data.d.ts'),
  'Runtime local binding declarations are absent from tarball',
);
assert(runtimeEntries.includes('package/dist/scopes/index.js'), 'Runtime scopes dist entry is absent from tarball');
assert(
  runtimeEntries.includes('package/dist/scopes/index.d.ts'),
  'Runtime scopes declarations are absent from tarball',
);
const runtimeReadme = run(['tar', '-xOf', runtimeTarball, 'package/README.md'], root);
assert.match(runtimeReadme, /createLocalDataBinding/u, 'Runtime README omits the canonical local binding helper');
assert.match(runtimeReadme, /replaceSnapshot/u, 'Runtime README omits explicit source replacement');
assert.match(runtimeReadme, /maxSourceRevisions/u, 'Runtime README omits bounded revision lifetime');

await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run(
  [
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    coreTarball,
    runtimeTarball,
    'typescript@7.0.2',
    'vite@8.2.2',
    '@playwright/test@1.63.0',
  ],
  consumerDirectory,
);
const lockBytes = await readFile(join(consumerDirectory, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const artifact of artifacts) {
  const location = `node_modules/${artifact.name}`;
  assert.equal(lock.packages[location].version, artifact.version);
  assert.equal(lock.packages[location].integrity, artifact.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate installed ${artifact.name}`,
  );
}
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/core'].version, RELEASE_VERSION);
assert.equal(lock.packages['node_modules/zod'].version, '4.5.4');
assert.match(lock.packages['node_modules/zod'].integrity, /^sha512-/);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/runtime/node_modules/')),
  [],
  'Runtime has unexpected nested production dependencies',
);
for (const artifact of artifacts) {
  const entries = artifact.name === '@varendo/core' ? coreEntries : runtimeEntries;
  for (const entry of entries) {
    if (entry.endsWith('/')) continue;
    const installedPath = join(consumerDirectory, 'node_modules', artifact.name, entry.slice('package/'.length));
    const stat = await lstat(installedPath);
    assert(stat.isFile(), `Installed package entry is not a regular file: ${artifact.name}/${entry}`);
    const packedEntry = run(['tar', '-xOf', artifact.path, entry], root, null);
    assert.equal(
      hash(await readFile(installedPath)),
      hash(packedEntry),
      `Installed bytes differ: ${artifact.name}/${entry}`,
    );
  }
}
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const fields = [
  { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
  { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
  { id: 'amount', label: 'Amount', type: { value: 'decimal', nullable: false }, role: 'measure' },
  { id: 'active', label: 'Active', type: { value: 'boolean', nullable: true }, role: 'attribute' },
];
const catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'core-standard-1',
  entities: [{ id: 'employees', label: 'Employees', identity: ['id'], rowGrain: ['id'], fields }],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const rows = [
  { id: 'e-1', name: '😀', amount: { decimal: '10.00' }, active: true },
  { id: 'e-2', name: '𐀀', amount: { decimal: '20.00' }, active: null },
  { id: 'e-3', name: 'a', amount: { decimal: '10.0' }, active: false },
];
const budget = { maxRows: 10, maxBytes: 100_000, maxMessages: 8, maxMilliseconds: 10_000, maxColumns: 4 };
const query = {
  entity: 'employees',
  fields: ['id', 'name', 'amount', 'active'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [{ field: 'name', direction: 'asc', nulls: 'last' }],
};
const fixture = { catalog, rows, budget, query };
const fixtureSource = JSON.stringify(fixture);

// The same installed SDK exercise runs in Node and a bundled browser consumer.
const regionExerciseSource = `
async function exerciseRegions() {
  const check = (condition,
  message) => { if (!condition) throw new Error(message); };
  const value = outcome => { check(outcome.ok,
  JSON.stringify(outcome)); return outcome.value; };
  const principalKey = 'region-consumer-private';
  const regionRows = rows.map((row,
  index) => index === 0 ? {...row,
  name: 'region-original-data'} : row);
  const service = createLocalDataService({
    snapshot: {catalog,
  sourceRevision: 'region-source-1',
  records: {employees: regionRows}},
  authorize: () => ({ok: true,
  value: {scopeDigest: 'region-consumer-scope',
  policyRevision: 'region-policy-1'}}),
  });
  const cache = createResultStore({maxEntries: 1});
  let authority;
  let queryCount = 0;
  let restoredHandle;
  const materialize = async signal => {
    const requestId = 'region-query-' + (++queryCount);
    const accepted = value(await service.plan({version: '1',
  requestId,
  catalogRevision: catalog.revision,
  target: { taskId: requestId, outputId: 'region-rows'},
  query,
  budget},
  {signal}));
    const events = [];
    for await (const event of service.execute(accepted,
  {signal})) events.push(event);
    check(events[0]?.kind === 'descriptor' && events.at(-1)?.kind === 'complete',
  'Region query did not complete');
    const descriptor = events[0].descriptor;
    const handle = cache.begin({principalKey,
  scopeDigest: accepted.scopeDigest,
  policyRevision: accepted.policyRevision,
  queryDigest: accepted.queryDigest,
  catalogRevision: accepted.catalogRevision,
  functionRegistryDigest: accepted.functionRegistryDigest,
  sourceRevision: accepted.sourceRevision,
  outputId: accepted.target.outputId,
  taskId: descriptor.taskId,
  requestId: accepted.requestId,
  populationDigest: accepted.populationDigest});
    for await (const update of handle.subscribe((async function* () { yield* events; })(),
  {signal})) void update;
    check(handle.snapshot().status === 'ready',
  'Region handle did not materialize');
    authority = {principalKey,
  scopeDigest: accepted.scopeDigest,
  policyRevision: accepted.policyRevision,
  catalogRevision: accepted.catalogRevision,
  functionRegistryDigest: accepted.functionRegistryDigest,
  experienceRevision: 'consumer-experience-1',
  results: [descriptor.ref]};
    return {handle,
  ref: descriptor.ref};
  };
  const first = await materialize();
  const task = {version: '1',
  id: 'consumer-task',
  revision: '1',
  regionId: 'consumer-region',
  catalogRevision: authority.catalogRevision,
  functionRegistryDigest: authority.functionRegistryDigest,
  kind: 'presentation',
  goal: 'Show employees',
  needs: [],
  assumptions: [],
  inputs: [first.ref]};
  const store = createRegionStore({readAuthority: () => ({ok: true,
  value: authority}),
  authorizeCommit: () => ({ok: true,
  value: undefined}),
  restoreRegion: async ({document,
  signal}) => {
      const fresh = await materialize(signal);
      restoredHandle = fresh.handle;
      return {ok: true,
  value: {state: {task: {...document.task,
  inputs: [fresh.ref]}},
  resultHandles: [fresh.handle]}};
    }});
  const region = value(store.create({id: task.regionId,
  state: {task}}));
  const interaction = {version: '1',
  values: [{nodeId: 'employees-table',
  portId: 'selection',
  payload: {kind: 'selection',
  selection: {mode: 'ids',
  entity: 'employees',
  keys: ['e-1'],
  result: first.ref}}}],
  drafts: [{domain: 'employee-directory',
  entity: 'employees',
  key: 'e-1',
  field: 'name',
  value: 'private-draft',
  entityRevision: '1'}]};
  const observations = [];
  region.observe(update => { observations.push(update.snapshot.state?.interaction); });
  const originalRevision = region.snapshot().regionRevision;
  const token = value(await region.stage({requestId: 'consumer-stage',
  expected: region.snapshot().readSet,
  state: {task,
  interaction},
  resultHandles: [first.handle]}));
  const committed = value(await region.commit(token));
  check(committed.regionRevision !== originalRevision,
  'Commit reused a region revision');
  check(region.history().at(-1).regionRevision === committed.regionRevision,
  'Commit history has the wrong revision');
  check(JSON.stringify(observations[0]) === JSON.stringify(interaction),
  'Observer did not see atomic interaction state');
  first.handle.release();
  const layout = value(await region.stage({requestId: 'consumer-layout',
  expected: region.snapshot().readSet,
  state: {task: {...region.snapshot().state.task,
  viewPreference: {representation: 'table',
  strength: 'explicit'}}}}));
  value(await region.commit(layout));
  check(JSON.stringify(region.snapshot().state.interaction) === JSON.stringify(interaction) && queryCount === 1,
  'Layout did not preserve control/draft state without requery');
  let capacityBlocked = false;
  try { cache.begin({...first.handle.key,
  sourceRevision: 'eviction-probe',
  requestId: 'eviction-probe'}); }
  catch (error) { capacityBlocked = error instanceof RangeError; }
  check(capacityBlocked,
  'Active region did not retain its result lease');
  const pending = value(await region.stage({requestId: 'before-refresh',
  expected: region.snapshot().readSet,
  state: region.snapshot().state,
  resultHandles: [first.handle]}));
  value(await region.publishData({results: [first.ref]}));
  const stale = await region.commit(pending);
  check(!stale.ok && stale.diagnostics[0].code === 'runtime.region-stale',
  'Same-reference refresh did not invalidate commit');
  const persisted = serializeRegionDocument(region.snapshot(),
  region.history());
  const document = value(parseRegionDocument(persisted));
  check(document.dataRevision === 1 && !persisted.includes('region-original-data') && !persisted.includes('batches') && !persisted.includes('private-draft'),
  'Persistence did not preserve metadata-only materialization state');
  const savedRevision = region.snapshot().regionRevision;
  region.dispose();
  value(service.replaceSnapshot({catalog,
  sourceRevision: 'region-source-2',
  records: {
    employees: regionRows.map((row,
  index) => index === 0 ? {...row,
  name: 'region-restored-data'} : row),
  }}));
  const restored = value(await store.restore(persisted));
  check(queryCount === 2,
  'Restore did not execute a fresh query');
  check(restored.snapshot().regionRevision !== savedRevision,
  'Restore reused the previous incarnation revision');
  check(restored.snapshot().dataRevision === 0 && restored.history().every(entry => entry.dataRevision === 0),
  'Restore reused prior materialization history');
  restoredHandle.release();
  check(restoredHandle.snapshot().batches.some(batch => batch.rows.some(row => row.name === 'region-restored-data')),
  'Restore did not expose freshly evaluated data');
  restored.revoke('consumer revocation');
  check(restored.snapshot().state === undefined && restored.snapshot().readSet === undefined,
  'Revocation retained protected region state');
  const replacement = cache.begin({...restoredHandle.key,
  sourceRevision: 'after-revoke',
  requestId: 'after-revoke'});
  check(restoredHandle.snapshot().status === 'disposed',
  'Revoked region retained a data lease against eviction');
  replacement.release();
  store.dispose(); cache.dispose();
  return {queryCount,
  staleCommitRejected: true,
  leasesReleased: true,
  restoreRequeried: true};
}
`;

const interactionExerciseSource = `
async function exerciseInteraction() {
  const check = (condition,
  message) => { if (!condition) throw new Error(message); };
  const value = outcome => { check(outcome.ok,
  JSON.stringify(outcome)); return outcome.value; };
  const principalKey = 'interaction-private';
  const service = createLocalDataService({snapshot: {catalog,
  sourceRevision: 'interaction-source',
  records: {employees: rows}},
  authorize: () => ({ok: true,
  value: {scopeDigest: 'interaction-scope',
  policyRevision: 'interaction-policy'}})});
  const cache = createResultStore({maxEntries: 3});
  const handles = [];
  let queryCount = 0;
  let authority;
  let current;
  async function evaluate(nextQuery,
  signal) {
    const requestId = 'interaction-query-' + (++queryCount);
    const accepted = value(await service.plan({version: '1',
  requestId,
  catalogRevision: catalog.revision,
  target: { taskId: requestId, outputId: 'employees'},
  query: nextQuery,
  budget},
  {signal}));
    const events = [];
    for await (const event of service.execute(accepted,
  {signal})) events.push(event);
    const descriptor = events[0]?.descriptor;
    check(descriptor && events.at(-1)?.kind === 'complete',
  'Interaction query did not complete');
    const handle = cache.begin({principalKey,
  scopeDigest: accepted.scopeDigest,
  policyRevision: accepted.policyRevision,
  queryDigest: accepted.queryDigest,
  catalogRevision: accepted.catalogRevision,
  functionRegistryDigest: accepted.functionRegistryDigest,
  sourceRevision: accepted.sourceRevision,
  outputId: accepted.target.outputId,
  taskId: descriptor.taskId,
  requestId: accepted.requestId,
  populationDigest: accepted.populationDigest});
    for await (const update of handle.subscribe((async function* () { yield* events; })(),
  {signal})) void update;
    handles.push(handle);
    authority = {principalKey,
  scopeDigest: accepted.scopeDigest,
  policyRevision: accepted.policyRevision,
  catalogRevision: accepted.catalogRevision,
  functionRegistryDigest: accepted.functionRegistryDigest,
  experienceRevision: 'experience-1',
  results: [...(authority?.results ?? []),
  descriptor.ref]};
    return {handle,
  ref: descriptor.ref};
  }
  current = await evaluate(query);
  let prepared;
  const task = {version: '1',
  id: 'interaction-task',
  revision: '1',
  regionId: 'interaction-region',
  catalogRevision: catalog.revision,
  functionRegistryDigest: authority.functionRegistryDigest,
  kind: 'data',
  goal: 'Filter employees',
  needs: [],
  assumptions: [],
  outputs: [{id: 'employees',
  kind: 'query',
  query,
  dependsOn: [],
  delivery: 'eager'}]};
  let authorizationGate;
  let authorizationEntered;
  const store = createRegionStore({readAuthority: () => ({ok: true,
  value: authority}),
  authorizeCommit: async () => {
    if (authorizationGate) { authorizationEntered(); await authorizationGate; }
    return {ok: true,
  value: undefined};
  }});
  const region = value(store.create({id: task.regionId,
  state: {task}}));
  const selection = {payload: 'selection',
  entity: 'employees',
  identity: ['id'],
  grain: ['id']};
  const mapping = {ref: {id: 'selection.identity',
  revision: '1'},
  source: selection,
  target: selection,
  kind: 'identity'};
  const graph = createInteractionGraph({nodes: [{id: 'filter',
  ports: [{id: 'filter',
  direction: 'output',
  payload: 'filter'}]},
  {id: 'form',
  ports: [{id: 'edit',
  direction: 'output',
  payload: 'draft'}]},
  ...['table',
  'detail'].map(id => ({id,
  ports: [{id: 'selection',
  direction: 'inout',
  ...selection}]}))],
  links: [{id: 'selection-link',
  source: {node: 'table',
  port: 'selection'},
  target: {node: 'detail',
  port: 'selection'},
  mapping: mapping.ref,
  propagation: 'identity-equivalence'}],
  mappings: [mapping]});
  let grants = ['experience.commit',
  'result.inspect',
  'draft.edit'];
  const actor = {id: 'owner',
  kind: 'user'};
  const controller = createInteractionController({region,
  graph,
  readContext: () => ({...authority,
  results: [current.ref],
  draftDomain: 'directory',
  actor,
  grants}),
  resolveResult: ref => handles.find(handle => handle.snapshot().descriptor?.ref.id === ref.id),
  validateScope: payload => payload.kind === 'filter' && payload.outputId === 'employees'
      ? {ok: true,
  value: undefined} : {ok: false,
  diagnostics: [{code: 'host.scope',
  message: 'Unknown output.',
  retryable: false}]},
  validateSelection: selected => selected.mode === 'ids' && selected.keys.every(key => current.handle.snapshot().batches.some(batch => batch.rows.some(row => row.id === key)))
      ? {ok: true,
  value: undefined} : {ok: false,
  diagnostics: [{code: 'host.selection',
  message: 'Selection unavailable.',
  retryable: false}]},
  validateDraft: () => ({ok: true,
  value: undefined}),
  materialize: async (payloads,
  context,
  next) => {
      check(payloads.length === 1,
  'Unexpected materialization fanout');
      const nextQuery = {...query,
  where: {op: 'and',
  predicates: payloads[0].predicates}};
      const fresh = await evaluate(nextQuery,
  context.signal);
      prepared = fresh;
      return {ok: true,
  value: {state: {task: {...context.region.state.task,
  outputs: [{id: 'employees',
  kind: 'query',
  query: nextQuery,
  dependsOn: [],
  delivery: 'eager'}]},
  interaction: next},
  resultHandles: [fresh.handle]}};
    }});
  const event = (id,
  originNodeId,
  payload) => ({eventId: id,
  causationId: id,
  regionId: region.id,
  regionRevision: region.snapshot().regionRevision,
  originNodeId,
  payload});
  const filter = event('filter-active',
  'filter',
  {kind: 'filter',
  outputId: 'employees',
  predicates: [{op: 'compare',
  field: 'active',
  comparison: 'eq',
  value: true}]});
  value(await controller.dispatch(filter));
  current = prepared;
  check(queryCount === 2 && current.handle.snapshot().batches.flatMap(batch => batch.rows).length === 1,
  'Typed filter did not change actual query rows');
  check(region.snapshot().state.task.outputs[0].query.where.predicates[0].field === 'active' && controller.state().values.length === 1,
  'Query and retained filter were not committed together');
  const selected = event('select-employee',
  'table',
  {kind: 'selection',
  selection: {mode: 'ids',
  entity: 'employees',
  keys: ['e-1'],
  result: current.ref}});
  value(await controller.dispatch(selected));
  check(controller.state().values.filter(entry => entry.payload.kind === 'selection').length === 2 && queryCount === 2,
  'Selection did not converge without a query');
  const stale = await controller.dispatch({...selected,
  eventId: 'stale-selection'});
  check(!stale.ok,
  'Stale interaction was accepted');
  const forged = await controller.dispatch({...event('forged',
  'table',
  selected.payload),
  actor: 'human'});
  check(!forged.ok,
  'Wire interaction forged actor authority');
  const unavailable = await controller.dispatch(event('unavailable',
  'table',
  {...selected.payload,
  selection: {...selected.payload.selection,
  keys: ['e-2']}}));
  check(!unavailable.ok,
  'Selection crossed the filtered population');
  const draft = {kind: 'draft',
  entity: 'employees',
  key: 'e-1',
  field: 'name',
  value: 'pending edit',
  entityRevision: '1'};
  for (const reason of ['cancel',
  'permission',
  'actor']) {
    let release;
    authorizationGate = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { authorizationEntered = resolve; });
    const before = JSON.stringify(region.snapshot());
    const dispatched = controller.dispatch(event('pending-' + reason,
  'form',
  draft));
    const reached = await Promise.race([entered.then(() => true),
  dispatched.then(() => false)]);
    check(reached,
  'Draft did not reach authorization');
    if (reason === 'cancel') check(controller.cancel('pending-' + reason),
  'Pending interaction was not cancellable');
    else if (reason === 'permission') grants = [];
    else actor.id = 'different-actor';
    release();
    const stopped = await dispatched;
    check(!stopped.ok && JSON.stringify(region.snapshot()) === before,
  'Pending ' + reason + ' change published an unauthorized draft');
    authorizationGate = undefined;
    grants = ['experience.commit',
  'result.inspect',
  'draft.edit'];
    actor.id = 'owner';
  }
  region.revoke();
  check(!(await controller.dispatch(event('after-revoke',
  'filter',
  filter.payload))).ok && region.snapshot().state === undefined,
  'Interaction survived region revocation');
  controller.dispose(); graph.dispose(); store.dispose(); for (const handle of handles) handle.release(); cache.dispose();
  return {queryCount,
  filteredRows: 1,
  linkedSelection: true,
  staleRejected: true,
  cancelledBeforeCommit: true,
  latePermissionRejected: true,
  revoked: true};
}
`;

const actionExerciseSource = `
async function exerciseActions() {
  const check = (condition,
  message) => { if (!condition) throw new Error(message); };
  const value = outcome => { check(outcome.ok,
  JSON.stringify(outcome)); return outcome.value; };
  const accepted = value => ({ok: true,
  value});
  const denied = () => ({ok: false,
  diagnostics: [{code: 'consumer.denied',
  message: 'Confirmation was declined.',
  retryable: false}]});
  const registry = createActionRegistry();
  const ref = {id: 'counter.increment',
  revision: '1'};
  const inputSchema = {id: 'counter.increment.input',
  revision: '1'};
  const outputSchema = {id: 'counter.increment.output',
  revision: '1'};
  const parseNumberRecord = field => input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !Number.isSafeInteger(input[field]) || input[field] < 0 || input[field] > 10) return denied();
    return accepted({[field]: input[field]});
  };
  let writes = 0;
  let total = 0;
  let confirmations = 0;
  let confirmationAllowed = false;
  let context = {principalKey: 'action-consumer-principal',
  actorKey: 'action-consumer-host',
  scopeDigest: 'action-scope',
  policyRevision: 'policy-1',
  domainRevision: 'domain-1',
  confirmationEpoch: 'confirmation-1',
  grants: ['action.propose']};
  value(registry.register({
    descriptor: {ref,
  input: inputSchema,
  output: outputSchema,
  sideEffect: 'domain-write',
  confirmation: 'required',
  idempotency: 'required',
  entityRevision: 'none'},
  inputSchema: {ref: inputSchema,
  parse: parseNumberRecord('delta')},
  outputSchema: {ref: outputSchema,
  parse: parseNumberRecord('total')},
  dispatch: ({input}) => { writes++; total += input.delta; return {state: 'completed',
  output: {total}}; },
  }));
  const port = createActionPort({registry,
  host: {
    readContext: () => accepted(context),
  issueConfirmation: () => { confirmations++; return confirmationAllowed ? accepted(undefined) : denied(); },
  }});
  const request = {requestId: 'action-first',
  action: ref,
  input: {delta: 3},
  idempotencyKey: 'action-once'};
  check(!(await port.preview({...request,
  actor: 'human',
  approved: true})).ok,
  'Action wire accepted forged authority');
  const ungranted = value(await port.preview(request));
  check(writes === 0 && !(await port.confirm(ungranted)).ok,
  'Proposal permission granted execution');
  context = {...context,
  grants: ['action.propose',
  'action.execute']};
  const declined = value(await port.preview({...request,
  requestId: 'action-declined'}));
  check(!(await port.confirm(declined)).ok && writes === 0,
  'Invoking confirm bypassed the trusted confirmation decision');
  confirmationAllowed = true;
  const preview = value(await port.preview({...request,
  requestId: 'action-approved'}));
  check(writes === 0,
  'Action preview caused a write');
  const receipt = value(await port.confirm(preview));
  check(writes === 0,
  'Action confirmation caused a write');
  const executions = await Promise.all([port.execute(receipt),
  port.execute(receipt)]);
  check(executions.filter(result => result.ok && result.value.state === 'executed').length === 1 && writes === 1 && total === 3,
  'Concurrent action receipt execution did not remain one-use');
  const replay = value(await port.confirm(value(await port.preview({...request,
  requestId: 'action-idempotent-replay'}))));
  const replayed = value(await port.execute(replay));
  check(replayed.state === 'executed' && writes === 1,
  'Idempotency replay repeated the business callback');
  const inspection = value(await port.inspect('action-once'));
  check(inspection?.state === 'executed' && inspection.outputAvailable && !Object.hasOwn(inspection,
  'output'),
  'Own action inspection did not return metadata');
  const ownHistory = value(await port.history());
  check(ownHistory.length > 0 && !JSON.stringify(ownHistory).includes('delta'),
  'Action history was missing or retained raw input');
  const ownContext = context;
  context = {...context,
  principalKey: 'other-principal',
  actorKey: 'other-actor',
  scopeDigest: 'other-scope'};
  check(value(await port.inspect('action-once')) === undefined && value(await port.history()).length === 0,
  'Action status or history crossed the current host context');
  context = ownContext;
  const changed = value(await port.confirm(value(await port.preview({...request,
  requestId: 'action-changed-input',
  input: {delta: 4}}))));
  check(!(await port.execute(changed)).ok && writes === 1,
  'Changed input reused an idempotency key');
  const stale = value(await port.confirm(value(await port.preview({...request,
  requestId: 'action-stale-policy',
  idempotencyKey: 'action-stale'}))));
  context = {...context,
  policyRevision: 'policy-2'};
  check(!(await port.execute(stale)).ok && writes === 1,
  'Stale action confirmation executed');
  const retainedPreview = value(await port.preview({...request,
  requestId: 'action-held-preview'}));
  check(retainedPreview.input?.delta === 3,
  'Live preview input was unavailable');
  port.revoke();
  check(retainedPreview.input === undefined && !(await port.inspect('action-once')).ok && !(await port.history()).ok,
  'Revoked action port retained preview input or ledger data');
  check(!(await port.preview({...request,
  requestId: 'action-after-revoke'})).ok,
  'Revoked action port accepted a proposal');
  port.dispose();
  return {writes,
  total,
  confirmations,
  independentGrant: true,
  confirmationRequired: true,
  oneUseReceipt: true,
  idempotentReplay: true,
  staleExecutionRejected: true};
}
`;

const auditExerciseSource = `
function exerciseAudit() {
  let at = 100;
  const audit = createLocalAuditExporter({maxEvents: 2,
  maxBytes: 1024,
  now: () => at++});
  const first = audit.record({kind: 'plan',
  phase: 'query',
  status: 'completed',
  durationMs: 4});
  if (!first.ok) throw new Error('Installed local audit rejected a valid plan event');
  const second = audit.record({kind: 'capability',
  operation: 'present',
  status: 'rejected',
  code: 'policy.denied'});
  if (!second.ok) throw new Error('Installed local audit rejected a valid capability event');
  const redaction = audit.record({kind: 'source',
  transport: 'http',
  status: 'error',
  code: 'source.invalid',
  prompt: 'must-not-retain'});
  if (redaction.ok || redaction.diagnostics[0]?.code !== 'audit.invalid') throw new Error('Installed local audit accepted arbitrary sensitive context');
  const third = audit.record({kind: 'resource',
  resource: 'rows',
  status: 'exhausted',
  count: 101,
  limit: 100});
  if (!third.ok) throw new Error('Installed local audit rejected a valid resource event');
  const exported = audit.exportSnapshot();
  if (!exported.ok || exported.value.records.length !== 2 || exported.value.dropped !== 1 || exported.value.complete !== false ||
      exported.value.records[0]?.sequence !== 2 || JSON.stringify(exported.value).includes('must-not-retain'))
    throw new Error('Installed local audit export did not remain bounded and redacted');
  audit.dispose();
  if (audit.exportSnapshot().ok) throw new Error('Disposed local audit exporter retained readable state');
  return {bounded: true,
  redacted: true,
  droppedDisclosed: true};
}
`;

await writeFile(
  join(consumerDirectory, 'consumer-types.ts'),
  `
import {createDataHttpHandler,
  createHttpDataService,
  createLocalDataService,
  parseBudget,
  parseResultEvent} from '@varendo/runtime/data';
import type {DataHttpHandler,
  DataRecord,
  DataService,
  LocalSnapshot,
  QueryBudget,
  ReadContext,
  ResultEvent} from '@varendo/runtime/data';
import type {Catalog,
  Intent,
  QuerySpec,
} from '@varendo/core';
import {defineDataFeature, defineFeature} from '@varendo/core/features';
import {z} from 'zod';
import {createVarendoRuntime, createLocalDataBinding as createRootLocalDataBinding, type VarendoRuntime} from '@varendo/runtime';
import {createLocalDataBinding} from '@varendo/runtime/surfaces';
import type {CapabilitySurfaceBindings, CreateLocalDataBindingInput, DataSurfaceBindings, ExternalSurfaceStore, LocalDataSurfaceBinding, SurfaceController} from '@varendo/runtime/surfaces';
import type {ScopeBinding, ScopeController} from '@varendo/runtime/scopes';
import {createResultStore, type ResultStore, type ResultCacheKey} from '@varendo/runtime/results';
import {createRegionStore, type RegionHandle, type RegionStore} from '@varendo/runtime/regions';
import {parseRegionDocument} from '@varendo/runtime/persistence';
import {createActionPort, createActionRegistry, type ActionRequest, type ActionPort} from '@varendo/runtime/actions';
import {createLocalAuditExporter, type LocalAuditEvent, type LocalAuditExporter} from '@varendo/runtime/audit';
import {createInteractionController, createInteractionGraph, type InteractionControllerOptions, type InteractionEvent} from '@varendo/runtime/interaction';
declare const interactionOptions: InteractionControllerOptions;
declare const interactionEvent: InteractionEvent;
createInteractionController(interactionOptions).dispatch(interactionEvent);
declare const actionPort: ActionPort;
declare const actionRequest: ActionRequest;
const historyResult = await actionPort.history();
if (historyResult.ok) {
  const entry = historyResult.value[0];
  // @ts-expect-error Action history exposes no raw input.
  if (entry) void entry.input;
}
const inspectedAction = await actionPort.inspect('key');
if (inspectedAction.ok && inspectedAction.value) {
  // @ts-expect-error Action inspection exposes no business output.
  void inspectedAction.value.output;
}
// @ts-expect-error Action requests cannot claim a trusted actor.
const forgedActionRequest: ActionRequest = {...actionRequest, actor: 'human'};
// @ts-expect-error Execution only accepts a boundary-issued receipt, not an arbitrary request.
actionPort.execute(actionRequest);
void [createActionPort, createActionRegistry, forgedActionRequest];
const localAudit: LocalAuditExporter = createLocalAuditExporter();
const auditEvent: LocalAuditEvent = {kind: 'cache', cache: 'catalog', status: 'hit'};
localAudit.record(auditEvent);
// @ts-expect-error Audit events do not accept free-form messages.
const sensitiveAuditEvent: LocalAuditEvent = {kind: 'source', transport: 'http', status: 'error', code: 'source.invalid', message: 'raw source response'};
void sensitiveAuditEvent;
declare const region: RegionHandle;
// @ts-expect-error Only a runtime-staged opaque token can be committed.
region.commit({regionRevision: '1'});
// @ts-expect-error Current host authority is required independently of a proposal.
const incompleteRegionStore: RegionStore = createRegionStore({authorizeCommit: () => ({ok: true, value: undefined})});
void [incompleteRegionStore, parseRegionDocument];
const resultStore: ResultStore = createResultStore();
// @ts-expect-error Host principal partition is required.
const invalidResultKey: ResultCacheKey = {scopeDigest: 'scope'};
void [resultStore, invalidResultKey];
const catalog = ${JSON.stringify(catalog)} as const satisfies Catalog;
const query = ${JSON.stringify(query)} as const satisfies QuerySpec;
const budget: QueryBudget = ${JSON.stringify(budget)};
const snapshot: LocalSnapshot = {catalog, sourceRevision: 'source-1', records: {employees: ${JSON.stringify(rows)}}};
const context: ReadContext = {principal: {id: 'alice'}, metadata: {request: 'consumer'}};
const local: DataService = createLocalDataService({snapshot});
const handler: DataHttpHandler = createDataHttpHandler({service: local});
const http: DataService = createHttpDataService({baseUrl: 'https://example.test'});
const parsedBudget = parseBudget(budget);
const parsedEvent = parseResultEvent({});
const record: DataRecord = {id: 'e-1', amount: {decimal: '10.00'}, active: true};
// @ts-expect-error Nested objects are outside the bounded DataRecord value set.
const invalidRecord: DataRecord = {nested: {value: 'not-a-wire-value'}};
// @ts-expect-error Query budget fields are numeric.
const invalidBudget: QueryBudget = {...budget, maxRows: '10'};
void [catalog, query, budget, snapshot, context, local, handler, http, parsedBudget, parsedEvent, record, invalidRecord, invalidBudget];
const typedEvent: ResultEvent | undefined = undefined;
void typedEvent;
const peopleFeature = defineDataFeature({id: 'people', schema: z.object({id: z.string(), name: z.string()}), identity: ['id']});
type PeopleState = {readonly rows: readonly {readonly id: string; readonly name: string}[]};
const installedBinding = createLocalDataBinding({
  feature: peopleFeature,
  snapshot: {catalog: peopleFeature.catalog, sourceRevision: 'people-types-1', records: {people: []}},
  initialState: {rows: []},
  coverage: {fields: ['id', 'name'], relations: [], metrics: [], operators: ['eq'], pagination: 'snapshot', stableOrder: [{field: 'id', direction: 'asc', nulls: 'last'}], stableOrderIdentity: ['id'], sorting: 'stable-fields-only', aggregation: 'unsupported', streaming: 'finite', updates: 'snapshot-replace', unsupported: ['aggregation', 'streaming', 'live-updates']},
  normalize: async () => ({rows: []}),
  serviceOptions: {maxSourceRevisions: 2, maxCursors: 4, now: () => 1_000, workNow: () => performance.now(), authorize: () => ({ok: true, value: {scopeDigest: 'local', cursorPartition: 'local-principal-v1', policyRevision: '1'}})},
});
const installedBindingInput: CreateLocalDataBindingInput<PeopleState> = {
  feature: peopleFeature,
  snapshot: {catalog: peopleFeature.catalog, sourceRevision: 'people-types-input', records: {people: []}},
  initialState: {rows: []},
  coverage: installedBinding.source.coverage,
  normalize: async () => ({rows: []}),
};
const typedInstalledBinding: LocalDataSurfaceBinding<PeopleState> = installedBinding;
const rootBindingFactory: typeof createLocalDataBinding = createRootLocalDataBinding;
const invalidBindingOptions = {...installedBindingInput, serviceOptions: {snapshot: installedBindingInput.snapshot}};
// @ts-expect-error The binding snapshot is the sole trusted snapshot input.
createLocalDataBinding(invalidBindingOptions);
// @ts-expect-error The binding owns its snapshot; serviceOptions cannot replace it.
createLocalDataBinding({feature: peopleFeature, snapshot: {catalog: peopleFeature.catalog, sourceRevision: 'people-types-1', records: {people: []}}, initialState: {rows: []}, coverage: {fields: ['id', 'name'], relations: [], metrics: [], operators: ['eq'], pagination: 'snapshot', stableOrder: [{field: 'id', direction: 'asc', nulls: 'last'}], stableOrderIdentity: ['id'], sorting: 'stable-fields-only', aggregation: 'unsupported', streaming: 'finite', updates: 'snapshot-replace', unsupported: ['aggregation', 'streaming', 'live-updates']}, normalize: async () => ({rows: []}), serviceOptions: {snapshot: {catalog: peopleFeature.catalog, sourceRevision: 'forged', records: {people: []}}}});
declare const peopleData: DataService;
const peopleBindings: DataSurfaceBindings<PeopleState> = {
  initialState: {rows: []},
  source: {
    kind: 'data-service',
    service: peopleData,
    coverage: {fields: ['id', 'name'], relations: [], metrics: [], operators: ['eq'], pagination: 'snapshot', stableOrder: [{field: 'id', direction: 'asc', nulls: 'last'}], stableOrderIdentity: ['id'], sorting: 'stable-fields-only', aggregation: 'unsupported', streaming: 'finite', updates: 'snapshot-replace', unsupported: ['aggregation', 'streaming', 'live-updates']},
    normalize: async () => ({rows: []}),
  },
};
declare const surfaceRuntime: VarendoRuntime;
declare const scopeBinding: ScopeBinding;
const appScope: ScopeController = surfaceRuntime.createScope({binding: scopeBinding, initial: {kind: 'workspace', id: 'acme'}});
appScope.attach();
appScope.requestChange({kind: 'workspace', id: 'globex'});
appScope.invalidate('logout');
appScope.dispose();
declare const externalStore: ExternalSurfaceStore<Intent, PeopleState>;
const surfaceScope = surfaceRuntime.createLocalSurfaceScope({id: 'local', allowedFeatures: ['people']});
const typedSurface: SurfaceController<Intent, PeopleState> = surfaceRuntime.createSurface({scope: surfaceScope, id: 'people-main', feature: peopleFeature, bindings: peopleBindings});
surfaceRuntime.createSurface({scope: surfaceScope, id: 'people-controlled', feature: peopleFeature, bindings: peopleBindings, ownership: {mode: 'external', store: externalStore, onProposal: proposal => void proposal}});
const reportFeature = defineFeature({id: 'report', capabilities: [{ref: {id: 'report.read', revision: '1'}, kind: 'read', schema: z.object({})}], intents: [{ref: {id: 'report.open', revision: '1'}, schema: z.object({}), capabilities: [{id: 'report.read', revision: '1'}]}]});
const reportBindings: CapabilitySurfaceBindings<{readonly intent: {readonly id: 'report.open'; readonly revision: '1'}; readonly input: object}, {readonly value: string}> = {initialIntent: {intent: {id: 'report.open', revision: '1'}, input: {}}, initialState: {value: 'initial'}, source: {kind: 'capability', read: async () => ({value: 'ready'})}};
surfaceRuntime.createSurface({scope: surfaceScope, id: 'report', feature: reportFeature, bindings: reportBindings});
// @ts-expect-error Capability bindings require a typed initial intent.
const invalidReportBindings: CapabilitySurfaceBindings<{readonly intent: {readonly id: 'report.open'; readonly revision: '1'}; readonly input: object}, {readonly value: string}> = {initialState: {value: 'initial'}, source: {kind: 'capability', read: async () => ({value: 'ready'})}};
// @ts-expect-error Surface addresses are immutable targets.
typedSurface.address.surfaceGeneration = 2;
declare const bypassBinding: CapabilitySurfaceBindings<Intent, PeopleState>;
// @ts-expect-error Data features must use DataService bindings.
surfaceRuntime.createSurface({scope: surfaceScope, id: 'bypass', feature: peopleFeature, bindings: bypassBinding});
void [createVarendoRuntime, typedSurface, installedBinding, installedBindingInput, typedInstalledBinding, rootBindingFactory];
`,
);
await writeFile(
  join(consumerDirectory, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: false,
    },
    files: ['consumer-types.ts'],
  }),
);
run([join(consumerDirectory, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumerDirectory);

await writeFile(
  join(consumerDirectory, 'audit-io-blocker.cjs'),
  [
    "const {syncBuiltinESMExports} = require('node:module');",
    'const state = {attempts: []}; globalThis.__varendoAuditIo = state;',
    "const blocked = label => () => { state.attempts.push(label); const error = new Error('I/O is forbidden in the local audit proof'); error.code = 'VARENDO_AUDIT_IO_BLOCKED'; throw error; };",
    "globalThis.fetch = blocked('fetch');",
    "for (const name of ['node:http', 'node:https']) { const value = require(name); value.request = blocked(name + '.request'); value.get = blocked(name + '.get'); }",
    "const net = require('node:net'); net.connect = blocked('node:net.connect'); net.createConnection = blocked('node:net.createConnection'); net.Socket.prototype.connect = blocked('node:net.Socket.connect');",
    "const dns = require('node:dns'); dns.lookup = blocked('node:dns.lookup'); dns.resolve = blocked('node:dns.resolve');",
    'syncBuiltinESMExports();',
  ].join('\n') + '\n',
);
await writeFile(
  join(consumerDirectory, 'audit-offline.mjs'),
  [
    "const auditModule = await import('@varendo/runtime/audit');",
    "const {createRequire, syncBuiltinESMExports} = await import('node:module'); const require = createRequire(import.meta.url);",
    "const state = globalThis.__varendoAuditIo; const blocked = label => () => { state.attempts.push(label); const error = new Error('I/O is forbidden in the local audit proof'); error.code = 'VARENDO_AUDIT_IO_BLOCKED'; throw error; };",
    "const fsMutable = require('node:fs'); for (const name of ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'open', 'openSync', 'createReadStream', 'createWriteStream']) fsMutable[name] = blocked('node:fs.' + name); const fsp = require('node:fs/promises'); for (const name of ['readFile', 'writeFile', 'appendFile', 'open']) fsp[name] = blocked('node:fs/promises.' + name); syncBuiltinESMExports();",
    'const audit = auditModule.createLocalAuditExporter({maxEvents: 2, maxBytes: 1024, now: () => 1});',
    "const recorded = audit.record({kind: 'source', transport: 'local', status: 'error', code: 'source.invalid'}); const exported = audit.exportSnapshot(); audit.dispose();",
    'const auditIoAttempts = [...state.attempts];',
    "if (!recorded.ok || !exported.ok || exported.value.records.length !== 1 || auditIoAttempts.length !== 0) throw new Error('installed audit did not execute offline');",
    "const [http, fs] = await Promise.all([import('node:http'), import('node:fs')]);",
    "const probes = [['fetch', () => fetch('https://example.invalid')], ['node:http.get', () => http.get('http://example.invalid')], ['node:fs.readFileSync', () => fs.readFileSync('/not-read')]];",
    "for (const [label, probe] of probes) { try { probe(); throw new Error('I/O blocker probe unexpectedly succeeded: ' + label); } catch (error) { if (error?.code !== 'VARENDO_AUDIT_IO_BLOCKED') throw error; } }",
    'process.stdout.write(JSON.stringify({auditExecuted:true,auditIoAttempts,blockerProbeAttempts:state.attempts.slice(auditIoAttempts.length)}));',
  ].join('\n') + '\n',
);
const auditOfflineProof = JSON.parse(
  run([process.execPath, '--require', './audit-io-blocker.cjs', 'audit-offline.mjs'], consumerDirectory),
);
assert.deepEqual(auditOfflineProof, {
  auditExecuted: true,
  auditIoAttempts: [],
  blockerProbeAttempts: ['fetch', 'node:http.get', 'node:fs.readFileSync'],
});

await writeFile(
  join(consumerDirectory, 'surface-consumer.mjs'),
  `
import assert from 'node:assert/strict';
import {z} from 'zod';
import {defineDataFeature, defineFeature} from '@varendo/core/features';
import {createQueryFunctionRegistry} from '@varendo/core/expressions';
import {createVarendoRuntime, createLocalDataBinding as createRootLocalDataBinding} from '@varendo/runtime';
import {createLocalDataBinding} from '@varendo/runtime/surfaces';
assert.equal(createRootLocalDataBinding, createLocalDataBinding);
const diagnosticsCode = outcome => outcome.ok ? undefined : outcome.diagnostics[0]?.code;

const scopeEntry = await import('@varendo/runtime/scopes');
assert.deepEqual(Object.keys(scopeEntry), []);

const feature = defineDataFeature({id: 'people', schema: z.object({id: z.string(), team: z.enum(['Design', 'Engineering'])}), identity: ['id'], fields: {team: {role: 'dimension'}}});
const functions = createQueryFunctionRegistry({version: '2'});
assert.equal(functions.ok, true);
const snapshot = {catalog: feature.catalog, sourceRevision: 'people-1', records: {people: [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Engineering'}]}};
const binding = createLocalDataBinding({feature, snapshot, initialState: {rows: []}, coverage: {fields: ['id', 'team'], relations: [], metrics: [], operators: ['eq'], pagination: 'snapshot', stableOrder: [{field: 'id', direction: 'asc', nulls: 'last'}], stableOrderIdentity: ['id'], sorting: 'stable-fields-only', aggregation: 'unsupported', streaming: 'finite', updates: 'snapshot-replace', unsupported: ['aggregation', 'streaming', 'live-updates']}, normalize: async events => {const rows = []; for await (const event of events) if (event.kind === 'batch') rows.push(...event.rows); return {rows};}, serviceOptions: {functionRegistry: functions.value, authorize: () => ({ok: true, value: {scopeDigest: 'local', cursorPartition: 'local-principal-v1', policyRevision: '1'}}), maxSourceRevisions: 3, maxCursors: 4, now: () => 1_000, workNow: () => performance.now()}});
const data = binding.service;
assert.equal(data, binding.source.service);
assert.equal(binding.source.coverage.stableOrder[0].field, 'id');
assert.equal(binding.source.coverage.stableOrder[0].direction, 'asc');
assert.equal(binding.source.coverage.stableOrder[0].nulls, 'last');
assert.deepEqual(binding.source.coverage.stableOrderIdentity, ['id']);
assert(Object.isFrozen(binding.source.coverage));
assert(Object.isFrozen(binding.source.coverage.stableOrder));
const runtime = createVarendoRuntime({runtimeId: 'installed-runtime', resources: [{resource: feature.resource, data}], authority: {read: () => ({ok: true, value: {principalKey: 'local', scopeDigest: 'local', policyRevision: '1', experienceRevision: '1', grants: ['catalog.read', 'task.evaluate', 'result.inspect'], readContext: {principal: 'local'}}})}});
const scope = runtime.createLocalSurfaceScope({id: 'installed-scope', allowedFeatures: ['people', 'report']});
const bindings = binding;
const left = runtime.createSurface({scope, id: 'left', feature, bindings});
const right = runtime.createSurface({scope, id: 'right', feature, bindings});
const rightBefore = right.getSnapshot();
assert.equal((await left.request({kind: 'browse', filter: {op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering'}})).status, 'committed');
assert.equal(right.getSnapshot(), rightBefore);
assert.deepEqual(left.getSnapshot().state.rows, [{id: 'sam', team: 'Engineering'}]);
assert.equal((await left.request({kind: 'browse'}, {expectedAddress: right.address})).status, 'stale');
const leftAddress = left.address;
const updatedSnapshot = {catalog: feature.catalog, sourceRevision: 'people-2', records: {people: [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Design'}]}};
assert.deepEqual(data.replaceSnapshot(updatedSnapshot), {ok: true, value: undefined});
assert.equal((await left.request({kind: 'browse'})).status, 'committed');
assert.equal(left.address, leftAddress);
assert.deepEqual(left.getSnapshot().state.rows, [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Design'}]);
const partialPlan = await data.plan({version: '1', requestId: 'partial-page', catalogRevision: feature.catalog.revision, target: {taskId: 'partial-page-task', outputId: 'rows'}, query: {entity: 'people', fields: ['id', 'team'], measures: [], relations: [], groupBy: [], population: {kind: 'all-authorized'}, order: [], page: {size: 1}}, budget: {maxRows: 10, maxColumns: 4, maxBytes: 100_000, maxMessages: 8, maxMilliseconds: 10_000}}, {principal: 'local'});
assert.equal(partialPlan.ok, true);
if (partialPlan.ok) {
  const partialEvents = [];
  for await (const event of data.execute(partialPlan.value, {principal: 'local'})) partialEvents.push(event);
  const partialDescriptor = partialEvents.find(event => event.kind === 'descriptor');
  assert.deepEqual(partialDescriptor?.descriptor.counts.population.kind, 'exact');
  assert.equal(partialDescriptor?.descriptor.counts.population.value, 2);
  assert.deepEqual(partialDescriptor?.descriptor.coverage, {kind: 'partial', populationDigest: partialDescriptor.descriptor.coverage.populationDigest, reason: 'page'});
  const partialComplete = partialEvents.find(event => event.kind === 'complete');
  assert.deepEqual(partialComplete?.finalCoverage.reason, 'page');
  assert.equal(typeof partialComplete?.cursor, 'string');
}
assert.deepEqual(data.replaceSnapshot(updatedSnapshot), {ok: true, value: undefined});
const conflict = data.replaceSnapshot({catalog: feature.catalog, sourceRevision: 'people-2', records: {people: [{id: 'ada', team: 'Engineering'}, {id: 'sam', team: 'Design'}]}});
assert.equal(conflict.ok, false);
assert.equal(left.getSnapshot().state.rows[0].team, 'Design');
const historicalReplay = data.replaceSnapshot({catalog: feature.catalog, sourceRevision: 'people-1', records: {people: [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Engineering'}]}});
assert.equal(historicalReplay.ok, false);
assert.equal(diagnosticsCode(historicalReplay), 'data.source-revision-conflict');
const rollbackSnapshot = {catalog: feature.catalog, sourceRevision: 'people-3', records: {people: [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Engineering'}]}};
assert.deepEqual(data.replaceSnapshot(rollbackSnapshot), {ok: true, value: undefined});
const rollbackAccepted = await data.plan({version: '1', requestId: 'rollback-plan', catalogRevision: feature.catalog.revision, target: {taskId: 'rollback-task', outputId: 'rows'}, query: {entity: 'people', fields: ['id', 'team'], measures: [], relations: [], groupBy: [], population: {kind: 'all-authorized'}, order: []}, budget: {maxRows: 10, maxColumns: 4, maxBytes: 100_000, maxMessages: 8, maxMilliseconds: 10_000}}, {principal: 'local'});
assert.equal(rollbackAccepted.ok, true);
if (rollbackAccepted.ok) {
  const rollbackEvents = [];
  for await (const event of data.execute(rollbackAccepted.value, {principal: 'local'})) rollbackEvents.push(event);
  assert.equal(rollbackEvents[0].descriptor.consistency.snapshotId, 'people-3');
  assert.equal(rollbackEvents[1].rows[0].team, 'Design');
}
const capacity = data.replaceSnapshot({catalog: feature.catalog, sourceRevision: 'people-4', records: {people: [{id: 'ada', team: 'Design'}, {id: 'sam', team: 'Engineering'}]}});
assert.equal(capacity.ok, false);
assert.equal(diagnosticsCode(capacity), 'data.source-revision-capacity');
assert.deepEqual(data.replaceSnapshot(rollbackSnapshot), {ok: true, value: undefined});
assert.throws(() => createLocalDataBinding({feature, snapshot, initialState: {rows: []}, coverage: binding.source.coverage, normalize: binding.source.normalize, serviceOptions: {sourceLimits: {rows: 1, bytes: 100_000}}}), /data\.shape-capacity/u);

let hostSnapshot;
const listeners = new Set();
const proposals = [];
const store = {getSnapshot: () => {if (hostSnapshot === undefined) throw new Error('Host snapshot is not initialized.'); return hostSnapshot;}, subscribe: listener => (listeners.add(listener), () => listeners.delete(listener))};
const controlled = runtime.createSurface({scope, id: 'controlled', feature, bindings, ownership: {mode: 'external', store, onProposal: proposal => proposals.push(proposal)}});
const address = controlled.address;
hostSnapshot = Object.freeze({id: 'controlled', address, revision: '0', phase: 'idle', intent: {version: '1', id: 'initial', resource: 'people', kind: 'browse'}, state: {rows: []}});
const proposalResult = await controlled.request({kind: 'browse'});
assert.equal(proposalResult.status, 'proposed');
assert.equal(controlled.getSnapshot().revision, '0');
const accepted = proposals[0];
hostSnapshot = Object.freeze({...hostSnapshot, revision: '1', phase: 'ready', intent: accepted.intent, proposalDecision: {proposalId: accepted.proposalId, address: accepted.address, expectedRevision: accepted.expectedRevision, status: 'accepted'}});
for (const listener of listeners) listener();
assert.equal(controlled.getSnapshot().revision, '1');
const rejectedResult = await controlled.request({kind: 'browse', filter: {op: 'compare', field: 'team', comparison: 'eq', value: 'Design'}});
assert.equal(rejectedResult.status, 'proposed');
const rejected = proposals[1];
const beforeReject = controlled.getSnapshot();
hostSnapshot = Object.freeze({...hostSnapshot, proposalDecision: {proposalId: rejected.proposalId, address: rejected.address, expectedRevision: rejected.expectedRevision, status: 'rejected'}});
for (const listener of listeners) listener();
assert.equal(controlled.getSnapshot(), beforeReject);

const reportFeature = defineFeature({id: 'report', capabilities: [{ref: {id: 'report.read', revision: '1'}, kind: 'read', schema: z.object({})}], intents: [{ref: {id: 'report.open', revision: '1'}, schema: z.object({value: z.string()}), capabilities: [{id: 'report.read', revision: '1'}]}]});
const reportInitialIntent = {intent: {id: 'report.open', revision: '1'}, input: {value: 'initial'}};
let reportSnapshot;
const reportListeners = new Set();
const reportProposals = [];
const reportStore = {getSnapshot: () => {if (reportSnapshot === undefined) throw new Error('Capability host snapshot is not initialized.'); return reportSnapshot;}, subscribe: listener => (reportListeners.add(listener), () => reportListeners.delete(listener))};
const report = runtime.createSurface({scope, id: 'external-report', feature: reportFeature, bindings: {initialIntent: reportInitialIntent, initialState: {value: 'inert'}, source: {kind: 'capability', read: async () => ({value: 'must-not-run'})}}, ownership: {mode: 'external', store: reportStore, onProposal: proposal => reportProposals.push(proposal)}});
reportSnapshot = Object.freeze({id: report.id, address: report.address, revision: '0', phase: 'idle', intent: reportInitialIntent, state: {value: 'inert'}});
const reportRequest = await report.request({intent: {id: 'report.open', revision: '1'}, input: {value: 'accepted'}});
assert.equal(reportRequest.status, 'proposed');
const reportProposal = reportProposals[0];
reportSnapshot = Object.freeze({...reportSnapshot, revision: '1', phase: 'ready', intent: reportProposal.intent, state: {value: 'accepted'}, proposalDecision: {proposalId: reportProposal.proposalId, address: reportProposal.address, expectedRevision: reportProposal.expectedRevision, status: 'accepted'}});
for (const listener of reportListeners) listener();
assert.equal(report.getSnapshot().state.value, 'accepted');

const waitForScope = (controller, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for installed scope state.')), 2_000);
  let unsubscribe = () => {};
  const check = () => {
    const snapshot = controller.getSnapshot();
    if (!predicate(snapshot)) return;
    clearTimeout(timer);
    unsubscribe();
    resolve(snapshot);
  };
  unsubscribe = controller.subscribe(check);
  check();
});
let scopeResolutions = 0;
const appScope = runtime.createScope({
  initial: {kind: 'workspace', id: 'acme'},
  binding: {
    resolve: async selector => {
      scopeResolutions += 1;
      return {ok: true, value: {selector, permissionRevision: scopeResolutions, policyRevision: 'policy-1', allowedFeatures: ['people']}};
    },
    authorize: () => ({ok: true, value: undefined}),
    prepareActivation: () => ({ok: true, value: undefined}),
    activate: () => ({ok: true, value: undefined}),
    deactivate: () => {},
    readLeaveState: () => ({dirty: false, revision: 'leave-1'}),
  },
});
assert.equal(appScope.getSnapshot().status, 'idle');
assert.equal(scopeResolutions, 0);
const initialScope = waitForScope(appScope, snapshot => snapshot.status === 'active');
const detachAppScope = appScope.attach();
const activeA = await initialScope;
assert.equal(activeA.selector.id, 'acme');
const appA = runtime.createSurface({scope: appScope, id: 'people-app', feature, bindings});
assert.equal((await appA.request({kind: 'browse'})).status, 'committed');
const addressA = appA.address;
const changed = await appScope.requestChange({kind: 'workspace', id: 'globex'});
assert.equal(changed.status, 'active');
assert.equal(changed.activationEpoch > addressA.activationEpoch, true);
assert.equal(appA.getSnapshot().phase, 'disposed');
const appB = runtime.createSurface({scope: appScope, id: 'people-app', feature, bindings});
assert.notEqual(appB.address.activationEpoch, addressA.activationEpoch);
appScope.invalidate('logout');
assert.equal(appScope.getSnapshot().status, 'denied');
assert.equal(appScope.getSnapshot().selector, null);
assert.equal(appB.getSnapshot().phase, 'disposed');
detachAppScope();
detachAppScope();
appScope.dispose();
appScope.dispose();
runtime.dispose();
scope.dispose();
assert.deepEqual(data.replaceSnapshot(rollbackSnapshot), {ok: true, value: undefined});
assert.equal((await left.request({kind: 'browse'})).status, 'disposed');
process.stdout.write(JSON.stringify({twoInstances: true, controlled: true, rejected: true, externalCapability: true, scopes: true, bindingExactService: true, updateStableAddress: true, historicalRevisionRejected: true, revisionCapacityRejected: true, rollbackExecuted: true, shapeCapacityRejected: true, partialCoverage: true, disposedUpdateSafe: true}));
`,
);
const surfaceProof = JSON.parse(run([process.execPath, 'surface-consumer.mjs'], consumerDirectory));
assert.deepEqual(surfaceProof, {
  twoInstances: true,
  controlled: true,
  rejected: true,
  externalCapability: true,
  scopes: true,
  bindingExactService: true,
  updateStableAddress: true,
  historicalRevisionRejected: true,
  revisionCapacityRejected: true,
  rollbackExecuted: true,
  shapeCapacityRejected: true,
  partialCoverage: true,
  disposedUpdateSafe: true,
});

await writeFile(
  join(consumerDirectory, 'consumer.mjs'),
  `
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {lstat, readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join, extname, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {gzipSync} from 'node:zlib';
import {
  createDataHttpHandler,
  createHttpDataService,
  createLocalDataService,
} from '@varendo/runtime/data';
import {createResultStore} from '@varendo/runtime/results';
import {createRegionStore} from '@varendo/runtime/regions';
import {parseRegionDocument, serializeRegionDocument} from '@varendo/runtime/persistence';
import {createActionPort, createActionRegistry} from '@varendo/runtime/actions';
import {createLocalAuditExporter} from '@varendo/runtime/audit';
import {createInteractionController, createInteractionGraph} from '@varendo/runtime/interaction';

const run = (argv, cwd) => {
  const result = spawnSync(argv[0], argv.slice(1), {cwd, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw new Error(argv.join(' ') + ' failed: ' + (result.stderr || result.stdout || result.error || ''));
  return result.stdout;
};
const fixture = ${fixtureSource};
const {catalog, rows, budget, query} = fixture;
const snapshot = (sourceRevision = 'source-1', sourceRows = rows) => ({
  catalog, sourceRevision, records: {employees: sourceRows},
});
const ok = value => ({ok: true, value});
const denied = () => ({ok: false, diagnostics: [{code: 'data.denied', message: 'Denied by consumer host policy.', retryable: false}]});
const unwrap = outcome => {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return outcome.value;
};
const diagnosticsCode = outcome => outcome.ok ? undefined : outcome.diagnostics[0]?.code;
const collect = async iterable => { const events = []; for await (const event of iterable) events.push(event); return events; };
const assertResultEvents = (events, expectedName = 'a', expectedAmount = '10.0') => {
  assert.deepEqual(events.map(event => event.kind), ['descriptor', 'batch', 'progress', 'complete']);
  assert.equal(events[1].rows[0].name, expectedName);
  assert.equal(events[1].rows[0].amount.decimal, expectedAmount);
  assert.equal(events[3].finalCoverage.kind, 'complete');
};
const planRequest = requestId => ({
  version: '1', requestId, catalogRevision: 'catalog-1', target: { taskId: requestId, outputId: 'employees-output'}, query, budget,
});
const describeRequest = requestId => ({
  version: '1', requestId, catalogRevision: null, target: {kind: 'catalog'}, budget, pageSize: 1,
});

let authMode = 'allow';
const observations = [];
const authorize = ({operation, context}) => {
  observations.push({operation, principal: context.principal});
  if (authMode === 'deny' && operation === 'execute') return denied();
  return ok({
    scopeDigest: 'scope-alice',
    policyRevision: authMode === 'policy-change' ? 'policy-2' : 'policy-1',
    entities: ['employees'],
    maxBudget: {maxRows: 10, maxColumns: 4},
  });
};
const local = createLocalDataService({snapshot: snapshot(), hostBudget: budget, authorize});
const localDescribe = await local.describe(describeRequest('local-describe'), {principal: 'alice'});
assert.equal(localDescribe.ok, true);
assert.equal(localDescribe.value.catalog.entities[0].id, 'employees');
const localAccepted = unwrap(await local.plan(planRequest('local-plan'), {principal: 'alice'}));
const localEvents = await collect(local.execute(localAccepted, {principal: 'alice'}));
assertResultEvents(localEvents);
const resultStore = createResultStore();
const resultHandle = resultStore.begin({
  principalKey: 'alice-private', scopeDigest: localAccepted.scopeDigest, policyRevision: localAccepted.policyRevision,
  queryDigest: localAccepted.queryDigest, catalogRevision: localAccepted.catalogRevision,
  functionRegistryDigest: localAccepted.functionRegistryDigest, sourceRevision: localAccepted.sourceRevision,
  outputId: localAccepted.target.outputId, taskId: localEvents[0].descriptor.taskId,
  requestId: localAccepted.requestId, populationDigest: localAccepted.populationDigest,
});
await collect(resultHandle.subscribe(local.execute(localAccepted, {principal: 'alice'})));
assert.equal(resultHandle.snapshot().status, 'ready');
assert.deepEqual(resultHandle.snapshot().batches[0].rows, localEvents[1].rows);
assert.equal('principalKey' in resultHandle.snapshot().key, false);
resultStore.revoke({principalKey: 'alice-private'});
assert.equal(resultHandle.snapshot().status, 'denied');
assert.equal(resultHandle.snapshot().loadedRows, 0);
assert.deepEqual(resultHandle.snapshot().batches, []);
resultStore.dispose();
${regionExerciseSource}
const regionProof = await exerciseRegions();
${interactionExerciseSource}
const interactionProof = await exerciseInteraction();
${actionExerciseSource}
const actionProof = await exerciseActions();
${auditExerciseSource}
const auditProof = exerciseAudit();
assert(observations.some(item => item.operation === 'execute' && item.principal === 'alice'));

authMode = 'policy-change';
const policyChangedEvents = await collect(local.execute(localAccepted, {principal: 'alice'}));
assert.deepEqual(policyChangedEvents.map(event => event.kind), ['error']);
assert.equal(policyChangedEvents[0].error.code, 'data.denied');
authMode = 'allow';
const sameRevisionMutation = local.replaceSnapshot(snapshot('source-1', [{...rows[0], name: 'mutated'}]));
assert.equal(diagnosticsCode(sameRevisionMutation), 'data.source-revision-conflict');
assert.equal(local.replaceSnapshot(snapshot('source-2', [{...rows[0], name: 'new-source'}])).ok, true);
const staleEvents = await collect(local.execute(localAccepted, {principal: 'alice'}));
assert.deepEqual(staleEvents.map(event => event.kind), ['error']);
assert.equal(staleEvents[0].error.code, 'data.stale-plan');

authMode = 'allow';
const httpHandler = createDataHttpHandler({
  service: local,
  authenticate: request => {
    const authorization = request.headers.get('authorization');
    if (authorization !== 'Bearer alice' && authorization !== 'Bearer browser') return denied();
    return ok({principal: authorization.slice('Bearer '.length)});
  },
});

async function nodeRequest(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
  return new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1').toString(), {
    method: incoming.method ?? 'GET', headers,
    ...(body === undefined ? {} : {body, duplex: 'half'}),
  });
}
async function dispatch(handler, incoming, outgoing) {
  try {
    const response = await handler(await nodeRequest(incoming));
    const headers = Object.fromEntries(response.headers.entries());
    outgoing.writeHead(response.status, headers);
    outgoing.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, {'content-type': 'text/plain'});
    outgoing.end(String(error));
  }
}
const server = createServer(async (incoming, outgoing) => dispatch(httpHandler, incoming, outgoing));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const baseUrl = 'http://127.0.0.1:' + server.address().port;
try {
  const http = createHttpDataService({baseUrl, headers: {authorization: 'Bearer alice'}});
  const httpDescribe = unwrap(await http.describe(describeRequest('http-describe')));
  assert.equal(httpDescribe.scopeDigest, 'scope-alice');
  const httpAccepted = unwrap(await http.plan(planRequest('http-plan')));
  const httpEvents = await collect(http.execute(httpAccepted));
  assertResultEvents(httpEvents, 'new-source', '10.00');
  assert(observations.some(item => item.operation === 'plan' && item.principal === 'alice'));

  const unauthenticated = createHttpDataService({baseUrl});
  const deniedDescribe = await unauthenticated.describe(describeRequest('http-unauthorized'));
  assert.equal(diagnosticsCode(deniedDescribe), 'data.denied');
  authMode = 'deny';
  const deniedHttpEvents = await collect(http.execute(httpAccepted));
  assert.deepEqual(deniedHttpEvents.map(event => event.kind), ['error']);
  assert.equal(deniedHttpEvents[0].error.code, 'data.denied');
  authMode = 'allow';

  await writeFile('index.html', '<!doctype html><html><body><script type="module" src="browser.js"></script></body></html>');
  await writeFile('browser.js', \`
import {createDataHttpHandler, createHttpDataService, createLocalDataService} from '@varendo/runtime/data';
import {createResultStore} from '@varendo/runtime/results';
import {createRegionStore} from '@varendo/runtime/regions';
import {parseRegionDocument, serializeRegionDocument} from '@varendo/runtime/persistence';
import {createActionPort, createActionRegistry} from '@varendo/runtime/actions';
import {createLocalAuditExporter} from '@varendo/runtime/audit';
import {createInteractionController, createInteractionGraph} from '@varendo/runtime/interaction';
const fixture = ${fixtureSource};
const {catalog, rows, budget, query} = fixture;
${regionExerciseSource}
${interactionExerciseSource}
${actionExerciseSource}
${auditExerciseSource}
const describeRequest = requestId => ({version:'1',requestId,catalogRevision:null,target:{kind:'catalog'},budget,pageSize:1});
const planRequest = requestId => ({version:'1',requestId,catalogRevision:'catalog-1',target: { taskId: requestId, outputId:'employees-output'},query,budget});
const collect = async iterable => {const events=[];for await (const event of iterable) events.push(event);return events;};
const runFlow = async client => {
  const described = await client.describe(describeRequest('browser-describe'));
  if (!described.ok) throw new Error(described.diagnostics[0]?.code ?? 'describe failed');
  const accepted = await client.plan(planRequest('browser-plan'));
  if (!accepted.ok) throw new Error(accepted.diagnostics[0]?.code ?? 'plan failed');
  const events = await collect(client.execute(accepted.value));
  if (events.length !== 4 || events.at(-1)?.kind !== 'complete') throw new Error('browser result stream failed');
  const store = createResultStore();
  const pins = accepted.value;
  const handle = store.begin({principalKey:'browser-host',scopeDigest:pins.scopeDigest,policyRevision:pins.policyRevision,
    queryDigest:pins.queryDigest,catalogRevision:pins.catalogRevision,functionRegistryDigest:pins.functionRegistryDigest,
    sourceRevision:pins.sourceRevision,outputId:pins.target.outputId,taskId:events[0].descriptor.taskId,
    requestId:pins.requestId,populationDigest:pins.populationDigest});
  await collect(handle.subscribe(client.execute(pins)));
  if (handle.snapshot().status !== 'ready') throw new Error('browser result handle failed');
  store.revoke({principalKey:'browser-host'});
  if (handle.snapshot().loadedRows !== 0) throw new Error('browser revoked rows retained');
  store.dispose();
  return {scopeDigest: described.value.scopeDigest, rows: events.find(event => event.kind === 'batch')?.rows.length ?? 0};
};
const localService = createLocalDataService({snapshot:{catalog,sourceRevision:'browser-source',records:{employees:rows}}});
const localHandler = createDataHttpHandler({service:localService});
const localClient = createHttpDataService({baseUrl:'http://in-memory.invalid',fetch:(input,init) => localHandler(new Request(input,init))});
const networkClient = createHttpDataService({baseUrl:location.origin,headers:{authorization:'Bearer browser'}});
const local = await runFlow(localClient);
const network = await runFlow(networkClient);
// Exercise the native browser loader repeatedly: completed direct stream reads
// previously raced its completion notification on Linux Chromium.
const transportFlows = 21;
for (let flow = 1; flow < transportFlows; flow++) await runFlow(networkClient);
const regions = await exerciseRegions();
const actions = await exerciseActions();
const interaction = await exerciseInteraction();
const auditBrowserIoAttempts = [];
const realFetch = globalThis.fetch;
const RealXMLHttpRequest = globalThis.XMLHttpRequest;
const RealWebSocket = globalThis.WebSocket;
globalThis.fetch = () => { auditBrowserIoAttempts.push('fetch'); throw new Error('audit browser fetch blocked'); };
globalThis.XMLHttpRequest = class { constructor() { auditBrowserIoAttempts.push('XMLHttpRequest'); throw new Error('audit browser XHR blocked'); } };
globalThis.WebSocket = class { constructor() { auditBrowserIoAttempts.push('WebSocket'); throw new Error('audit browser WebSocket blocked'); } };
const audit = {...exerciseAudit(), browserIoAttempts: [...auditBrowserIoAttempts]};
globalThis.fetch = realFetch;
globalThis.XMLHttpRequest = RealXMLHttpRequest;
globalThis.WebSocket = RealWebSocket;
globalThis.__varendoBrowserData = {local,network,transportFlows,regions,actions,interaction,audit};
\`);
  await writeFile('vite.config.mjs', \`export default {build:{minify:true,outDir:'dist',rollupOptions:{input:'index.html'}},plugins:[{name:'record-runtime-modules',generateBundle(_,bundle){const modules=Object.values(bundle).filter(item=>item.type==='chunk').flatMap(item=>Object.keys(item.modules));this.emitFile({type:'asset',fileName:'modules.json',source:JSON.stringify(modules)});}}]};\`);
  run(['node_modules/.bin/vite', 'build'], process.cwd());
  const browserModules = JSON.parse(await readFile('dist/modules.json', 'utf8'));
  assert(browserModules.some(id => id.includes('@varendo/runtime')), 'Browser graph omitted installed runtime');
  assert(browserModules.some(id => id.includes('@varendo/core')), 'Browser graph omitted installed core');
  const bundleFiles = [];
  for (const path of await (async function files(directory) {
    const result = [];
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isDirectory()) result.push(...await files(path));
      else if (stat.isFile()) result.push(path);
    }
    return result;
  })('dist')) {
    if (extname(path) !== '.js') continue;
    const bytes = await readFile(path);
    bundleFiles.push({file: relative('dist', path), bytes: bytes.length, gzipBytes: gzipSync(bytes).length});
  }
  const initialGzipBytes = bundleFiles.reduce((sum, item) => sum + item.gzipBytes, 0);
  // docs/12 assigns 160 KiB to the complete interactive table path.
  // This data/region subset must fit inside it; passing does not prove that
  // the remaining renderer/interaction code meets the whole-path budget.
  assert(initialGzipBytes <= 160 * 1024, 'Data/region subset alone exceeds the 160 KiB interactive-path budget');

  const staticServer = createServer(async (incoming, outgoing) => {
    if ((incoming.url ?? '').startsWith('/adc/')) {
      await dispatch(httpHandler, incoming, outgoing);
      return;
    }
    try {
      const pathname = new URL(incoming.url ?? '/', baseUrl).pathname;
      const path = resolve(process.cwd(), 'dist', pathname === '/' ? 'index.html' : '.' + pathname);
      assert(path === resolve(process.cwd(), 'dist') || path.startsWith(resolve(process.cwd(), 'dist') + '/'));
      const bytes = await readFile(path);
      outgoing.writeHead(200, {'content-type': extname(path) === '.js' ? 'text/javascript' : 'text/html'});
      outgoing.end(bytes);
    } catch {
      outgoing.writeHead(404);
      outgoing.end();
    }
  });
  await new Promise((resolve, reject) => { staticServer.once('error', reject); staticServer.listen(0, '127.0.0.1', resolve); });
  let browser;
  let browserVersion;
  let browserResult;
  const browserFailures = [];
  try {
    browser = await chromium.launch();
    browserVersion = browser.version();
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    page.on('pageerror', error => browserFailures.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserFailures.push(message.text()); });
    page.on('requestfailed', request => browserFailures.push(request.url() + ': ' + request.failure()?.errorText));
    await page.goto('http://127.0.0.1:' + staticServer.address().port + '/');
    await page.waitForFunction(() => globalThis.__varendoBrowserData !== undefined, null, {polling: 100, timeout: 30_000});
    browserResult = await page.evaluate(() => globalThis.__varendoBrowserData);
    assert.equal(browserResult.local.rows, 3);
    assert.equal(browserResult.network.rows, 1);
    assert.equal(browserResult.transportFlows, 21);
    assert.deepEqual(browserResult.interaction, interactionProof);
    assert.deepEqual(browserResult.audit, {...auditProof, browserIoAttempts: []});
    assert.deepEqual(browserResult.regions, {queryCount: 2, staleCommitRejected: true, leasesReleased: true, restoreRequeried: true});
    assert.deepEqual(browserFailures, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => staticServer.close(resolve));
  }
  const report = {
    passed: true,
    local: {eventKinds: localEvents.map(event => event.kind), stalePlan: staleEvents[0].error.code},
    http: {eventKinds: httpEvents.map(event => event.kind), denied: deniedHttpEvents[0].error.code},
    browser: {result: browserResult, modules: browserModules, bundle: bundleFiles, initialGzipBytes, browserVersion},
    observations,
    regions: regionProof,
    actions: actionProof,
    audit: auditProof,
    auditOffline: ${JSON.stringify(auditOfflineProof)},
    interaction: interactionProof,
    surfaces: ${JSON.stringify({ installed: true, ...surfaceProof })},
  };
  await writeFile(${JSON.stringify(join(runDirectory, 'runtime-report.json'))}, JSON.stringify(report, null, 2) + '\\n');
  console.log('Installed runtime data, results, region transactions, restore, HTTP and Chromium pass.');
} finally {
  await new Promise(resolve => server.close(resolve));
}
`,
);
const consumerOutput = run([process.execPath, 'consumer.mjs'], consumerDirectory);

const sourceDigestAfter = {
  core: await sourceDigest(coreDirectory),
  runtime: await sourceDigest(runtimeDirectory),
};
assert.deepEqual(sourceDigestAfter, sourceDigestBefore, 'Package source changed during consumer verification');
const report = {
  passed: true,
  scope: `@varendo/core and @varendo/runtime ${RELEASE_VERSION} installed tarballs; strict declarations; local/HTTP ADC roundtrip; authorization and stale-plan checks; region commits, result leases, fresh-query restore and bounded redacted local audit export in Node and Chromium.`,
  artifacts: artifacts.map(({ name, version, path, sha256, integrity }) => ({
    name,
    version,
    path,
    sha256,
    integrity,
  })),
  consumer: {
    directory: consumerDirectory,
    lockPath: join(runDirectory, 'consumer-package-lock.json'),
    lockSha256: hash(lockBytes),
  },
  sourceDigestBefore,
  sourceDigestAfter,
  consumerOutput: consumerOutput.trim(),
  environment: {
    node: process.version,
    npm: run(['npm', '--version'], consumerDirectory).trim(),
    pnpm: run(['pnpm', '--version'], root).trim(),
    typescript: '7.0.2',
    vite: '8.2.2',
    playwright: JSON.parse(await readFile(join(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version,
    os: platform(),
    release: release(),
    arch: arch(),
  },
};
await writeFile(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Installed core/runtime data, results, regions, persistence, HTTP and Chromium consumer checks pass.');
console.log(`Evidence: ${join(runDirectory, 'report.json')}`);
