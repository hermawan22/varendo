import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the actual @varendo/core package outside the workspace.
 *
 * This is a bounded package-boundary check. It proves the four
 * public document parsers,
  generated schema files,
  task structure,
  experience
 * constraint and semantic meaning passes,
  the installed package graph and a
 * small core bundle,
  plus exact decimal queries,
  ranking,
  cancellation and
 * registered typed interaction graph validation.
 * It does not certify the full planner,
  * the complete product,
  universal browser performance,
  or a universal
 * secret/code scanner.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { access, mkdir, mkdtemp, readFile, realpath, readdir, lstat, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const coreDirectory = join(root, 'packages', 'core');
const outputDirectory = join(root, 'artifacts', 'core-consumers');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'run-'));
const consumerDirectory = await mkdtemp(join(tmpdir(), 'varendo-core-consumer-'));

function run(argv, cwd, encoding = 'utf8', env = process.env) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding,
    env,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    const stdout = result.stdout == null ? '' : String(result.stdout);
    const stderr = result.stderr == null ? '' : String(result.stderr);
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${stdout}\n${stderr}`);
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
      assert(!stat.isSymbolicLink(), `Refuse symlink in package source: ${path}`);
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) result.push(path);
    }
  }
  await visit(directory);
  return result;
}

async function sourceDigest() {
  // The assigned worktree intentionally symlinks packages/core to the parent
  // worktree. Resolve that one approved link and hash only source/config files;
  // generated dist/schemas and dependency trees are excluded.
  const { realpath } = await import('node:fs/promises');
  const actualCore = await realpath(coreDirectory);
  const files = await sortedFiles(actualCore, new Set(['node_modules', 'dist', 'schemas']));
  const h = createHash('sha256');
  for (const path of files) {
    const name = relative(actualCore, path).split('\\').join('/');
    h.update(name)
      .update('\0')
      .update(await readFile(path));
  }
  return h.digest('hex');
}

async function clearCompiledOutput(directory, allowedPattern) {
  if (!(await fileExists(directory))) return;
  const entries = await readdir(directory);
  for (const name of entries) {
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

const sourceBefore = await sourceDigest();
const manifest = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@varendo/core');
assert.equal(manifest.version, RELEASE_VERSION);
assert.equal(manifest.license, 'Apache-2.0');
assert.notEqual(manifest.private, true);
assert.equal(manifest.dependencies?.zod, '4.5.4');
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ['zod']);
assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}), []);
assert.deepEqual(Object.keys(manifest.optionalDependencies ?? {}), []);
assert.equal(manifest.exports?.['./schema']?.import, './dist/contracts/schemas.js');
assert.equal(manifest.exports?.['./features']?.import, './dist/features/index.js');
assert.equal(manifest.exports?.['./features']?.types, './dist/features/index.d.ts');
assert.equal(typeof manifest.exports?.['./schemas/*'], 'string');
assert.equal(manifest.exports?.['.'].import, './dist/index.js');
assert.equal(manifest.exports?.['.'].types, './dist/index.d.ts');
assert(await fileExists(join(coreDirectory, 'src')), 'Core source is not ready; no PASS from a scaffold');

const distDirectory = join(coreDirectory, 'dist');
const schemaDirectory = join(coreDirectory, 'schemas');
await clearCompiledOutput(distDirectory, /(?:\.js|\.d\.ts|\.js\.map|\.d\.ts\.map|\.tsbuildinfo)$/);
await clearCompiledOutput(schemaDirectory, /\.schema\.json$/);
run(['pnpm', 'build'], coreDirectory);

const expectedSchemas = [
  'catalog',
  'task',
  'result',
  'experience',
  'expression',
  'query',
  'interaction',
  'result-event',
  'environment',
  'presentation-plan',
  'task-proposal',
  'meaning-draft',
  'binding-outcome',
  'model-evaluation',
  'operation-grant',
  'agent-loop-budget',
  'agent-stop-reason',
  'narrative-claim',
  'plot-spec',
  'visualization-spec',
];
for (const name of expectedSchemas) {
  const schemaPath = join(schemaDirectory, `${name}.schema.json`);
  assert(await fileExists(schemaPath), `Missing generated schema: ${schemaPath}`);
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  assert.equal(typeof schema, 'object');
}

const tarballPath = join(runDirectory, `varendo-core-${RELEASE_VERSION}.tgz`);
run(['pnpm', 'pack', '--out', tarballPath], coreDirectory);
const tarballBytes = await readFile(tarballPath);
const tarballSha256 = hash(tarballBytes);
const tarballIntegrity = `sha512-${hash(tarballBytes, 'sha512', 'base64')}`;
const packedManifest = JSON.parse(run(['tar', '-xOf', tarballPath, 'package/package.json'], root));
assert.deepEqual(packedManifest, manifest);
assert.equal(packedManifest.name, '@varendo/core');
assert.equal(packedManifest.version, RELEASE_VERSION);
assert.equal(packedManifest.license, 'Apache-2.0');
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  assert(!JSON.stringify(packedManifest[field] ?? {}).includes('workspace:'), `Workspace alias in ${field}`);
}
assert.deepEqual(Object.keys(packedManifest.dependencies ?? {}), ['zod']);
assert.equal(packedManifest.dependencies.zod, '4.5.4');

const tarEntries = run(['tar', '-tzf', tarballPath], root).trim().split('\n');
for (const entry of tarEntries) {
  assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unexpected archive path: ${entry}`);
}
assert(tarEntries.includes('package/LICENSE'), 'Apache license is absent from the tarball');
assert(
  tarEntries.includes('package/dist/features/local-shape.js'),
  'Local shape implementation is absent from tarball',
);
assert(
  tarEntries.includes('package/dist/features/local-shape.d.ts'),
  'Local shape declarations are absent from tarball',
);
for (const name of expectedSchemas) {
  assert(tarEntries.includes(`package/schemas/${name}.schema.json`), `Schema is absent from tarball: ${name}`);
}
assert(!tarEntries.some((entry) => entry.startsWith('package/src/')), 'Source tree leaked into package');

await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run(
  [
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    tarballPath,
    'typescript@7.0.2',
    'vite@8.2.2',
  ],
  consumerDirectory,
);
const lockBytes = await readFile(join(consumerDirectory, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const coreLock = lock.packages['node_modules/@varendo/core'];
assert.equal(coreLock.version, RELEASE_VERSION);
assert.equal(coreLock.integrity, tarballIntegrity);
const corePackageEntries = Object.keys(lock.packages).filter((key) =>
  /(?:^|\/)node_modules\/@varendo\/core$/.test(key),
);
assert.deepEqual(
  corePackageEntries,
  ['node_modules/@varendo/core'],
  'Expected exactly one installed @varendo/core package',
);
assert.equal(lock.packages['node_modules/zod'].version, '4.5.4');
assert.match(lock.packages['node_modules/zod'].integrity, /^sha512-/);
const installedZod = JSON.parse(await readFile(join(consumerDirectory, 'node_modules/zod/package.json'), 'utf8'));
assert.equal(installedZod.license, 'MIT');
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  assert.deepEqual(Object.keys(installedZod[field] ?? {}), [], `Unexpected Zod ${field}`);
}
for (const [name, version] of Object.entries({ typescript: '7.0.2', vite: '8.2.2' })) {
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
  assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
}
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/core/node_modules/')),
  [],
  'Core has unexpected nested production dependencies',
);

for (const entry of tarEntries) {
  if (entry.endsWith('/')) continue;
  const relativeEntry = entry.slice('package/'.length);
  const installedPath = join(consumerDirectory, 'node_modules/@varendo/core', relativeEntry);
  const installedStat = await lstat(installedPath);
  assert(installedStat.isFile(), `Installed package entry is not a regular file: ${relativeEntry}`);
  const packedEntry = run(['tar', '-xOf', tarballPath, entry], root, null);
  assert.equal(hash(await readFile(installedPath)), hash(packedEntry), `Installed bytes differ: ${relativeEntry}`);
}
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const catalogInput = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  entities: [
    {
      id: 'employee',
      label: 'Employee',
      identity: ['employee.id'],
      rowGrain: ['employee'],
      fields: [
        {
          id: 'employee.id',
          label: 'Employee ID',
          type: { value: 'text', nullable: false },
          role: 'identity',
        },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [
    {
      ref: { id: 'employees.remote', revision: '1' },
      entity: 'employee',
      operators: [],
      fields: ['employee.id'],
      relations: [],
      metrics: [],
      pagination: {
        mode: 'snapshot',
        stableOrder: [{ field: 'employee.id', direction: 'asc', nulls: 'last' }],
        identity: ['employee.id'],
      },
      maxOutputRows: 100,
    },
  ],
};
const resultInput = {
  version: '1',
  ref: {
    id: 'result-1',
    revision: '1',
    sourceLineage: 'source-1',
    outputId: 'table',
    queryDigest: 'query-1',
    scopeDigest: 'scope-1',
  },
  taskId: 'task-1',
  fields: [],
  identity: [],
  rowGrain: [],
  counts: { loaded: 0, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'No rows were loaded.' },
  consistency: { kind: 'unknown', reason: 'No source snapshot was requested.' },
  evidence: { kind: 'computed', queryDigest: 'query-1', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const taskInput = {
  version: '1',
  id: 'task-1',
  revision: '1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  regionId: 'employees',
  goal: 'Inspect employees',
  needs: [],
  assumptions: [],
  kind: 'presentation',
  inputs: [resultInput.ref],
};
const experienceInput = {
  version: '1',
  id: 'experience-1',
  revision: '1',
  mode: 'adaptive',
  agentAllowed: false,
  allowedRepresentations: [],
  allowedPatterns: [],
  composition: { allowWithoutPreset: false, maxNodes: 1, maxExpansions: 1 },
  requiredOperations: [],
  tokenProfile: { id: 'tokens-1', revision: '1' },
  extensionAllowlist: [],
  transitionPolicy: 'stable',
};
const documents = { catalog: catalogInput, task: taskInput, result: resultInput, experience: experienceInput };
const commitPins = {
  scopeDigest: resultInput.ref.scopeDigest,
  policyRevision: 'policy-1',
  taskRevision: taskInput.revision,
  regionRevision: 'region-1',
  catalogRevision: catalogInput.revision,
  experienceRevision: experienceInput.revision,
  functionRegistryDigest: catalogInput.functionRegistryDigest,
  results: [resultInput.ref],
};

const { inputs: _presentationInputs, ...taskBaseInput } = taskInput;
const queryInput = {
  entity: 'employees',
  fields: ['employee.id'],
  measures: [],
  relations: [],
  groupBy: ['employee.id'],
  population: { kind: 'all-authorized' },
  order: [],
};
const namedOutputTaskInput = {
  ...taskBaseInput,
  id: 'task-named-output',
  revision: '1',
  goal: 'Load named employee outputs',
  kind: 'data',
  outputs: [
    { id: 'summary', kind: 'query', query: queryInput, dependsOn: ['detail'], delivery: 'eager' },
    { id: 'detail', kind: 'query', query: queryInput, dependsOn: [], delivery: 'eager' },
  ],
};
const cyclicTaskInput = {
  ...namedOutputTaskInput,
  id: 'task-cyclic-output',
  outputs: [
    { ...namedOutputTaskInput.outputs[0], dependsOn: ['detail'] },
    { ...namedOutputTaskInput.outputs[1], dependsOn: ['summary'] },
  ],
};
const fixedPopulationTaskInput = {
  ...taskBaseInput,
  id: 'task-fixed-population',
  revision: '1',
  goal: 'Load a fixed employee cohort',
  kind: 'data',
  outputs: [
    {
      id: 'fixed',
      kind: 'query',
      query: {
        ...queryInput,
        population: { kind: 'fixed', source: resultInput.ref, identityKeys: ['employee.id'], cohortDigest: 'cohort-1' },
      },
      dependsOn: [],
      delivery: 'eager',
    },
  ],
};
const livePopulationTaskInput = {
  ...taskBaseInput,
  id: 'task-live-population',
  revision: '1',
  goal: 'Load a live employee cohort',
  kind: 'data',
  outputs: [
    { id: 'upstream', kind: 'query', query: queryInput, dependsOn: [], delivery: 'eager' },
    {
      id: 'downstream',
      kind: 'query',
      query: {
        ...queryInput,
        population: { kind: 'live-output', outputId: 'upstream', identityKeys: ['employee.id'] },
      },
      dependsOn: ['upstream'],
      delivery: 'eager',
    },
  ],
};
const formTaskInput = {
  ...taskBaseInput,
  id: 'task-form',
  revision: '1',
  goal: 'Edit an employee',
  kind: 'form',
  schema: { id: 'employee.form', revision: '1' },
  action: { id: 'employee.update', revision: '1' },
};
const operationConflictTaskInput = {
  ...formTaskInput,
  id: 'task-operation-conflict',
  needs: [{ id: 'save-employee', operation: { id: 'employee.update', revision: '2' }, fields: [], required: true }],
};
const preferredPresentationTaskInput = {
  ...taskInput,
  id: 'task-preferred-representation',
  viewPreference: { representation: 'chart.bar', strength: 'preferred' },
};
const explicitConflictTaskInput = {
  ...taskInput,
  id: 'task-explicit-representation',
  viewPreference: { representation: 'chart.line', strength: 'explicit' },
};
const noPresetExperienceInput = {
  ...experienceInput,
  id: 'experience-no-preset',
  mode: 'composable',
  allowedRepresentations: ['data.table'],
  composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
};
const preferredExperienceInput = {
  ...experienceInput,
  id: 'experience-preferred',
  mode: 'adaptive',
  allowedRepresentations: ['data.table', 'chart.bar'],
  allowedPatterns: ['table.basic', 'chart.basic'],
  composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
};
const explicitConflictExperienceInput = {
  ...experienceInput,
  id: 'experience-explicit-conflict',
  mode: 'adaptive',
  allowedRepresentations: ['data.table'],
  composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
};
const operationExperienceInput = {
  ...experienceInput,
  id: 'experience-operation-revision',
  mode: 'adaptive',
  allowedRepresentations: ['data.table'],
  requiredOperations: ['employee.update'],
  composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
};
const restrictionIntersectionExperienceInput = {
  ...experienceInput,
  id: 'experience-restriction-intersection',
  mode: 'fixed',
  agentAllowed: false,
  allowedRepresentations: ['data.table', 'chart.bar'],
  allowedPatterns: ['table.basic', 'chart.basic'],
  composition: { allowWithoutPreset: false, maxNodes: 8, maxExpansions: 16 },
};
const wideningRestrictionInput = [
  {
    id: 'host-attempted-widening',
    allowedRepresentations: ['chart.bar'],
    allowedPatterns: ['chart.basic'],
    mode: 'composable',
    agentAllowed: true,
    allowWithoutPreset: true,
    maxNodes: 32,
    maxExpansions: 64,
    transitionPolicy: 'stable',
  },
];
const operationRevisionRestrictionInput = [
  {
    id: 'host-operation-revision',
    allowedOperations: [{ id: 'employee.update', revision: '1' }],
  },
];
const t05Fixtures = {
  namedOutputTaskInput,
  cyclicTaskInput,
  fixedPopulationTaskInput,
  livePopulationTaskInput,
  taskInput,
  formTaskInput,
  operationConflictTaskInput,
  preferredPresentationTaskInput,
  explicitConflictTaskInput,
  experienceInput,
  noPresetExperienceInput,
  preferredExperienceInput,
  explicitConflictExperienceInput,
  operationExperienceInput,
  restrictionIntersectionExperienceInput,
  wideningRestrictionInput,
  operationRevisionRestrictionInput,
};
const semanticCatalogInput = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'core-standard-1',
  entities: [
    {
      id: 'employees',
      label: 'Employees',
      identity: ['employee.id'],
      rowGrain: ['employee.id'],
      fields: [
        { id: 'employee.id', label: 'Employee ID', type: { value: 'text', nullable: false }, role: 'identity' },
        {
          id: 'numerator',
          label: 'Numerator',
          type: { value: 'integer', nullable: false, unit: { dimension: 'count', symbol: 'day' } },
          role: 'measure',
        },
        {
          id: 'denominator',
          label: 'Denominator',
          type: { value: 'integer', nullable: false, unit: { dimension: 'count', symbol: 'day' } },
          role: 'measure',
        },
        {
          id: 'usd',
          label: 'US Dollars',
          type: { value: 'integer', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
          role: 'measure',
        },
        {
          id: 'cents',
          label: 'Cents',
          type: { value: 'integer', nullable: false, unit: { dimension: 'currency', symbol: 'cent' } },
          role: 'measure',
        },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const t04Fixtures = { semanticCatalogInput };
const queryConsumerSource = `
function runInstalledQuery() {
  const registry = createQueryFunctionRegistry();
  if (!registry.ok) throw new Error('Query registry rejected');
  const catalog = {version:'1',
  revision:'installed-query',
  functionRegistryDigest:registry.value.digest,
  entities:[{id:'sales',
  label:'Synthetic sales',
  identity:['id'],
  rowGrain:['id'],
  fields:[
      {id:'id',
  label:'ID',
  role:'identity',
  type:{value:'text',
  nullable:false}},
  {id:'amount',
  label:'Amount',
  role:'measure',
  type:{value:'decimal',
  nullable:false}},
  ]}],
  relationships:[],
  meanings:[],
  capabilities:[]};
  const factory = createQueryPlanner({catalog,
  registry:registry.value,
  limits:{maxRows:10,
  maxBytes:100000,
  maxJoinRows:10,
  maxOperations:10000}});
  if (!factory.ok) throw new Error(JSON.stringify(factory.diagnostics));
  const conditionalRegistry = createQueryFunctionRegistry({version:'2'});
  if (!conditionalRegistry.ok || conditionalRegistry.value.digest !== 'core-query-2') throw new Error('Conditional registry rejected');
  const conditional = checkExpression({kind:'call',
  function:{id:'core.if',
  revision:'1'},
  arguments:[
    {kind:'literal',
  value:true,
  type:{value:'boolean',
  nullable:false}},
  {kind:'literal',
  value:1,
  type:{value:'integer',
  nullable:false}},
  {kind:'literal',
  value:null,
  type:{value:'integer',
  nullable:true}},
  ]},
  {catalog:{...catalog,
  functionRegistryDigest:conditionalRegistry.value.digest},
  registry:conditionalRegistry.value,
  entityId:'sales'});
  if (!conditional.ok || conditional.value.type.value !== 'integer' || conditional.value.type.nullable !== true)
    throw new Error('Installed conditional semantic typing failed');
  const source = {revision:'source-1',
  relations:{sales:{entity:'sales',
  complete:true,
  rows:[
    {id:'first',
  amount:{decimal:'10.01'}},
  {id:'second',
  amount:{decimal:'10.02'}},
  ]}}};
  const wirePlan = factory.value.plan({entity:'sales',
  fields:['id'],
  measures:[],
  relations:[],
  groupBy:[],
  population:{kind:'all-authorized'},
  order:[{field:'amount',
  direction:'desc',
  nulls:'last'}],
  topK:1});
  if (!wirePlan.ok) throw new Error(JSON.stringify(wirePlan.diagnostics));
  const ranked = factory.value.evaluate(wirePlan.value,
  source);
  if (!ranked.ok || ranked.value.rows.length !== 1 || !ranked.value.complete || ranked.value.rows[0]?.id !== 'second') throw new Error('Installed exact ranking failed');
  if (Object.hasOwn(ranked.value.rows[0],
  'amount')) throw new Error('Hidden order field leaked into projection');
  const windowPlan = factory.value.plan({entity:'sales',
  fields:['id',
  'previous'],
  measures:[],
  relations:[],
  groupBy:[],
  population:{kind:'all-authorized'},
  order:[],
  windows:[{id:'previous',
  function:{id:'core.window.lag',
  revision:'1'},
  arguments:[{kind:'field',
  entity:'sales',
  ref:'amount'}],
  partitionBy:[],
  orderBy:[{expression:{kind:'field',
  entity:'sales',
  ref:'id'},
  direction:'asc',
  nulls:'last'}],
  frame:{preceding:2,
  following:0}}]});
  if (!windowPlan.ok) throw new Error(JSON.stringify(windowPlan.diagnostics));
  const windowResult = factory.value.evaluate(windowPlan.value,
  source);
  if (!windowResult.ok || windowResult.value.rows[0]?.previous !== null || windowResult.value.rows[1]?.previous?.decimal !== '10.01')
    throw new Error('Installed canonical previous-row window failed');
  const aggregate = factory.value.plan({root:'sales',
  pins:{catalogRevision:catalog.revision,
  functionRegistryDigest:registry.value.digest},
  select:[{id:'total',
  expression:{kind:'field',
  ref:'total'}}],
  aggregates:[{id:'total',
  function:{id:'core.aggregate.sum',
  revision:'1'},
  arguments:[{kind:'field',
  entity:'sales',
  ref:'amount'}]}]});
  if (!aggregate.ok) throw new Error(JSON.stringify(aggregate.diagnostics));
  const total = factory.value.evaluate(aggregate.value,
  source);
  if (!total.ok || total.value.rows[0]?.total?.decimal !== '20.03' || total.value.precision.kind !== 'exact')
    throw new Error('Installed exact decimal sum failed');
  const mixedPlan = factory.value.plan({root:'sales',
  pins:{catalogRevision:catalog.revision,
  functionRegistryDigest:registry.value.digest},
  select:[{id:'id',
  expression:{kind:'field',
  entity:'sales',
  ref:'id'}},
  {id:'adjusted',
  expression:{kind:'call',
  function:{id:'core.subtract',
  revision:'1'},
  arguments:[
      {kind:'field',
  entity:'sales',
  ref:'amount'},
  {kind:'literal',
  value:2,
  type:{value:'integer',
  nullable:false}},
  ]}}]});
  if (!mixedPlan.ok) throw new Error(JSON.stringify(mixedPlan.diagnostics));
  const mixed = factory.value.evaluate(mixedPlan.value,
  source);
  if (!mixed.ok || mixed.value.rows[0]?.adjusted?.decimal !== '8.01' || mixed.value.precision.kind !== 'exact')
    throw new Error('Installed mixed decimal/integer arithmetic failed');
  const cancelled = factory.value.evaluate(aggregate.value,
  source,
  {cancellation:{aborted:true}});
  if (cancelled.ok) throw new Error('Installed query ignored cancellation');
  const calendar = {calendar:'iso8601',
  timezone:'Asia/Jakarta',
  grain:'day'};
  const datedCatalog = {...catalog,
  entities:[{...catalog.entities[0],
  fields:[...catalog.entities[0].fields,
  {id:'day',
  label:'Day',
  role:'time',
  type:{value:'date',
  nullable:false,
  temporal:calendar}}]}]};
  const dated = createQueryPlanner({catalog:datedCatalog,
  registry:registry.value});
  if (!dated.ok) throw new Error('Installed calendar planner failed');
  const weekly = dated.value.plan({entity:'sales',
  fields:['day'],
  measures:[],
  relations:[],
  groupBy:['day'],
  population:{kind:'all-authorized'},
  order:[{field:'day',
  direction:'asc',
  nulls:'last'}],
  timeBucket:{field:'day',
  grain:'week',
  calendar:calendar.calendar,
  timezone:calendar.timezone,
  weekStartsOn:1}});
  if (!weekly.ok) throw new Error(JSON.stringify(weekly.diagnostics));
  const weeks = dated.value.evaluate(weekly.value,
  {revision:'dated-1',
  relations:{sales:{entity:'sales',
  complete:true,
  rows:source.relations.sales.rows.map((row,
  index)=>({...row,
  day:index===0?'2026-01-04':'2026-01-05'}))}}});
  if (!weeks.ok || JSON.stringify(weeks.value.rows)!==JSON.stringify([{day:'2025-12-29'},
  {day:'2026-01-05'}]) ||
      weeks.value.schema.fields[0]?.type.temporal?.timezone!=='Asia/Jakarta') throw new Error('Installed civil weekly policy failed');
  return {ranked:ranked.value.rows,
  total:total.value.rows,
  precision:total.value.precision};
}
`;

function runInstalledInteractionGraph(validateInteractionGraph, parseInteractionState) {
  const shape = { payload: 'selection', entity: 'employee', identity: ['employee-id'], grain: ['employee-id'] };
  const mapping = { ref: { id: 'selection.identity', revision: '1' }, source: shape, target: shape, kind: 'identity' };
  const nodes = ['table', 'chart', 'detail'].map((id) => ({
    id,
    ports: [{ id: 'selection', direction: 'inout', ...shape }],
  }));
  const links = nodes.map((node, index) => ({
    id: 'link-' + index,
    source: { node: node.id, port: 'selection' },
    target: { node: nodes[(index + 1) % nodes.length].id, port: 'selection' },
    mapping: mapping.ref,
    propagation: 'identity-equivalence',
  }));
  const valid = validateInteractionGraph({ nodes, links }, [mapping]);
  if (!valid.ok || !Object.isFrozen(valid.value.nodes[0].ports[0].identity))
    throw new Error('Installed selection equivalence validation failed');
  const directed = validateInteractionGraph(
    { nodes, links: links.map((link) => ({ ...link, propagation: 'directed' })) },
    [mapping],
  );
  if (directed.ok || directed.diagnostics[0].code !== 'interaction.feedback')
    throw new Error('Installed graph accepted arbitrary feedback');
  if (validateInteractionGraph({ nodes, links }, []).ok)
    throw new Error('Installed graph accepted an unregistered mapping');
  if (validateInteractionGraph({ nodes, links, actor: 'human' }, [mapping]).ok)
    throw new Error('Installed graph accepted forged authority');
  const state = {
    version: '1',
    values: [{ nodeId: 'table', portId: 'selection', payload: { kind: 'selection', selection: { mode: 'clear' } } }],
    drafts: [
      {
        domain: 'directory',
        entity: 'employee',
        key: 'employee-1',
        field: 'name',
        value: 'Draft',
        entityRevision: '1',
      },
    ],
  };
  const retained = parseInteractionState(JSON.parse(JSON.stringify(state)));
  if (!retained.ok || !Object.isFrozen(retained.value.drafts[0]))
    throw new Error('Installed interaction state is not an immutable wire round trip');
  if (parseInteractionState({ ...state, values: [...state.values, ...state.values] }).ok)
    throw new Error('Installed interaction state accepted duplicate routes');
  if (parseInteractionState({ ...state, approved: true }).ok)
    throw new Error('Installed interaction state accepted authority');
  return { ports: 3, selectionEquivalence: true, directedFeedbackRejected: true, unknownMappingRejected: true };
}
const graphConsumerSource = runInstalledInteractionGraph.toString();

function runInstalledPresentation(createPresentationRegistry, documents, current, resolve) {
  const operation = { id: 'read', revision: '1' };
  const resultDescriptor = { ...documents.result, fields: documents.catalog.entities[0].fields };
  const manifest = (id, container) => ({
    ref: { id, revision: '1' },
    configSchema: { id: id + '.config', revision: '1' },
    roles: [container ? 'structure' : 'table'],
    operations: container ? [] : [operation],
    result: container ? 'none' : 'required',
    children: { min: 0, max: container ? 32 : 0 },
    visibility: container ? 'simultaneous' : 'leaf',
    extension: false,
    resolveConfig: (values, result) => ({
      ok: true,
      value: { values, fields: result?.fields.map((field) => field.id) ?? [], ports: [] },
    }),
    suggestConfig: () => ({ ok: true, value: {} }),
  });
  const manifests = [manifest('table', false), manifest('stack', true)];
  const registered = createPresentationRegistry(manifests);
  if (!registered.ok) throw new Error('Installed presentation registry failed');
  const context = {
    task: {
      ...documents.task,
      needs: [
        {
          id: 'read',
          operation,
          outputId: documents.result.ref.outputId,
          fields: [resultDescriptor.fields[0].id],
          required: true,
        },
      ],
    },
    experience: {
      ...documents.experience,
      mode: 'composable',
      allowedRepresentations: ['table', 'stack'],
      composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 1 },
    },
    current,
    results: [resultDescriptor],
    rendererCapabilities: manifests.map((m) => m.ref),
    environment: {
      inlineSize: { state: 'unknown' },
      blockSize: { state: 'unknown' },
      textScale: { state: 'unknown' },
      pointer: 'unknown',
      hover: 'unknown',
      keyboard: 'unknown',
      locale: 'en-US',
      direction: 'ltr',
      reducedMotion: false,
      forcedColors: false,
    },
  };
  const composed = composePresentation(
    { id: 'installed', revision: '1', preconditions: current, context },
    registered.value,
  );
  if (!composed.ok || composed.value.status !== 'composed' || composed.value.expansions !== 1)
    throw new Error('Installed no-preset composition failed');
  const presentation = composed.value.presentation;
  if (presentation.environment.inlineSize.state !== 'unknown' || !Object.isFrozen(presentation.plan))
    throw new Error('Installed presentation lost unknown environment or ownership');
  if (validatePresentationPlan({ ...presentation.plan, coverage: [] }, context, registered.value).ok)
    throw new Error('Installed presentation accepted missing coverage');
  if (
    validatePresentationPlan(
      presentation.plan,
      { ...context, current: { ...current, regionRevision: 'changed' } },
      registered.value,
    ).ok
  )
    throw new Error('Installed presentation accepted stale state');
  const resolver =
    resolve === undefined ? undefined : runInstalledPresentationResolver(resolve, context, registered.value, current);
  return {
    noPreset: true,
    unknownSSR: true,
    coverageChecked: true,
    staleRejected: true,
    ...(resolver === undefined ? {} : resolver),
  };
}

function runInstalledPresentationResolver(resolve, context, registry, current) {
  const target = {
    address: {
      runtimeId: 'installed-runtime',
      scopeInstanceId: 'installed-scope',
      activationEpoch: 1,
      surfaceId: context.task.regionId,
      surfaceGeneration: 1,
    },
    state: 'active',
  };
  const resolved = resolve({
    id: 'installed-resolver',
    revision: '1',
    preconditions: current,
    context,
    registry,
    target,
    candidates: [],
  });
  if (resolved.status !== 'ready' || !Object.isFrozen(resolved.plan.plan))
    throw new Error('Installed presentation resolver did not return a validated ready plan');
  const inactive = resolve({
    id: 'installed-resolver-inactive',
    revision: '1',
    preconditions: current,
    context,
    registry,
    target: { ...target, state: 'stale' },
    candidates: [],
  });
  if (inactive.status !== 'unsupported' || inactive.diagnostic.code !== 'presentation.target-inactive')
    throw new Error('Installed presentation resolver accepted inactive target evidence');
  return { resolverReady: true, inactiveTargetRejected: true };
}
const presentationConsumerSource = runInstalledPresentation.toString();
const presentationResolverConsumerSource = runInstalledPresentationResolver.toString();

function runInstalledAgentContracts(parseContract, serializeContract, compareScalars, resultRef) {
  const type = { value: 'decimal', nullable: false };
  const claim = {
    version: '1',
    id: 'claim',
    kind: 'value',
    cell: { result: resultRef, field: 'rate', identity: { id: 'e1' }, type, populationDigest: 'cohort', filters: [] },
    value: { decimal: '0.1250' },
  };
  const wire = serializeContract('narrative-claim', claim);
  if (!wire.ok || !parseContract('narrative-claim', wire.value).ok)
    throw new Error('Installed narrative round trip failed');
  if (parseContract('narrative-claim', { ...claim, text: 'The cause is proved.' }).ok)
    throw new Error('Numerical claim accepted authorizing prose');
  if (
    !parseContract('operation-grant', JSON.stringify('task.propose')).ok ||
    parseContract('operation-grant', JSON.stringify('act')).ok
  )
    throw new Error('Independent grant vocabulary failed');
  const compared = compareScalars({ decimal: '0.125' }, claim.value, type);
  if (!compared.ok || compared.value !== 0) throw new Error('Installed exact scalar comparison failed');
  return { claimShapeChecked: true, proseSeparated: true, grantsIndependent: true };
}
const agentConsumerSource = runInstalledAgentContracts.toString();

await writeFile(
  join(consumerDirectory, 'consumer-types.ts'),
  `
import {
  parseCatalog,
  parseTask,
  parseResult,
  parseExperience,
  parseQuery,
  parseInteraction,
  parsePresentationPlan,
  parseResultEvent,
  parseContract,
  serializeContract,
  parseWireValue,
  compareScalars,
  parseVisualizationSpec,
  validateTaskStructure,
  resolveExperienceConstraints,
  validateCommitReadSet,
  inferLocalDataShape,
} from '@varendo/core';
import {
  composePresentation,
  resolvePresentation,
  validatePresentationPlan,
  createPresentationRegistry,
} from '@varendo/core/presentation';
import {
  validateInteractionGraph,
  } from '@varendo/core/interaction';
import { z } from 'zod';
import {
  defineDataFeature,
  defineFeature,
} from '@varendo/core/features';
import type { DataFeatureDefinition, FeatureIntentValue } from '@varendo/core/features';
import {
  checkExpression,
  } from '@varendo/core/expressions';
import { createQueryPlanner } from '@varendo/core/query';
import { bindVisualizationSpec } from '@varendo/core/visualization';
import type {
  VisualizationSpec,
  Catalog,
  Task,
  Result,
  Experience,
  Contract,
  CommitPreconditions,
  Outcome,
  TaskStructure,
  Wire,
  PresentationPlan,
  Interaction,
  InteractionPayload,
  InteractionSelection,
  InteractionLink,
  ExperienceRestriction,
  ExperienceConstraints,
  MeaningDefinition,
  QuerySpec,
} from '@varendo/core';
import type {
  InteractionGraph,
  InteractionGraphInput,
  InteractionMappingManifest,
} from '@varendo/core/interaction';
import { parseInteractionState } from '@varendo/core/interaction';
import {
  createStandardFunctionRegistry,
  createTypedAuthoring,
  createQueryFunctionRegistry,
} from '@varendo/core/expressions';
import { inferLocalDataShape as inferFeatureLocalDataShape } from '@varendo/core/features';
import {
  NarrativeClaim,
  OperationGrant,
} from '@varendo/core/agent';
import type {
  PresentationValues } from '@varendo/core/presentation';
import type {
  TypedExpression,
  FunctionRegistry,
  TypedAuthoring,
} from '@varendo/core/expressions';
import type { MeaningBundle } from '@varendo/core/semantics';
import type {
  LogicalPlan,
  QueryPlanner,
  QueryResult,
  QuerySource,
} from '@varendo/core/query';
const installedPersonSchema = z.object({id:z.string(), name:z.string()});
const installedPeopleFeature = defineDataFeature({id:'people',
  schema:installedPersonSchema,
  identity:['id']});
const typedPeopleFeature: DataFeatureDefinition<typeof installedPersonSchema> = installedPeopleFeature;
const installedJobFeature = defineFeature({id:'job',
  capabilities:[{ref:{id:'job.status', revision:'1'},
    kind:'status',
    schema:z.object({jobId:z.string(), state:z.string()})}],
  views:[{ref:{id:'job.progress', revision:'1'},
    capabilities:[{id:'job.status', revision:'1'}]}],
  intents:[{ref:{id:'job.configure', revision:'1'},
    schema:z.object({template:z.string()}),
    capabilities:[{id:'job.status', revision:'1'}],
    views:[{id:'job.progress', revision:'1'}]}]});
const parsedInstalledJob = installedJobFeature.parseIntent({intent:{id:'job.configure', revision:'1'},
  input:{template:'invoice'}});
// @ts-expect-error Data feature identities are immutable metadata.
installedPeopleFeature.identity.push('name');
// @ts-expect-error A typed job intent requires the declared input shape.
const wrongInstalledJobInput: FeatureIntentValue<typeof installedJobFeature.intents> = {intent:{id:'job.configure', revision:'1'}, input:{template:7}};
const installedShapeOutcome = inferLocalDataShape({id:'installed-shape', rows:[{id:'one'}], identity:['id']});
if (!installedShapeOutcome.ok) throw new Error('shape');
const installedShape: import('@varendo/core/features').LocalDataShape = installedShapeOutcome.value;
const installedFeatureShape = inferFeatureLocalDataShape({id:'installed-feature-shape', rows:[], schema:installedPersonSchema, identity:['id']});
// @ts-expect-error Local shape identity fields and callback are mutually exclusive.
inferLocalDataShape({id:'installed-invalid', rows:[{id:'one'}], identity:['id'], getRowId: row => row});
void [typedPeopleFeature, parsedInstalledJob, wrongInstalledJobInput, installedShape, installedFeatureShape];
const commitPins: CommitPreconditions = ${JSON.stringify(commitPins)};
declare const visualizationResult: Result;
const visualization: VisualizationSpec = {version: '1',
  view: 'matrix',
  result: visualizationResult.ref,
  columns: ['employee.id']};
const visualizationBound = bindVisualizationSpec(visualization,
  {results: [visualizationResult]});
void visualizationBound;
// @ts-expect-error A matrix has columns; it cannot accept arbitrary renderer code.
const invalidVisualization: VisualizationSpec = {version:'1', view:'matrix', result:visualizationResult.ref, columns:['employee.id'], render:()=>''};
void invalidVisualization;
const agentGrant: OperationGrant = 'task.propose';
// @ts-expect-error Model presets do not grant authority.
const invalidAgentGrant: OperationGrant = 'act';
const typedClaim: NarrativeClaim = {version:'1',
  id:'claim',
  kind:'inference',
  text:'A hypothesis.',
  references:[]};
void [agentGrant,
  invalidAgentGrant,
  typedClaim];
const nestedPresentationValues: PresentationValues = {nested: [{value: 'text'},
  null,
  1]};
const presentationLiteral: PresentationPlan = {id:'typed',
  revision:'1',
  rootId:'node',
  preconditions:commitPins,
  nodes:[{id:'node',
  role:'table',
  representation:{id:'table',
  revision:'1'},
  config:{schema:{id:'table.config',
  revision:'1'},
  values:nestedPresentationValues},
  children:[]}],
  links:[],
  coverage:[],
  stateTransfer:[],
  diagnostics:[]};
// @ts-expect-error Wire presentation config does not accept executable functions.
const invalidPresentationValues: PresentationValues = {render: () => 'bad'};
void [presentationLiteral,
  invalidPresentationValues];
const checkedPins: Outcome<CommitPreconditions> = validateCommitReadSet(commitPins,
  commitPins,
  commitPins.results);
const checkedGraph: Outcome<InteractionGraph> = validateInteractionGraph({nodes: [],
  links: []} satisfies InteractionGraphInput,
  [] satisfies readonly InteractionMappingManifest[]);
declare const interaction: Interaction;
const interactionPayload: InteractionPayload = interaction.payload;
const clearSelection: InteractionSelection = {mode: 'clear'};
declare const interactionLink: InteractionLink;
// @ts-expect-error Typed event data cannot claim a privileged actor.
const forgedInteraction: Interaction = {...interaction, actor: 'human'};
if (checkedGraph.ok) {
  // @ts-expect-error Validated graphs are immutable.
  checkedGraph.value.links.push(interactionLink);
}
void [interactionPayload,
  clearSelection,
  forgedInteraction];
// @ts-expect-error Read sets are immutable.
commitPins.results.push(commitPins.results[0]!);
void checkedPins;
const unknownWire: Outcome<unknown> = parseWireValue('{}');
if (unknownWire.ok) {
  // @ts-expect-error Ingress is unknown until an envelope schema validates it.
  unknownWire.value.scope;
}
// @ts-expect-error Present undefined is not a wire member.
const invalidWire: Wire<{scope?: string | undefined}> = {scope: undefined};
void invalidWire;
declare const catalog: Catalog;
declare const task: Task;
declare const result: Result;
declare const experience: Experience;
declare const taskStructure: TaskStructure;
declare const restriction: ExperienceRestriction;
declare const constraints: ExperienceConstraints;
const semanticCatalog = ${JSON.stringify(semanticCatalogInput)} as const satisfies Catalog;
declare const authoring: TypedAuthoring<typeof semanticCatalog>;
function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error('unreachable in type-only consumer fixture');
  return outcome.value;
}
const typedCatalog: Catalog = unwrap(parseCatalog({}));
const typedTask: Task = unwrap(parseTask({}));
const typedResult: Result = unwrap(parseResult({}));
const typedExperience: Experience = unwrap(parseExperience({}));
const queryParser: (input: unknown) => Outcome<Contract<'query'>> = parseQuery;
const interactionParser: (input: unknown) => Outcome<Contract<'interaction'>> = parseInteraction;
const presentationParser: (input: unknown) => Outcome<Contract<'presentation-plan'>> = parsePresentationPlan;
const resultEventParser: (input: unknown) => Outcome<Contract<'result-event'>> = parseResultEvent;
const typedStructure: TaskStructure = taskStructure;
const typedRestriction: ExperienceRestriction = restriction;
const typedConstraints: ExperienceConstraints = constraints;
const typedRegistry: Outcome<FunctionRegistry> = createStandardFunctionRegistry();
const typedQueryRegistry: Outcome<FunctionRegistry> = createQueryFunctionRegistry();
const typedConditionalRegistry: Outcome<FunctionRegistry> = createQueryFunctionRegistry({version:'2'});
const typedQueryPlanner: Outcome<QueryPlanner> = createQueryPlanner({catalog: typedCatalog,
  registry: unwrap(typedQueryRegistry)});
const typedQuery: QuerySpec = {entity:'sales',
  fields:['id'],
  measures:[],
  relations:[],
  groupBy:[],
  population:{kind:'all-authorized'},
  order:[]};
const typedPlan: Outcome<LogicalPlan> = unwrap(typedQueryPlanner).plan(typedQuery);
const typedSource: QuerySource = {revision:'source-1',
  relations:{sales:{entity:'sales',
  complete:true,
  rows:[{id:'one'}]}}};
const typedEvaluation: Outcome<QueryResult> = unwrap(typedQueryPlanner).evaluate(unwrap(typedPlan),
  typedSource);
// @ts-expect-error A plan query cannot be executable JavaScript text.
unwrap(typedQueryPlanner).plan('return records');
void typedEvaluation;
const typedNumerator: Outcome<TypedExpression> = authoring.field('employees',
  'numerator');
const typedDenominator: Outcome<TypedExpression> = authoring.field('employees',
  'denominator');
const typedRatio: Outcome<TypedExpression> = authoring.ratioOfSums({
  numerator: typedNumerator,
  denominator: typedDenominator,
  zeroDenominator: 'null',
  });
const typedMeaning: Outcome<MeaningDefinition> = authoring.defineMetric({
  id: 'employee.rate',
  label: 'Employee rate',
  description: 'A same-unit ratio.',
  expression: typedRatio,
  aggregation: 'ratio-of-sums',
  });
const typedBundle: Outcome<MeaningBundle> = authoring.bundle([]);
// @ts-expect-error Entity IDs are derived from the const catalog for autocomplete.
authoring.field('unknown-entity', 'numerator');
// @ts-expect-error Field IDs are derived from the selected entity for autocomplete.
authoring.field('employees', 'unknown-field');
// @ts-expect-error Ratio-of-sums requires an explicit zero-denominator policy.
authoring.ratioOfSums({numerator: typedNumerator,
  denominator: typedDenominator});
void [catalog,
  task,
  result,
  experience,
  typedCatalog,
  typedTask,
  typedResult,
  typedExperience];
void [queryParser, interactionParser, presentationParser, resultEventParser];
void [typedStructure,
  typedRestriction,
  typedConstraints,
  typedRegistry,
  typedNumerator,
  typedDenominator,
  typedRatio,
  typedMeaning,
  typedBundle];
void parseContract('catalog',
  catalog);
void parseContract('task',
  task);
void parseContract('result',
  result);
void parseContract('experience',
  experience);
void serializeContract('catalog',
  catalog);
void serializeContract('task',
  task);
void serializeContract('result',
  result);
void serializeContract('experience',
  experience);
const structureOutcome: Outcome<TaskStructure> = validateTaskStructure(task);
const constraintsOutcome: Outcome<ExperienceConstraints> = resolveExperienceConstraints(experience,
  task,
  []);
void [structureOutcome,
  constraintsOutcome];
// @ts-expect-error TaskStructure output order is readonly for consumers.
taskStructure.outputOrder.push('unexpected');
// @ts-expect-error ExperienceRestriction fields are readonly wire data.
restriction.id = 'unexpected';
// @ts-expect-error Resolved constraints cannot be mutated by a consumer.
constraints.allowedRepresentations.push('unexpected');
// @ts-expect-error Task contracts do not carry self-declared actor authority.
void taskStructure.task.actor;
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

const fixtureSource = JSON.stringify(documents);
const t05FixtureSource = JSON.stringify(t05Fixtures);
const t04FixtureSource = JSON.stringify(t04Fixtures);
await writeFile(
  join(consumerDirectory, 'consumer.mjs'),
  `
import assert from 'node:assert/strict';
import {
  createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {
  parseCatalog,
  parseTask,
  parseResult,
  parseExperience,
  parseQuery,
  parseInteraction,
  parsePresentationPlan,
  parseResultEvent,
  parseContract,
  serializeContract,
  parseWireValue,
  compareScalars,
  parseVisualizationSpec,
  validateTaskStructure,
  resolveExperienceConstraints,
  validateCommitReadSet,
  inferLocalDataShape,
} from '@varendo/core';
import { bindVisualizationSpec } from '@varendo/core/visualization';
import {
  validateInteractionGraph,
  parseInteractionState,
} from '@varendo/core/interaction';
import {
  createPresentationRegistry,
  composePresentation,
  resolvePresentation,
  validatePresentationPlan,
} from '@varendo/core/presentation';
import {
  checkExpression,
  createQueryFunctionRegistry,
  createStandardFunctionRegistry,
  createTypedAuthoring,
} from '@varendo/core/expressions';
import { inferLocalDataShape as inferFeatureLocalDataShape } from '@varendo/core/features';
import { z } from 'zod';
import { authorizeMeaningActivation } from '@varendo/core/semantics';
import { createQueryPlanner } from '@varendo/core/query';
assert.deepEqual(parseWireValue('{"requestId":"one"}'),
  {ok:true,
  value:{requestId:'one'}});
assert.equal(parseWireValue('{"requestId":"one","requestId":"two"}').ok,
  false);
assert.equal(parseWireValue({requestId:undefined}).ok,
  false);
const localSchema = z.object({id: z.string(), value: z.string().nullable()});
const localReady = inferLocalDataShape({id: 'installed-local', rows: [{id: 'one', value: 'ready'}], schema: localSchema, identity: ['id']});
assert.equal(localReady.ok, true);
assert.equal(inferFeatureLocalDataShape({id: 'installed-empty', rows: [], schema: localSchema, identity: ['id']}).ok, true);
assert.equal(inferLocalDataShape({id: 'installed-duplicate', rows: [{id: 'one'}, {id: 'one'}], identity: ['id']}).ok, false);
// @ts-expect-error A local shape cannot declare identity fields and a callback together.
inferLocalDataShape({id: 'installed-invalid', rows: [{id: 'one'}], identity: ['id'], getRowId: row => row});
const commitPins = ${JSON.stringify(commitPins)};
const documents = ${fixtureSource};
const t05 = ${t05FixtureSource};
const t04 = ${t04FixtureSource};
const relationQuery = {...t05.namedOutputTaskInput.outputs[0].query,
  relations: [{id: 'employees.orders',
  revision: '1'}],
  relationUsage: [{relation: {id: 'employees.orders',
  revision: '1'},
  kind: 'semi'}]};
assert.equal(parseContract('query',
  relationQuery).ok,
  true);
assert.equal(parseContract('query',
  {...relationQuery,
  relations: [],
  relationUsage: [],
  windows: [
  {id: 'rank',
  function: {id: 'core.window.rank',
  revision: '1'},
  arguments: [],
  partitionBy: [],
  orderBy: [],
  frame: {preceding: 0,
  following: 0}},
  ]}).ok,
  true);
assert.equal(parseContract('query',
  {...relationQuery,
  relationUsage: [{...relationQuery.relationUsage[0],
  approved: true}]}).ok,
  false);
assert.equal(validateCommitReadSet(commitPins,
  commitPins,
  commitPins.results).ok,
  true);
assert.equal(validateCommitReadSet(commitPins,
  {...commitPins,
  results: []}).ok,
  false);
function unwrap(outcome) {
  assert.equal(outcome.ok,
  true);
  return outcome.value;
}
const visualizationResult = {...documents.result,
  fields: documents.catalog.entities[0].fields,
  identity: ['employee.id'],
  rowGrain: ['employee.id']};
const visualization = {version: '1',
  view: 'matrix',
  result: visualizationResult.ref,
  columns: ['employee.id']};
assert.equal(parseVisualizationSpec(visualization).ok,
  true);
assert.deepEqual(parseVisualizationSpec(unwrap(serializeContract('visualization-spec',
  visualization))),
  {ok: true,
  value: visualization});
assert.equal(bindVisualizationSpec(visualization,
  {results: [visualizationResult]}).ok,
  true);
assert.equal(bindVisualizationSpec(visualization,
  {results: []}).ok,
  false);
const direct = {
  catalog: unwrap(parseCatalog(documents.catalog)),
  task: unwrap(parseTask(documents.task)),
  result: unwrap(parseResult(documents.result)),
  experience: unwrap(parseExperience(documents.experience)),
  };
for (const [kind,
  input] of Object.entries(documents)) {
  const parsed = parseContract(kind,
  input);
  assert.equal(parsed.ok,
  true);
  assert.deepEqual(parsed.value,
  direct[kind]);
  const encoded = serializeContract(kind,
  direct[kind]);
  assert.equal(encoded.ok,
  true);
  const wire = JSON.parse(encoded.value);
  const reparsed = parseContract(kind,
  wire);
  assert.equal(reparsed.ok,
  true);
  assert.deepEqual(reparsed.value,
  direct[kind]);
  assert.notEqual(JSON.stringify(wire),
  undefined);
}
assert.equal(parseCatalog({...documents.catalog,
  unexpected: true}).ok,
  false);
assert.equal(parseContract('task',
  {...documents.task,
  unexpected: true}).ok,
  false);
const named = unwrap(validateTaskStructure(t05.namedOutputTaskInput));
assert.deepEqual(named.outputOrder,
  ['detail',
  'summary']);
assert.deepEqual(named.resultReferences,
  []);
assert.deepEqual(named.task.outputs.map((output) => output.id),
  ['summary',
  'detail']);
const fixedPopulation = unwrap(validateTaskStructure(t05.fixedPopulationTaskInput));
assert.deepEqual(fixedPopulation.outputOrder,
  ['fixed']);
assert.deepEqual(fixedPopulation.resultReferences,
  [t05.fixedPopulationTaskInput.outputs[0].query.population.source]);
const livePopulation = unwrap(validateTaskStructure(t05.livePopulationTaskInput));
assert.deepEqual(livePopulation.outputOrder,
  ['upstream',
  'downstream']);
assert.deepEqual(livePopulation.resultReferences,
  []);
const cycle = validateTaskStructure(t05.cyclicTaskInput);
assert.equal(cycle.ok,
  false);
if (!cycle.ok) assert(cycle.diagnostics.some((diagnostic) => diagnostic.code === 'task.output-cycle'));
const form = unwrap(validateTaskStructure(t05.formTaskInput));
assert.deepEqual(form.outputOrder,
  []);
assert.deepEqual(form.resultReferences,
  []);
const noPreset = unwrap(resolveExperienceConstraints(t05.noPresetExperienceInput,
  t05.taskInput));
assert.equal(noPreset.allowWithoutPreset,
  true);
assert.equal(noPreset.compositionChangeAllowed,
  true);
const preferred = unwrap(resolveExperienceConstraints(t05.preferredExperienceInput,
  t05.preferredPresentationTaskInput));
assert.deepEqual(preferred.allowedRepresentations,
  ['chart.bar',
  'data.table']);
assert.equal(preferred.preferredRepresentation,
  'chart.bar');
const explicit = resolveExperienceConstraints(t05.explicitConflictExperienceInput,
  t05.explicitConflictTaskInput);
assert.equal(explicit.ok,
  false);
if (!explicit.ok) assert(explicit.diagnostics.some((diagnostic) => diagnostic.code === 'experience.representation-conflict'));
const intersected = unwrap(resolveExperienceConstraints(
  t05.restrictionIntersectionExperienceInput,
  t05.taskInput,
  t05.wideningRestrictionInput,
  ));
assert.deepEqual(intersected.allowedRepresentations,
  ['chart.bar']);
assert.deepEqual(intersected.allowedPatterns,
  ['chart.basic']);
assert.equal(intersected.mode,
  'fixed');
assert.equal(intersected.agentAllowed,
  false);
assert.equal(intersected.allowWithoutPreset,
  false);
const operationConflict = resolveExperienceConstraints(
  t05.operationExperienceInput,
  t05.operationConflictTaskInput,
  t05.operationRevisionRestrictionInput,
  );
assert.equal(operationConflict.ok,
  false);
if (!operationConflict.ok) assert(operationConflict.diagnostics.some((diagnostic) => diagnostic.code === 'experience.operation-conflict'));
const semanticCatalog = t04.semanticCatalogInput;
const standardRegistry = unwrap(createStandardFunctionRegistry());
assert.equal(standardRegistry.digest,
  'core-standard-1');
const authoring = unwrap(createTypedAuthoring({catalog: semanticCatalog,
  registry: standardRegistry}));
const numerator = unwrap(authoring.field('employees',
  'numerator'));
const denominator = unwrap(authoring.field('employees',
  'denominator'));
const ratio = unwrap(authoring.ratioOfSums({numerator,
  denominator,
  zeroDenominator: 'null'}));
assert.equal(ratio.operation,
  'ratio-of-sums');
assert.equal(ratio.aggregation,
  'ratio-of-sums');
assert.equal(ratio.type.unit,
  undefined);
const sameUnitMeaning = unwrap(authoring.defineMetric({
  id: 'employee.rate',
  label: 'Employee rate',
  description: 'A same-unit ratio.',
  expression: ratio,
  aggregation: 'ratio-of-sums',
  }));
assert.equal(sameUnitMeaning.origin,
  'manual');
assert.equal(sameUnitMeaning.lifecycle,
  'draft');
assert.equal(sameUnitMeaning.authority,
  'hypothesis');
const unknownVersion = checkExpression({
  kind: 'call',
  function: {id: 'core.add',
  revision: '999'},
  arguments: [numerator.expression,
  denominator.expression],
  },
  {catalog: semanticCatalog,
  registry: standardRegistry,
  entityId: 'employees'});
assert.equal(unknownVersion.ok,
  false);
if (!unknownVersion.ok) assert(unknownVersion.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.function-version'));
const invalidCurrency = checkExpression({
  kind: 'call',
  function: {id: 'core.add',
  revision: '1'},
  arguments: [{kind: 'field',
  ref: 'usd'},
  {kind: 'field',
  ref: 'cents'}],
  },
  {catalog: semanticCatalog,
  registry: standardRegistry,
  entityId: 'employees'});
assert.equal(invalidCurrency.ok,
  false);
if (!invalidCurrency.ok) assert(invalidCurrency.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.unit-mismatch'));
const idempotentBundle = unwrap(authoring.bundle([sameUnitMeaning,
  sameUnitMeaning]));
assert.equal(idempotentBundle.meanings.length,
  1);
const conflictingBundle = authoring.bundle([sameUnitMeaning,
  {...sameUnitMeaning,
  label: 'Conflicting employee rate'}]);
assert.equal(conflictingBundle.ok,
  false);
if (!conflictingBundle.ok) assert(conflictingBundle.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.definition-conflict'));
const duplicateAggregationDimensions = authoring.defineMetric({
  id: 'employee.rate.duplicate-grain',
  label: 'Duplicate grain rate',
  description: 'A deliberately duplicated aggregation grain.',
  expression: ratio,
  aggregation: 'ratio-of-sums',
  aggregationDimensions: ['employee.id',
  'employee.id'],
  });
assert.equal(duplicateAggregationDimensions.ok,
  false);
if (!duplicateAggregationDimensions.ok) assert(duplicateAggregationDimensions.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.aggregation-grain'));
const activation = authorizeMeaningActivation(sameUnitMeaning,
  {
  policyRevision: 'policy-1',
  allowlistedDefinitions: [sameUnitMeaning],
  allowlistedRefs: [{id: sameUnitMeaning.id,
  revision: sameUnitMeaning.revision}],
  });
assert.equal(activation.ok,
  false);
if (!activation.ok) assert(activation.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.activation-lifecycle'));
const forgedActiveMeaning = {...sameUnitMeaning,
  label: 'Forged employee rate',
  lifecycle: 'active',
  authority: 'approved'};
const forgedActivation = authorizeMeaningActivation(forgedActiveMeaning,
  {
  policyRevision: 'policy-1',
  allowlistedDefinitions: [sameUnitMeaning],
  allowlistedRefs: [{id: sameUnitMeaning.id,
  revision: sameUnitMeaning.revision}],
  });
assert.equal(forgedActivation.ok,
  false);
if (!forgedActivation.ok) assert(forgedActivation.diagnostics.some((diagnostic) => diagnostic.code === 'semantic.activation-denied'));
const require = createRequire(import.meta.url);
for (const name of ${JSON.stringify(expectedSchemas)}) {
  const path = require.resolve('@varendo/core/schemas/' + name + '.schema.json');
  const schema = JSON.parse(await readFile(path,
  'utf8'));
  assert.equal(typeof schema,
  'object');
}
const runtimeSchema = await import('@varendo/core/schema');
assert(Object.keys(runtimeSchema).length > 0);
${queryConsumerSource}
assert.deepEqual(runInstalledQuery().total,
  [{total:{decimal:'20.03'}}]);
${graphConsumerSource}
assert.equal(runInstalledInteractionGraph(validateInteractionGraph,
  parseInteractionState).selectionEquivalence,
  true);
${presentationConsumerSource}
${presentationResolverConsumerSource}
const installedPresentation = runInstalledPresentation(createPresentationRegistry,
  documents,
  commitPins,
  resolvePresentation);
assert.equal(installedPresentation.noPreset,
  true);
assert.equal(installedPresentation.resolverReady,
  true);
assert.equal(installedPresentation.inactiveTargetRejected,
  true);
${agentConsumerSource}
assert.equal(runInstalledAgentContracts(parseContract,
  serializeContract,
  compareScalars,
  documents.result.ref).claimShapeChecked,
  true);
console.log('Installed @varendo/core query planning, exact evaluation and cancellation pass.');
console.log('Installed @varendo/core parsers, schema exports and round trips pass.');
console.log('Installed @varendo/core task structure and experience constraint passes pass.');
console.log('Installed @varendo/core semantic checker and typed authoring passes pass.');
`,
);
const consumerOutput = run([process.execPath, 'consumer.mjs'], consumerDirectory);
const parserProbe = join(consumerDirectory, 'no-codegen.mjs');
await writeFile(
  parserProbe,
  `
import assert from 'node:assert/strict';
globalThis.Function = () => { throw new Error('Function constructor used by core parser'); };
globalThis.eval = () => { throw new Error('eval used by core parser'); };
const core = await import('@varendo/core');
const {parseWireValue} = core;
const expressions = await import('@varendo/core/expressions');
const {createQueryFunctionRegistry, checkExpression} = expressions;
const {createQueryPlanner} = await import('@varendo/core/query');
const interaction = await import('@varendo/core/interaction');
${queryConsumerSource}
assert.equal(runInstalledQuery().precision.kind,
  'exact');
${graphConsumerSource}
assert.equal(runInstalledInteractionGraph(interaction.validateInteractionGraph,
  interaction.parseInteractionState).directedFeedbackRejected,
  true);
assert.deepEqual(parseWireValue('{"requestId":"one"}'),
  {ok:true,
  value:{requestId:'one'}});
assert.equal(parseWireValue('{"requestId":"one","requestId":"two"}').ok,
  false);
assert.equal(parseWireValue({requestId:undefined}).ok,
  false);
const commitPins = ${JSON.stringify(commitPins)};
const documents = ${fixtureSource};
const t05 = ${t05FixtureSource};
const t04 = ${t04FixtureSource};
assert.equal(core.validateCommitReadSet(commitPins,
  {...commitPins,
  policyRevision: 'changed'}).ok,
  false);
assert.equal(core.validateCommitReadSet(commitPins,
  commitPins,
  commitPins.results).ok,
  true);
assert.equal(core.parseCatalog(documents.catalog).ok,
  true);
assert.equal(core.parseTask(documents.task).ok,
  true);
assert.equal(core.parseResult(documents.result).ok,
  true);
assert.equal(core.parseExperience(documents.experience).ok,
  true);
assert.equal(core.parseQuery({}).ok, false);
assert.equal(core.parseInteraction({}).ok, false);
assert.equal(core.parsePresentationPlan({}).ok, false);
assert.equal(core.parseResultEvent({}).ok, false);
assert.equal(core.validateTaskStructure(t05.namedOutputTaskInput).ok,
  true);
assert.equal(core.resolveExperienceConstraints(t05.noPresetExperienceInput,
  t05.taskInput).ok,
  true);
const registry = expressions.createStandardFunctionRegistry();
assert.equal(registry.ok,
  true);
if (registry.ok) {
  const authoring = expressions.createTypedAuthoring({catalog: t04.semanticCatalogInput,
  registry: registry.value});
  assert.equal(authoring.ok,
  true);
  if (authoring.ok) assert.equal(authoring.value.field('employees',
  'numerator').ok,
  true);
}
console.log('No dynamic code generation during core parser and semantic authoring calls.');
`,
);
const parserProbeOutput = run(
  [process.execPath, '--disallow-code-generation-from-strings', parserProbe],
  consumerDirectory,
);

await writeFile(
  join(consumerDirectory, 'index.html'),
  '<!doctype html><html><body><script type="module" src="/bundle-entry.js"></script></body></html>',
);
await writeFile(
  join(consumerDirectory, 'browser-fixtures.json'),
  JSON.stringify({ commitPins, documents, t05: t05Fixtures, t04: t04Fixtures }),
);
// Keep generic parsing and agent contracts in Node; this browser budget covers typed core imports.
await writeFile(
  join(consumerDirectory, 'bundle-entry.js'),
  `
import {
  parseCatalog,
  parseTask,
  parseResult,
  parseExperience,
  parseWireValue,
  validateTaskStructure,
  resolveExperienceConstraints,
  validateCommitReadSet,
} from '@varendo/core';
import {
  createPresentationRegistry,
  composePresentation,
  validatePresentationPlan,
} from '@varendo/core/presentation';
import {
  createStandardFunctionRegistry,
  createTypedAuthoring,
  createQueryFunctionRegistry,
  checkExpression,
} from '@varendo/core/expressions';
import { createQueryPlanner } from '@varendo/core/query';
import {
  validateInteractionGraph,
  parseInteractionState,
} from '@varendo/core/interaction';
const validWire = parseWireValue('{"requestId":"one"}');
if (!validWire.ok || validWire.value.requestId !== 'one' ||
    parseWireValue('{"requestId":"one","requestId":"two"}').ok ||
    parseWireValue({requestId:undefined}).ok) throw new Error('Browser wire parser regression');
const {commitPins, documents, t05, t04} = await fetch(
  new URL('./browser-fixtures.json', import.meta.url),
).then((response) => response.json());
${queryConsumerSource}
const installedQueryResult = runInstalledQuery();
${graphConsumerSource}
const installedInteractionGraph = runInstalledInteractionGraph(validateInteractionGraph, parseInteractionState);
${presentationConsumerSource}
const installedPresentation = runInstalledPresentation(createPresentationRegistry, documents, commitPins);
const semanticRegistry = createStandardFunctionRegistry();
const semanticAuthoring = semanticRegistry.ok
  ? createTypedAuthoring({catalog: t04.semanticCatalogInput, registry: semanticRegistry.value})
  : semanticRegistry;
const semanticField = semanticAuthoring.ok ? semanticAuthoring.value.field('employees', 'numerator') : semanticAuthoring;
const parsed = [
  parseCatalog(documents.catalog), parseTask(documents.task), parseResult(documents.result), parseExperience(documents.experience),
  validateTaskStructure(t05.namedOutputTaskInput), resolveExperienceConstraints(t05.noPresetExperienceInput, t05.taskInput),
  semanticRegistry, semanticAuthoring, semanticField, {ok:true,value:installedQueryResult},
  validateCommitReadSet(commitPins, commitPins, commitPins.results),
  {ok: true, value: installedInteractionGraph}, {ok:true,value:installedPresentation},
];
globalThis.__aeliqoParsed = parsed;
export {parsed};
`,
);
await writeFile(
  join(consumerDirectory, 'vite.config.mjs'),
  `
export default {
  build: {
    minify: true,
    outDir: 'dist',
    // Chromium supports native modulepreload; omit Vite's compatibility shim from the core budget.
    modulePreload: { polyfill: false },
    rollupOptions: {input: 'index.html'},
  },
  plugins: [{name: 'record-core-modules', generateBundle(_, bundle) {
    const modules = Object.values(bundle).filter((item) => item.type === 'chunk').flatMap((item) => Object.keys(item.modules));
    this.emitFile({type: 'asset', fileName: 'modules.json', source: JSON.stringify(modules)});
  }}],
};
`,
);
run([join(consumerDirectory, 'node_modules/.bin/vite'), 'build'], consumerDirectory);
const modules = JSON.parse(await readFile(join(consumerDirectory, 'dist/modules.json'), 'utf8'));
const normalizedModules = modules.map((id) => id.replaceAll(String.fromCharCode(92), '/'));
const normalizedConsumerDirectory = (await realpath(consumerDirectory)).replaceAll(String.fromCharCode(92), '/');
const fixtureModules = new Set([
  `${normalizedConsumerDirectory}/bundle-entry.js`,
  `${normalizedConsumerDirectory}/index.html`,
]);
const coreDistPrefix = `${normalizedConsumerDirectory}/node_modules/@varendo/core/dist/`;
const zodV4Prefix = `${normalizedConsumerDirectory}/node_modules/zod/v4/`;
assert(
  normalizedModules.some((id) => id.startsWith(coreDistPrefix)),
  'Installed core is absent from Vite graph',
);
for (const id of normalizedModules) {
  const isViteFixture = fixtureModules.has(id);
  const isInstalledCore = id.startsWith(coreDistPrefix) && id.endsWith('.js');
  const isInstalledZod = id.startsWith(zodV4Prefix) && /\/(?:core|mini)\/[^/]+\.js$/.test(id);
  assert(isViteFixture || isInstalledCore || isInstalledZod, `Unexpected module in parser graph: ${id}`);
}
const bundleFiles = (await sortedFiles(join(consumerDirectory, 'dist'))).filter((path) => extname(path) === '.js');
const bundleMetrics = [];
for (const path of bundleFiles) {
  const bytes = await readFile(path);
  assert(bytes.includes(Buffer.from('__aeliqoParsed')), `Bundle does not retain observable parser output: ${path}`);
  bundleMetrics.push({
    file: relative(join(consumerDirectory, 'dist'), path),
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
  });
}
const initialGzipBytes = bundleMetrics.reduce((sum, item) => sum + item.gzipBytes, 0);
assert(
  initialGzipBytes <= 70 * 1024,
  `Core consumer bundle exceeds 70 KiB gzip without the Vite preload shim: ${initialGzipBytes}`,
);

// Execute the packed consumer in a real browser: a successful bundle alone
// cannot detect missing globals or runtime-only import failures.
const servedFiles = new Map();
for (const path of await sortedFiles(join(consumerDirectory, 'dist'))) {
  servedFiles.set('/' + relative(join(consumerDirectory, 'dist'), path).split('\\').join('/'), {
    bytes: await readFile(path),
    type: extname(path) === '.js' ? 'text/javascript' : extname(path) === '.html' ? 'text/html' : 'application/json',
  });
}
const server = createServer((request, response) => {
  const file = servedFiles.get(request.url === '/' ? '/index.html' : request.url);
  response.writeHead(file ? 200 : 404, { 'Content-Type': file?.type ?? 'text/plain' });
  response.end(file?.bytes ?? 'Not found');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
let browserOutcomes;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(errors, [], 'Installed browser consumer raised an exception');
  await page.waitForFunction(() => Array.isArray(globalThis.__aeliqoParsed), null, { timeout: 10_000 });
  browserOutcomes = await page.evaluate(() => globalThis.__aeliqoParsed.map((value) => value.ok));
  assert.deepEqual(errors, [], 'Installed browser consumer raised an exception');
  assert(
    browserOutcomes.length > 0 && browserOutcomes.every(Boolean),
    'Installed browser consumer rejected a valid fixture',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

const sourceAfter = await sourceDigest();
assert.equal(sourceAfter, sourceBefore, 'Core source changed during consumer verification');
const report = {
  sourceDigestBefore: sourceBefore,
  sourceDigestAfter: sourceAfter,
  sourceChangedDuringRun: sourceBefore !== sourceAfter,
  scope: `@varendo/core ${RELEASE_VERSION} installed tarball; typed document parsers, generic contract round trips, TaskStructure, ExperienceConstraints, semantic checker and typed authoring passes; generated schemas; 70 KiB Vite bundle budget with the Chromium preload shim disabled. Generic contract parsing, exact decimal aggregation, canonical ranking, cancellation, agent contracts and interaction graph validation are also exercised in Node/no-codegen/Chromium. Full planner and product certification are outside this scoped check.`,
  artifact: {
    name: packedManifest.name,
    version: packedManifest.version,
    path: tarballPath,
    sha256: tarballSha256,
    integrity: tarballIntegrity,
  },
  consumer: {
    directory: consumerDirectory,
    lockPath: join(runDirectory, 'consumer-package-lock.json'),
    lockSha256: hash(lockBytes),
  },
  schemas: expectedSchemas.map((name) => `schemas/${name}.schema.json`),
  browserOutcomes,
  consumerOutput: consumerOutput.trim(),
  parserProbeOutput: parserProbeOutput.trim(),
  bundle: {
    initialGzipBytes,
    files: bundleMetrics,
    modules,
    moduleGraphScope:
      'installed package parser, semantics, query and interaction graph; Vite preload compatibility shim excluded in Chromium; no universal dependency/security certification',
  },
  environment: {
    node: process.version,
    npm: run(['npm', '--version'], consumerDirectory).trim(),
    pnpm: run(['pnpm', '--version'], root).trim(),
    typescript: '7.0.2',
    vite: '8.2.2',
    zod: '4.5.4',
    os: platform(),
    release: release(),
    arch: arch(),
  },
  passed: true,
};
await writeFile(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  'Installed @varendo/core types, parsers, semantic authoring, schemas, interaction graph, no-codegen probe, Vite graph, and Chromium execution pass.',
);
console.log(`Evidence: ${join(runDirectory, 'report.json')}`);
