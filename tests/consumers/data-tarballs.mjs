import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the data family from real package tarballs.
 *
 * The consumer lives outside the pnpm workspace. It installs the packed
 * @varendo/core,
  @varendo/web and @varendo/react artifacts,
  checks every data
 * entry point and declaration surface,
  then exercises data SSR and the
 * browser-owned decimal,
  delta,
  filter and virtual-grid behavior.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, lstat, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/data-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'varendo-data-consumer-'));
const consumerReal = await realpath(consumer);

function run(argv, cwd, encoding = 'utf8') {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${argv.join(' ')} failed: ${result.error ?? ''}\n${String(result.stdout ?? '').slice(-12000)}\n${String(result.stderr ?? '').slice(-12000)}`,
    );
  }
  return result.stdout;
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

// Only compiler output is removable. An unexpected source file or symlink
// means the proof must stop instead of silently masking a dirty package.
async function clearCompiledOutput(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const name of entries) {
    const path = join(directory, name);
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink(), `Refuse build-output symlink: ${path}`);
    if (stat.isDirectory()) {
      await clearCompiledOutput(path);
      await rmdir(path);
    } else {
      assert(
        stat.isFile() && /(?:\.js|\.d\.ts|\.js\.map|\.d\.ts\.map|\.tsbuildinfo)$/.test(name),
        `Unexpected build output: ${path}`,
      );
      await unlink(path);
    }
  }
}

async function measureDirectEntries() {
  const entries = [
    'metric',
    'delta',
    'key-value',
    'detail',
    'record-list',
    'card-collection',
    'selection-summary',
    'filter-builder',
    'table',
  ];
  await writeFile(
    join(consumer, 'measure-bundles.mjs'),
    `
import {build} from 'vite';
import {gzipSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
const measured = [];
for (const entry of ${JSON.stringify(entries)}) {
  await writeFile('measure-entry.js',
  'export * from "@varendo/web/' + entry + '";');
  for (const excludeLit of [false,
  true]) {
    const result = await build({configFile: false,
  logLevel: 'silent',
  build: {write: false,
  minify: true,
  lib: {entry: 'measure-entry.js',
  formats: ['es']},
  rollupOptions: {external: excludeLit ? id => /^(lit|lit-html|lit-element|@lit\\/)/.test(id) : undefined}}});
    const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).filter(item => item.type === 'chunk');
    measured.push({entry,
  excludeLit,
  bytes: chunks.reduce((n,
  item) => n + Buffer.byteLength(item.code),
  0),
  gzipBytes: chunks.reduce((n,
  item) => n + gzipSync(item.code).length,
  0),
  modules: chunks.flatMap(item => Object.entries(item.modules).filter(([,
  module]) => module.renderedLength > 0).map(([id]) => id))});
  }
}
await writeFile('bundle-measurements.json',
  JSON.stringify(measured,
  null,
  2));
`,
  );
  run(['node', 'measure-bundles.mjs'], consumer);
  const measurements = JSON.parse(await readFile(join(consumer, 'bundle-measurements.json'), 'utf8'));
  assert.deepEqual(
    measurements.map((item) => [item.entry, item.excludeLit]),
    entries.flatMap((entry) => [
      [entry, false],
      [entry, true],
    ]),
    'Direct entry measurements must cover every entry with and without Lit',
  );
  for (const item of measurements) {
    assert(
      item.bytes > 0 && item.gzipBytes > 0 && item.modules.length > 0,
      `${item.entry} produced no measurable JavaScript`,
    );
    assert(
      !item.modules.some((module) =>
        /@varendo\/(agent|runtime)|\/dist\/(region|plot|visualization|studio|presentation)\//.test(module),
      ),
      `${item.entry} pulled a planner,
  runtime,
  chart or agent`,
    );
    for (const module of item.modules.filter((module) => module.includes('@varendo/')))
      assert(
        module.startsWith(consumerReal + '/node_modules/'),
        `Direct bundle resolved outside the installed consumer: ${module}`,
      );
    if (item.excludeLit && item.entry === 'metric')
      assert(item.gzipBytes <= 15 * 1024, 'Metric exceeds the standalone 15 KiB gzip budget');
    if (item.excludeLit && item.entry === 'table')
      assert(item.gzipBytes <= 40 * 1024, 'Table exceeds the standalone 40 KiB gzip budget');
  }
  await writeFile(join(runDirectory, 'bundle-measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  return measurements.map(({ modules, ...item }) => item);
}

const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();
assert.match(process.version, /^v24\./, `Node 24 is required; received ${process.version}`);
const before = sourceDigest();
const packageNames = ['core', 'runtime', 'web', 'react'];
const artifacts = [];
for (const name of packageNames) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.notEqual(manifest.private, true);
  await clearCompiledOutput(join(directory, 'dist'));
  run(['pnpm', 'build'], directory);
  const tarball = join(runDirectory, `varendo-${name}-${RELEASE_VERSION}.tgz`);
  run(['pnpm', 'pack', '--out', tarball], directory);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.deepEqual(packed.exports, manifest.exports, `${name} exports changed while packing`);
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.license, 'Apache-2.0');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(
      !JSON.stringify(packed[field] ?? {}).includes('workspace:'),
      `${name} has a workspace dependency in ${field}`,
    );
  }
  const entries = run(['tar', '-tzf', tarball], root).trim().split('\n');
  assert(entries.includes('package/LICENSE'), `${name} tarball has no license`);
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${name} tarball leaked source files`);
  assert(!entries.some((entry) => entry.startsWith('package/node_modules/')), `${name} tarball contains dependencies`);
  for (const entry of entries)
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive path: ${entry}`);
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

await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
run(
  [
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    ...artifacts.map((item) => item.path),
    'react@19.2.8',
    'react-dom@19.2.8',
    '@types/react@19.2.18',
    '@types/react-dom@19.2.7',
    'typescript@7.0.2',
    'vite@8.2.2',
    '@playwright/test@1.63.0',
    '@types/node@24.13.3',
  ],
  consumer,
);
const lockBytes = await readFile(join(consumer, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const [name, version] of Object.entries({
  react: '19.2.8',
  'react-dom': '19.2.8',
  typescript: '7.0.2',
  vite: '8.2.2',
  '@playwright/test': '1.63.0',
})) {
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
  assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
}
for (const artifact of artifacts) {
  const location = `node_modules/${artifact.name}`;
  assert.equal(lock.packages[location].version, artifact.version);
  assert.equal(lock.packages[location].integrity, artifact.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate ${artifact.name}`,
  );
  for (const entry of artifact.entries) {
    if (entry.endsWith('/')) continue;
    const installed = join(consumer, location, entry.slice('package/'.length));
    const stat = await lstat(installed);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Installed ${artifact.name} entry is not a regular file: ${entry}`);
    assert.equal(
      hash(await readFile(installed)),
      hash(run(['tar', '-xOf', artifact.path, entry], root, null)),
      `Installed ${artifact.name} bytes differ for ${entry}`,
    );
  }
}
assert.equal(lock.packages['node_modules/@varendo/web'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react'].dependencies['@varendo/web'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react'].peerDependencies['@varendo/runtime'], RELEASE_VERSION);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/web/node_modules/')),
  [],
);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/react/node_modules/')),
  [],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const webSubpaths = [
  'data',
  'metric',
  'delta',
  'key-value',
  'detail',
  'record-list',
  'card-collection',
  'selection-summary',
  'filter-builder',
  'table',
  'register',
  'region',
  'server',
];
const webSpecifiers = ['@varendo/web', ...webSubpaths.map((path) => `@varendo/web/${path}`)];
const reactSpecifiers = ['@varendo/react', '@varendo/react/data'];
const resolutionEntry = join(consumer, 'resolve-data.mjs');
await writeFile(
  resolutionEntry,
  `
import {fileURLToPath} from 'node:url';
import {realpath} from 'node:fs/promises';
const specs = ${JSON.stringify([...webSpecifiers, ...reactSpecifiers])};
const resolved = {};
for (const spec of specs) {
  const url = await import.meta.resolve(spec);
  const path = await realpath(fileURLToPath(url));
  if (!path.startsWith(${JSON.stringify(
    join(consumerReal, 'node_modules'),
  )} + '/')) throw new Error(spec + ' escaped installed node_modules: ' + path);
  await import(spec);
  resolved[spec] = path;
}
console.log(JSON.stringify(resolved));
`,
);
const resolved = JSON.parse(run(['node', resolutionEntry], consumer).trim().split('\n').at(-1));
for (const spec of [...webSpecifiers, ...reactSpecifiers])
  assert(
    resolved[spec].startsWith(join(consumerReal, 'node_modules') + '/'),
    `${spec} did not resolve from the temp consumer`,
  );

await writeFile(
  join(consumer, 'consumer.tsx'),
  `
import React from 'react';
import {createVarendoPresentationRegistry} from '@varendo/web/region';
import type {VarendoDataBinding,
  VarendoPresentationRegistryOptions} from '@varendo/web/region';
import type {Result,
  ResultRef,
} from '@varendo/core';
import {
  VarendoMetric,
  VarendoDelta,
  VarendoKeyValue,
  VarendoDetail,
  VarendoRecordList,
  VarendoCardCollection,
  VarendoSelectionSummary,
  VarendoFilterBuilder,
  VarendoTable} from '@varendo/react/data';
import {VarendoMetricElement} from '@varendo/web/metric';
import {VarendoDeltaElement,
  calculateVarendoDelta} from '@varendo/web/delta';
import {VarendoKeyValueElement} from '@varendo/web/key-value';
import {VarendoDetailElement} from '@varendo/web/detail';
import {VarendoRecordListElement} from '@varendo/web/record-list';
import {VarendoCardCollectionElement} from '@varendo/web/card-collection';
import {VarendoSelectionSummaryElement} from '@varendo/web/selection-summary';
import {VarendoFilterBuilderElement} from '@varendo/web/filter-builder';
import {VarendoTableElement,
  VARENDO_TABLE_MAX_VIRTUAL_ROWS} from '@varendo/web/data';
import type {VarendoDataScope,
  VarendoFilterChangeDetail,
  VarendoTableRow,
  VarendoTableWindowDetail} from '@varendo/web/data';

const rows = [
  {id: 'a',
  name: 'Ada',
  amount: {decimal: '100000000000000000.01'}},
  {id: 'b',
  name: 'Lin',
  amount: {decimal: '2.50'}},
  ] as const satisfies readonly VarendoTableRow[];
const semanticRef = {id: 'semantic-result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1'} as const satisfies ResultRef;
const semanticResult: Result = {
  version: '1',
  ref: semanticRef,
  taskId: 'consumer-task',
  fields: [
    {id: 'id',
  label: 'ID',
  type: {value: 'text',
  nullable: false},
  role: 'identity'},
  {id: 'amount',
  label: 'Amount',
  type: {value: 'decimal',
  nullable: false,
  unit: {dimension: 'currency',
  symbol: 'USD'}},
  role: 'measure'},
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: {loaded: 1,
  population: {kind: 'exact',
  value: 1,
  populationDigest: 'population-1'}},
  precision: {kind: 'exact'},
  coverage: {kind: 'complete',
  populationDigest: 'population-1'},
  consistency: {kind: 'snapshot',
  snapshotId: 'snapshot-1',
  sourceRevisions: {source: '1'}},
  evidence: {kind: 'observed',
  source: {id: 'source',
  revision: '1'}},
  filters: [],
  warnings: [],
  lineage: [],
  };
const semanticBinding: VarendoDataBinding = {result: semanticResult,
  rows: [{id: 'a',
  amount: {decimal: '12.50'}}]};
const semanticOptions = {data: [semanticBinding],
  resolveEntity: (value: Result) => value.ref.outputId === 'people' ? 'person' : undefined} satisfies VarendoPresentationRegistryOptions;
const semanticRegistry = createVarendoPresentationRegistry(semanticOptions);
if (!semanticRegistry.ok) throw new Error(semanticRegistry.diagnostics[0]?.message ?? 'semantic registry failed');
void semanticRegistry.value;
const columns = [{key: 'id',
  label: 'ID'},
  {key: 'name',
  label: 'Name'},
  {key: 'amount',
  label: 'Amount'}] as const;
const scope: VarendoDataScope = {loaded: 2,
  filteredTotal: 2,
  kind: 'filtered'};
const delta = calculateVarendoDelta({decimal: '0.0001'},
  {decimal: '0'},
  'percentage-point');
if (delta.status !== 'ready') throw new Error('delta unexpectedly unavailable');
const dataElements: readonly [typeof VarendoMetricElement,
  typeof VarendoDeltaElement,
  typeof VarendoKeyValueElement,
  typeof VarendoDetailElement,
  typeof VarendoRecordListElement,
  typeof VarendoCardCollectionElement,
  typeof VarendoSelectionSummaryElement,
  typeof VarendoFilterBuilderElement,
  typeof VarendoTableElement] = [VarendoMetricElement,
  VarendoDeltaElement,
  VarendoKeyValueElement,
  VarendoDetailElement,
  VarendoRecordListElement,
  VarendoCardCollectionElement,
  VarendoSelectionSummaryElement,
  VarendoFilterBuilderElement,
  VarendoTableElement];
void dataElements;
const handleWindow = (event: CustomEvent<VarendoTableWindowDetail>) => { const start: number = event.detail.start; const reason: 'keyboard' = event.detail.reason; void [start,
  reason]; };
const handleFilter = (event: CustomEvent<VarendoFilterChangeDetail>) => { const applied: true = event.detail.applied; void applied; };
const app = <>
  <VarendoMetric label='Revenue' value={rows[0].amount} unit='USD' scope={scope} />
  <VarendoDelta label='Rate' current={{decimal: '0.0001'}} baseline={{decimal: '0'}} mode='percentage-point' />
  <VarendoKeyValue items={[{key: 'owner',
  label: 'Owner',
  value: 'Ada'}]} />
  <VarendoDetail fields={columns} identity={['id']} record={rows[0]} />
  <VarendoRecordList columns={columns} rows={rows} identity={['id']} onSelectionChange={event => { const keys: readonly string[] = event.detail.keys; void keys; }} onLoadMore={() => undefined} />
  <VarendoCardCollection columns={columns} rows={rows} identity={['id']} onSelectionChange={event => { const mode: 'clear' | 'ids' = event.detail.mode; void mode; }} onLoadMore={() => undefined} />
  <VarendoSelectionSummary entity='person' selectedKeys={['string:1:a']} onClear={event => { const mode: 'clear' | 'ids' = event.detail.mode; void mode; }} />
  <VarendoFilterBuilder fields={[{id: 'name',
  label: 'Name',
  type: 'text'}]} onFilterChange={handleFilter} />
  <VarendoTable columns={columns} rows={rows} identity={['id']} mode='grid' virtualized virtualCount={1} overscan={0} onSelectionChange={event => { const mode: 'clear' | 'ids' = event.detail.mode; void mode; }} onSortChange={event => { const field: string | undefined = event.detail.sort?.field; void field; }} onPageChange={event => { const page: number = event.detail.page; void page; }} onWindowChange={handleWindow} />
</>;
void app;
const element = new VarendoTableElement(); element.columns = columns; element.rows = rows; element.identity = ['id']; element.virtualized = true; element.virtualCount = VARENDO_TABLE_MAX_VIRTUAL_ROWS;
void element;
`,
);
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        jsx: 'react-jsx',
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        noEmit: true,
        types: ['react', 'node'],
      },
      files: ['consumer.tsx'],
    },
    null,
    2,
  ) + '\n',
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);

await writeFile(
  join(consumer, 'ssr.mjs'),
  `
import assert from 'node:assert/strict';
import '@varendo/react/ssr';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {html} from 'lit';
import {renderVarendo} from '@varendo/web/server';
import {createVarendoPresentationRegistry} from '@varendo/web/region';
import { validatePresentationPlan } from '@varendo/core/presentation';
import {VarendoMetricElement, VarendoDeltaElement, VarendoKeyValueElement, VarendoDetailElement, VarendoRecordListElement, VarendoCardCollectionElement, VarendoSelectionSummaryElement, VarendoFilterBuilderElement, VarendoTableElement} from '@varendo/web/data';
import {VarendoTable, VarendoDelta} from '@varendo/react/data';
assert.equal(typeof globalThis.window, 'undefined');
assert.equal(typeof globalThis.document, 'undefined');
const definitions = [['varendo-metric', VarendoMetricElement], ['varendo-delta', VarendoDeltaElement], ['varendo-key-value', VarendoKeyValueElement], ['varendo-detail', VarendoDetailElement], ['varendo-record-list', VarendoRecordListElement], ['varendo-card-collection', VarendoCardCollectionElement], ['varendo-selection-summary', VarendoSelectionSummaryElement], ['varendo-filter-builder', VarendoFilterBuilderElement], ['varendo-table', VarendoTableElement]];
for (const [tag, constructor] of definitions) if (!customElements.get(tag)) customElements.define(tag, constructor);
const rows = [{id: 'a', name: 'Ada', amount: {decimal: '100000000000000000.01'}}, {id: 'b', name: 'Lin', amount: {decimal: '2.50'}}];
const columns = [{key: 'id', label: 'ID'}, {key: 'name', label: 'Name'}, {key: 'amount', label: 'Amount'}];
const webMarkup = await renderVarendo(html\`<varendo-table caption="SSR people" .columns=\${columns} .rows=\${rows} .identity=\${['id']}></varendo-table><varendo-delta label="SSR delta" .current=\${{decimal: '0.0001'}} .baseline=\${{decimal: '0'}} mode="percentage-point"></varendo-delta>\`);
assert.match(webMarkup, /shadowrootmode="open"/);
assert.match(webMarkup, /100000000000000000\.01/);
assert(webMarkup.includes('+0.01 pp'));
const semanticRef = {id: 'semantic-result', revision: '1', outputId: 'people', queryDigest: 'query-1', scopeDigest: 'scope-1'};
const semanticResult = {
  version: '1', ref: semanticRef, taskId: 'consumer-task',
  fields: [
    {id: 'id', label: 'ID', type: {value: 'text', nullable: false}, role: 'identity'},
    {id: 'amount', label: 'Amount', type: {value: 'decimal', nullable: false, unit: {dimension: 'currency', symbol: 'USD'}}, role: 'measure'},
  ],
  identity: ['id'], rowGrain: ['id'],
  counts: {loaded: 1, population: {kind: 'exact', value: 1, populationDigest: 'population-1'}},
  precision: {kind: 'exact'}, coverage: {kind: 'complete', populationDigest: 'population-1'},
  consistency: {kind: 'snapshot', snapshotId: 'snapshot-1', sourceRevisions: {source: '1'}},
  evidence: {kind: 'observed', source: {id: 'source', revision: '1'}},
  filters: [], warnings: [], lineage: [],
};
const semanticBinding = {result: semanticResult, rows: [{id: 'a', amount: {decimal: '12.50'}}]};
const semanticRegistry = createVarendoPresentationRegistry({data: [semanticBinding], resolveEntity: () => 'person'});
assert.equal(semanticRegistry.ok, true);
if (!semanticRegistry.ok) throw new Error(semanticRegistry.diagnostics[0]?.message ?? 'semantic registry failed');
const semanticManifest = semanticRegistry.value.manifests.find(manifest => manifest.ref.id === 'data.metric');
assert(semanticManifest, 'public registry did not expose data.metric');
const semanticPlan = {
  id: 'consumer-semantic-plan', revision: '1', rootId: 'metric',
  preconditions: {scopeDigest: 'scope-1', policyRevision: 'policy-1', taskRevision: 'task-1', regionRevision: 'region-1', catalogRevision: 'catalog-1', experienceRevision: 'experience-1', functionRegistryDigest: 'functions-1', results: [semanticRef]},
  nodes: [{id: 'metric', role: 'metric', representation: semanticManifest.ref, result: semanticRef, config: {schema: semanticManifest.configSchema, values: {field: 'amount', identityValues: {id: 'a'}}}, children: []}],
  links: [], coverage: [{needId: 'read', nodeIds: ['metric'], operations: [{id: 'data.read', revision: '1'}]}], stateTransfer: [], diagnostics: [],
};
const semanticContext = {
  task: {version: '1', id: 'consumer-task', revision: 'task-1', catalogRevision: 'catalog-1', functionRegistryDigest: 'functions-1', regionId: 'region-1', goal: 'Present the authorized metric', needs: [{id: 'read', operation: {id: 'data.read', revision: '1'}, fields: ['amount'], outputId: 'people', required: true}], assumptions: [], kind: 'presentation', inputs: [semanticRef]},
  experience: {version: '1', id: 'consumer-experience', revision: 'experience-1', mode: 'adaptive', agentAllowed: false, allowedRepresentations: ['data.metric'], allowedPatterns: [], composition: {allowWithoutPreset: true, maxNodes: 4, maxExpansions: 4}, requiredOperations: [], tokenProfile: {id: 'tokens.default', revision: '1'}, extensionAllowlist: [], transitionPolicy: 'stable'},
  results: [semanticResult], current: semanticPlan.preconditions,
  environment: {inlineSize: {state: 'unknown'}, blockSize: {state: 'unknown'}, textScale: {state: 'unknown'}, pointer: 'unknown', hover: 'unknown', keyboard: 'unknown', locale: 'en-US', direction: 'ltr', reducedMotion: false, forcedColors: false},
  rendererCapabilities: [semanticManifest.ref],
};
const semanticChecked = validatePresentationPlan(semanticPlan, semanticContext, semanticRegistry.value);
assert.equal(semanticChecked.ok, true);
if (!semanticChecked.ok) throw new Error(semanticChecked.diagnostics[0]?.message ?? 'semantic plan failed');
const semanticMarkup = await renderVarendo(html\`<varendo-region .presentation=\${semanticChecked.value} .results=\${[{ref: semanticRef, rows: semanticBinding.rows}]}></varendo-region>\`);
assert(semanticMarkup.includes('<varendo-metric'));
assert(semanticMarkup.includes('12.50'));
assert(semanticMarkup.includes('shadowrootmode="open"'));
const reactMarkup = renderToString(createElement(VarendoTable, {caption: 'React SSR people', columns, rows, identity: ['id']}));
assert.match(reactMarkup, /varendo-table/);
assert.match(reactMarkup, /shadowrootmode="open"/);
assert.match(reactMarkup, /100000000000000000\.01/);
const reactDelta = renderToString(createElement(VarendoDelta, {label: 'React SSR delta', current: {decimal: '0.0001'}, baseline: {decimal: '0'}, mode: 'percentage-point'}));
assert(reactDelta.includes('+0.01 pp'));
const secondRequest = renderToString(createElement(VarendoDelta, {label: 'Second request', current: {decimal: '1'}, baseline: {decimal: '0'}, mode: 'absolute'}));
assert(!secondRequest.includes('SSR people'));
console.log(JSON.stringify({webBytes: webMarkup.length, reactBytes: reactMarkup.length + reactDelta.length + secondRequest.length}));
`,
);
const ssrOutput = run(['node', join(consumer, 'ssr.mjs')], consumer).trim();

await writeFile(
  join(consumer, 'browser-entry.ts'),
  `
import {VarendoTableElement, VarendoDeltaElement, VarendoFilterBuilderElement} from '@varendo/web/data';
const definitions = [['varendo-table', VarendoTableElement], ['varendo-delta', VarendoDeltaElement], ['varendo-filter-builder', VarendoFilterBuilderElement]];
for (const [tag, constructor] of definitions) if (!customElements.get(tag)) customElements.define(tag, constructor);
const fixture = document.querySelector('#fixture');
if (!fixture) throw new Error('data fixture root missing');
const rows = [
  {id: 'a', name: 'Ada', amount: {decimal: '100000000000000000.01'}},
  {id: 'b', name: 'Lin', amount: {decimal: '2.50'}},
  {id: 'c', name: 'Grace', amount: {decimal: '3.00'}},
];
const columns = [{key: 'id', label: 'ID'}, {key: 'name', label: 'Name'}, {key: 'amount', label: 'Amount'}];
const table = new VarendoTableElement(); table.id = 'table'; table.caption = 'People'; table.columns = columns; table.rows = rows; table.identity = ['id']; table.totalRows = 3; table.scope = {loaded: 3, filteredTotal: 3, kind: 'filtered'}; fixture.append(table);
const delta = new VarendoDeltaElement(); delta.id = 'delta'; delta.label = 'Change'; delta.current = {decimal: '0.0001'}; delta.baseline = {decimal: '0'}; delta.mode = 'percentage-point'; fixture.append(delta);
const filter = new VarendoFilterBuilderElement(); filter.id = 'filter'; filter.fields = [{id: 'name', label: 'Name', type: 'text'}]; fixture.append(filter);
const grid = new VarendoTableElement(); grid.id = 'grid'; grid.caption = 'Window'; grid.mode = 'grid'; grid.columns = columns; grid.rows = rows; grid.identity = ['id']; grid.virtualized = true; grid.virtualStart = 0; grid.virtualCount = 1; grid.overscan = 0; grid.totalRows = 3; grid.scope = {loaded: 3, filteredTotal: 3, kind: 'filtered'}; fixture.append(grid);
const windowRequests = []; const filterEvents = [];
grid.addEventListener('varendo-table-window', event => { const detail = event.detail; windowRequests.push({...detail}); grid.virtualStart = detail.start; });
filter.addEventListener('varendo-filter-change', event => filterEvents.push({...event.detail}));
const ready = Promise.all([table.updateComplete, delta.updateComplete, filter.updateComplete, grid.updateComplete]);
Object.assign(window, {dataFixture: {table, delta, filter, grid, windowRequests, filterEvents, ready}});
`,
);
await writeFile(
  join(consumer, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Installed Varendo data</title></head><body><main id="fixture"></main><script type="module" src="/browser-entry.js"></script></body></html>\n',
);
await writeFile(join(consumer, 'vite.config.mjs'), "export default {build: {outDir: 'dist'}};\n");
run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(consumer, 'dist', pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(join(consumer, 'dist') + '/')) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)] ??
        'application/octet-stream',
    );
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
let browser;
let browserVersion;
const browserReport = {};
const failures = [];
try {
  browser = await chromium.launch();
  browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', deviceScaleFactor: 1 });
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.dataFixture));
  await page.evaluate(() => window.dataFixture.ready);
  const exact = await page.evaluate(() => {
    const f = window.dataFixture;
    return {
      decimal: f.table.shadowRoot.querySelector('td:last-child')?.textContent?.trim(),
      delta: f.delta.shadowRoot.querySelector('[part=number]')?.textContent?.trim(),
      fieldTag: f.filter.shadowRoot.querySelector('[part=value]')?.tagName,
      applyType: f.filter.shadowRoot.querySelector('[part=apply]')?.getAttribute('type'),
    };
  });
  assert.equal(exact.decimal, '100000000000000000.01');
  assert.equal(exact.delta, '+0.01 pp');
  assert.equal(exact.fieldTag, 'INPUT');
  assert.equal(exact.applyType, 'submit');
  const filterResult = await page.evaluate(async () => {
    const f = window.dataFixture;
    const input = f.filter.shadowRoot.querySelector('[part=value]');
    input.value = 'Ada';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Ada' }));
    await f.filter.updateComplete;
    const beforeApply = f.filterEvents.length;
    f.filter.shadowRoot.querySelector('[part=apply]').click();
    await f.filter.updateComplete;
    return { beforeApply, event: f.filterEvents.at(-1) };
  });
  assert.equal(filterResult.beforeApply, 0, 'filter typing emitted before Apply');
  assert.deepEqual(filterResult.event.predicate, { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' });
  const firstCell = page.locator('#grid').locator("[role=gridcell][data-row-index='0'][data-col-index='0']");
  await firstCell.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(
    () =>
      window.dataFixture.windowRequests.length === 1 &&
      window.dataFixture.grid.shadowRoot.activeElement?.getAttribute('data-row-index') === '1',
  );
  const windowResult = await page.evaluate(() => ({
    request: window.dataFixture.windowRequests[0],
    row: window.dataFixture.grid.shadowRoot.activeElement?.getAttribute('data-row-index'),
    column: window.dataFixture.grid.shadowRoot.activeElement?.getAttribute('data-col-index'),
  }));
  assert.deepEqual(windowResult.request, { start: 1, count: 1, overscan: 0, row: 1, column: 0, reason: 'keyboard' });
  assert.deepEqual({ row: windowResult.row, column: windowResult.column }, { row: '1', column: '0' });
  browserReport.exact = exact;
  browserReport.filter = filterResult;
  browserReport.window = windowResult;
  browserReport.failures = failures;
  await page.screenshot({ path: join(runDirectory, 'installed-data.png'), fullPage: true });
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}

const directBundles = await measureDirectEntries();
assert.equal(sourceDigest(), before, 'Source changed during data tarball consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      scope:
        'Installed @varendo/core, @varendo/web data entry points and @varendo/react data wrappers from actual tarballs; strict TypeScript; Lit/React SSR; Chromium exact decimal and percentage-point rendering, host-controlled virtual-grid keyboard window echo/focus, and native filter Apply behavior.',
      artifacts: artifacts.map(({ bytes, entries, ...item }) => item),
      consumerDirectory: consumer,
      consumerLock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      resolution: resolved,
      ssr: ssrOutput,
      directBundles,
      screenshot: {
        path: join(runDirectory, 'installed-data.png'),
        sha256: hash(await readFile(join(runDirectory, 'installed-data.png'))),
      },
      browser: browserReport,
      environment: {
        node: process.version,
        npm: run(['npm', '--version'], consumer).trim(),
        pnpm: run(['pnpm', '--version'], root).trim(),
        typescript: '7.0.2',
        vite: '8.2.2',
        playwright: '1.63.0',
        chromium: browserVersion,
        os: platform(),
        release: release(),
        arch: arch(),
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
        deviceScaleFactor: 1,
      },
      passed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Evidence: ${join(runDirectory, 'report.json')}`);
