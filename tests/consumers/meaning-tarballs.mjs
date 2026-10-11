import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the public meaning authoring APIs from actual package
 * tarballs outside the workspace. This proves a typed developer quickstart,
  * manual/AI evaluator parity,
  immutable registration,
  host-owned activation,
  * stale/revoked handling,
  and a browser import through the installed graph.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const outputDirectory = join(root, 'artifacts', 'meaning-consumers');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'run-'));
const consumerDirectory = await mkdtemp(join(tmpdir(), 'aeliqo-meaning-consumer-'));
const consumerReal = await realpath(consumerDirectory);

function run(argv, cwd, encoding = 'utf8', env = process.env) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding, env, timeout: 180_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();
const before = sourceDigest();

async function stagePackage(directory, manifest, name) {
  const stage = join(runDirectory, 'staged-packages', name);
  await mkdir(stage, { recursive: true });
  for (const path of manifest.files ?? []) {
    const sourcePath = path === 'README.md' ? join(root, 'docs/packages', `${name}.md`) : join(directory, path);
    await cp(sourcePath, join(stage, path), { recursive: true });
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

const packageNames = ['core', 'runtime', 'agent'];
for (const name of packageNames) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.notEqual(manifest.private, true);
  run(['pnpm', 'build'], directory);
}

const artifacts = [];
for (const name of packageNames) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const tarball = join(runDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
  const stage = await stagePackage(directory, manifest, name);
  run(['pnpm', 'pack', '--out', tarball], stage);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.license, manifest.license);
  if (name === 'runtime')
    assert.deepEqual(packed.exports?.['./meaning'], {
      types: './dist/meaning/index.d.ts',
      import: './dist/meaning/index.js',
    });
  if (name === 'agent')
    assert.deepEqual(packed.exports?.['.'], { types: './dist/index.d.ts', import: './dist/index.js' });
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(
      !JSON.stringify(packed[field] ?? {}).includes('workspace:'),
      `${name} has a workspace dependency in ${field}`,
    );
  }
  const entries = run(['tar', '-tzf', tarball], root).trim().split('\n');
  assert(entries.includes('package/LICENSE'), `${name} tarball is missing LICENSE`);
  assert(entries.includes('package/README.md'), `${name} tarball is missing README.md`);
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${name} tarball leaked source files`);
  artifacts.push({
    name: packed.name,
    version: packed.version,
    path: tarball,
    bytes,
    sha256: hash(bytes),
    integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
    entries,
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
    'vite@8.2.2',
    '@playwright/test@1.63.0',
    '@types/node@24.13.3',
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
  for (const entry of artifact.entries) {
    if (entry.endsWith('/')) continue;
    const installed = await readFile(join(consumerDirectory, location, entry.slice('package/'.length)));
    const packed = run(['tar', '-xOf', artifact.path, entry], root, null);
    assert.equal(hash(installed), hash(packed), `Installed ${artifact.name} bytes differ for ${entry}`);
  }
}
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/agent'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/runtime/node_modules/')),
  [],
);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/agent/node_modules/')),
  [],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const sharedSource = `
import {createStandardFunctionRegistry} from '@varendo/core/expressions';
import {
  createMeaningAuthoring,
  createMeaningEvaluator,
  createMeaningRegistry} from '@varendo/runtime/meaning';
import {createAgentMeaningAuthoring,
  createMeaningProposalCapability,
  createMeaningActivationCapability} from '@varendo/agent/meaning';
import {createAgentCapabilityRegistry,
  createAgentCapabilityDispatcher} from '@varendo/agent/capabilities';

const check = (condition,
  message) => { if (!condition) throw new Error(message); };
const registryResult = createStandardFunctionRegistry('meaning-consumer-functions');
check(registryResult.ok,
  'standard registry');
const registry = registryResult.value;
const fields = [
  {id: 'id',
  label: 'ID',
  role: 'identity',
  type: {value: 'text',
  nullable: false}},
  {id: 'amount',
  label: 'Amount',
  role: 'measure',
  type: {value: 'integer',
  nullable: false}},
  ];
const catalog = {version: '1',
  revision: 'meaning-consumer-catalog',
  functionRegistryDigest: registry.digest,
  entities: [{id: 'orders',
  label: 'Orders',
  identity: ['id'],
  rowGrain: ['id'],
  fields}],
  relationships: [],
  meanings: [],
  capabilities: []};
const source = {revision: 'meaning-consumer-source',
  catalogRevision: catalog.revision,
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  relations: {orders: {entity: 'orders',
  complete: true,
  rows: [{id: 'o-1',
  amount: 2},
  {id: 'o-2',
  amount: 3}]}}};

function makeManual() {
  const authoring = createMeaningAuthoring({catalog,
  registry});
  check(authoring.ok,
  'manual authoring');
  const field = authoring.value.field('orders',
  'amount');
  check(field.ok,
  'catalog field reuse');
  const expression = authoring.value.call({id: 'core.aggregate.sum',
  revision: '1'},
  [field]);
  check(expression.ok,
  'typed aggregate');
  const draft = authoring.value.defineMeaning({id: 'orders.total',
  label: 'Order total',
  description: 'Sum of order amounts',
  expression});
  check(draft.ok,
  'manual definition');
  return {authoring: authoring.value,
  expression,
  draft: draft.value};
}

export async function runMeaningProbe() {
  const manual = makeManual();
  const aiAuthoring = createAgentMeaningAuthoring({catalog,
  registry});
  check(aiAuthoring.ok,
  'AI authoring');
  const aiDraft = aiAuthoring.value.defineMeaning({id: 'orders.total',
  label: 'Order total',
  description: 'Sum of order amounts',
  expression: manual.expression});
  check(aiDraft.ok,
  'AI definition');
  check(aiDraft.value.meaning.origin === 'ai-assisted',
  'AI origin preserved');
  check(aiDraft.value.meaning.lifecycle === 'draft' && aiDraft.value.meaning.authority === 'hypothesis',
  'AI low-risk labels preserved');
  check(aiDraft.value.source.ownership === 'session',
  'AI session scope preserved');

  const evaluator = createMeaningEvaluator({catalog,
  registry});
  check(evaluator.ok,
  'meaning evaluator');
  const manualResult = evaluator.value.evaluate({meaning: manual.draft.meaning,
  entity: 'orders',
  source,
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1'});
  const aiResult = evaluator.value.evaluate({meaning: aiDraft.value.meaning,
  entity: 'orders',
  source,
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1'});
  check(manualResult.ok && aiResult.ok,
  'manual and AI evaluate');
  check(JSON.stringify(manualResult.value.rows) === JSON.stringify(aiResult.value.rows),
  'manual/AI evaluator parity');
  check(JSON.stringify(manualResult.value.rows) === JSON.stringify([{'orders.total': 5}]),
  'expected local aggregate');

  const invalidField = manual.authoring.field('orders',
  'missing');
  check(!invalidField.ok,
  'invalid catalog field rejected');
  const aiProposalCapability = createMeaningProposalCapability({authoring: aiAuthoring.value});
  const proposal = aiProposalCapability.invoke({meaning: aiDraft.value.meaning,
  assumptions: ['Rows are complete.']},
  {
    requestId: 'proposal',
  targetRegionId: 'region',
  goalEpoch: 'goal',
  transport: 'direct',
  signal: new AbortController().signal,
  authority: {principalKey: 'principal',
  regionId: 'region',
  goalEpoch: 'goal',
  grants: ['meaning.propose']},
  });
  check(proposal.state === 'accepted',
  'public AI proposal capability');

  const activeMeaning = {...manual.draft.meaning,
  lifecycle: 'active',
  authority: 'reviewed',
  scope: 'workspace'};
  const activeDraft = manual.authoring.draft(activeMeaning,
  {source: {surface: 'code',
  ownership: 'code',
  readOnly: true}});
  check(activeDraft.ok,
  'active code draft');
  let contextReads = 0;
  const activationContext = (scopeDigest = 'scope-activation') => ({
    principalKey: 'principal',
  scopeDigest,
  policyRevision: 'policy-activation',
  catalogRevision: catalog.revision,
  functionRegistryDigest: registry.digest,
  grants: ['meaning.activate'],
  allowedScopes: ['workspace'],
  policy: {policyRevision: 'policy-activation',
  allowlistedDefinitions: [activeMeaning],
  allowlistedRefs: [{id: activeMeaning.id,
  revision: activeMeaning.revision}],
  minAuthority: 'reviewed'},
  });
  const meaningRegistryResult = createMeaningRegistry({catalog,
  registry,
  activationHost: {
    readContext: () => { contextReads += 1; return {ok: true,
  value: activationContext()}; },
  }});
  check(meaningRegistryResult.ok,
  'meaning registry');
  const meaningRegistry = meaningRegistryResult.value;
  const firstRegistration = meaningRegistry.register({draft: activeDraft.value});
  check(firstRegistration.ok && !firstRegistration.value.idempotent,
  'first immutable registration');
  const idempotent = meaningRegistry.register({draft: activeDraft.value});
  check(idempotent.ok && idempotent.value.idempotent,
  'identical registration idempotent');
  const conflictDraft = manual.authoring.draft({...activeMeaning,
  label: 'Conflicting total'},
  {source: {surface: 'code',
  ownership: 'code',
  readOnly: true}});
  check(conflictDraft.ok,
  'conflict fixture');
  check(!meaningRegistry.register({draft: conflictDraft.value}).ok,
  'same ID/revision conflict rejected');

  const activationCapability = createMeaningActivationCapability({registry: meaningRegistry});
  const activationRegistry = createAgentCapabilityRegistry([activationCapability]);
  check(activationRegistry.ok,
  'activation capability registry');
  const dispatcher = createAgentCapabilityDispatcher({registry: activationRegistry.value,
  host: {
    readContext: () => ({ok: true,
  value: {principalKey: 'principal',
  regionId: 'region',
  goalEpoch: 'goal',
  grants: ['meaning.activate']}}),
  }});
  const activationRequest = {version: '1',
  requestId: 'activation',
  targetRegionId: 'region',
  goalEpoch: 'goal',
  capability: activationCapability.ref,
  operation: 'meaning.activate',
  input: {id: activeMeaning.id,
  revision: activeMeaning.revision}};
  const authorized = await dispatcher.direct.invoke(activationRequest);
  check(authorized.ok && authorized.value.state === 'accepted',
  'host grant and exact allowlist activation');
  check(contextReads === 2,
  'activation performs before/after host reads');
  check(meaningRegistry.list({activeOnly: true}).length === 1,
  'activated entry visible');
  const deniedDispatcher = createAgentCapabilityDispatcher({registry: activationRegistry.value,
  host: {
    readContext: () => ({ok: true,
  value: {principalKey: 'principal',
  regionId: 'region',
  goalEpoch: 'goal',
  grants: []}}),
  }});
  const denied = await deniedDispatcher.direct.invoke({...activationRequest,
  requestId: 'activation-denied'});
  check(denied.ok && denied.value.state === 'denied',
  'independent activation grant enforced');

  let staleReads = 0;
  const staleRegistryResult = createMeaningRegistry({catalog,
  registry,
  activationHost: {
    readContext: () => { staleReads += 1; return {ok: true,
  value: activationContext(staleReads === 1 ? 'scope-before' : 'scope-after')}; },
  }});
  check(staleRegistryResult.ok,
  'stale registry');
  const staleRegistry = staleRegistryResult.value;
  check(staleRegistry.register({draft: activeDraft.value}).ok,
  'stale registration');
  const stale = await staleRegistry.activate({id: activeMeaning.id,
  revision: activeMeaning.revision});
  check(!stale.ok && stale.diagnostics[0].code === 'runtime.meaning-stale',
  'mutated activation context rejected as stale');
  const revoked = meaningRegistry.revoke({id: activeMeaning.id,
  revision: activeMeaning.revision});
  check(revoked.ok && meaningRegistry.list({activeOnly: true}).length === 0,
  'revocation clears active meaning');
  const afterRevoke = await meaningRegistry.activate({id: activeMeaning.id,
  revision: activeMeaning.revision});
  check(!afterRevoke.ok && afterRevoke.diagnostics[0].code === 'runtime.meaning-revoked',
  'revoked meaning cannot reactivate');

  return {manualRows: manualResult.value.rows,
  aiRows: aiResult.value.rows,
  manualAiParity: true,
  invalidFieldRejected: true,
  proposalAccepted: true,
  registrationIdempotent: true,
  versionConflictRejected: true,
  activationReads: contextReads,
  deniedWithoutGrant: true,
  staleRejected: true,
  revokedAndCleared: true};
}
`;

await writeFile(join(consumerDirectory, 'shared.mjs'), sharedSource);
await writeFile(
  join(consumerDirectory, 'node.mjs'),
  `
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runMeaningProbe} from './shared.mjs';
for (const specifier of ['@varendo/core',
  '@varendo/runtime/meaning',
  '@varendo/agent/meaning',
  '@varendo/agent/capabilities']) {
  const resolved = await realpath(fileURLToPath(import.meta.resolve(specifier)));
  if (!resolved.includes('/node_modules/')) throw new Error('Resolved outside installed node_modules: ' + specifier + ' -> ' + resolved);
}
console.log(JSON.stringify(await runMeaningProbe()));
`,
);
await writeFile(
  join(consumerDirectory, 'consumer.ts'),
  `
import {createMeaningAuthoring} from '@varendo/runtime/meaning';
import {createAgentMeaningAuthoring} from '@varendo/agent/meaning';
import {
  type Catalog,
} from '@varendo/core';
import { createStandardFunctionRegistry } from '@varendo/core/expressions';
const registry=createStandardFunctionRegistry('meaning-consumer-functions');
if(!registry.ok) throw new Error('registry');
const catalog={version:'1',revision:'typed-catalog',functionRegistryDigest:registry.value.digest,entities:[{id:'orders',label:'Orders',identity:['id'],rowGrain:['id'],fields:[{id:'id',label:'ID',role:'identity',type:{value:'text',nullable:false}},{id:'amount',label:'Amount',role:'measure',type:{value:'integer',nullable:false}}]}],relationships:[],meanings:[],capabilities:[]} as const satisfies Catalog;
const manual=createMeaningAuthoring({catalog,registry:registry.value});
if(!manual.ok) throw new Error('authoring');
const amount=manual.value.field('orders','amount');
if(!amount.ok) throw new Error('field');
// @ts-expect-error Catalog autocomplete rejects fields absent from the reused schema.
manual.value.field('orders','missing');
const ai=createAgentMeaningAuthoring({catalog,registry:registry.value});
if(!ai.ok) throw new Error('ai');
const draft=ai.value.defineMeaning({id:'orders.total',label:'Total',description:'Sum',expression:manual.value.call({id:'core.aggregate.sum',revision:'1'},[amount])});
if(!draft.ok) throw new Error('draft');
void draft.value.meaning.origin;
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
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['consumer.ts'],
  }) + '\n',
);
run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumerDirectory);
const nodeReport = JSON.parse(
  run(['node', '--disallow-code-generation-from-strings', 'node.mjs'], consumerDirectory).trim(),
);
await writeFile(join(runDirectory, 'node-report.json'), JSON.stringify(nodeReport, null, 2) + '\n');

await writeFile(
  join(consumerDirectory, 'index.html'),
  '<!doctype html><meta charset="utf-8"><div id="status">Running</div><script type="module" src="/browser.mjs"></script>',
);
await writeFile(
  join(consumerDirectory, 'browser.mjs'),
  `import {runMeaningProbe} from './shared.mjs'; window.meaningReport=await runMeaningProbe(); document.querySelector('#status').textContent='Passed';`,
);
await writeFile(join(consumerDirectory, 'vite.config.mjs'), 'export default {build:{target:"es2022"}};\n');
run(['node', 'node_modules/vite/bin/vite.js', 'build'], consumerDirectory);

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = resolve(consumerDirectory, 'dist', relativePath);
    if (!path.startsWith(join(consumerDirectory, 'dist') + '/')) throw new Error('invalid path');
    response.setHeader('content-type', extname(path) === '.js' ? 'text/javascript' : 'text/html');
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
let browser;
let browserReport;
let chromiumVersion;
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Passed');
  browserReport = await page.evaluate(() => window.meaningReport);
  assert.deepEqual(browserReport, nodeReport, 'Chromium and Node meaning reports differ');
  assert.deepEqual(errors, [], 'Chromium emitted a page error');
} finally {
  await browser?.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}

assert.equal(sourceDigest(), before, 'Source changed during meaning tarball proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      passed: true,
      scope:
        'Installed core/runtime/agent tarballs; typed schema-reuse quickstart; manual/AI evaluator parity; immutable registration conflict/idempotence; trusted grants and exact allowlist activation; stale mutation and revocation; Node no-codegen and Chromium.',
      artifacts: artifacts.map(({ bytes, entries, ...artifact }) => ({ ...artifact, entries })),
      consumerDirectory,
      lockPath: join(runDirectory, 'consumer-package-lock.json'),
      node: nodeReport,
      browser: browserReport,
      environment: {
        node: process.version,
        chromium: chromiumVersion,
        os: platform(),
        release: release(),
        arch: arch(),
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`Installed meaning consumer proof passed. Evidence: ${join(runDirectory, 'report.json')}`);
