/**
 * Exercise the framework recipes from packed packages in a clean consumer.
 *
 * The consumer intentionally lives outside this workspace.  This keeps the
 * proof honest: no workspace aliases, source imports, or local package links
 * can make an integration recipe appear to work.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { stageAuthoredGuides, verifyAuthoredGuides } from './authored-guides.mjs';
import { RELEASE_VERSION } from '../../scripts/release/candidate-lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts', 'framework-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-framework-consumer-'));

function run(argv, cwd, encoding = 'utf8') {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();
const before = sourceDigest();

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function stagePackage(directory, manifest, name) {
  const stage = join(runDirectory, 'staged-packages', name);
  await mkdir(stage, { recursive: true });
  for (const path of manifest.files ?? []) {
    const source = path === 'README.md' ? join(root, 'docs/packages', `${name}.md`) : join(directory, path);
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

const packageNames = ['core', 'runtime', 'web', 'react'];
const artifacts = [];
for (const name of packageNames) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.notEqual(manifest.private, true);
  run(['pnpm', 'build'], directory);
  const tarball = join(runDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
  const stage = await stagePackage(directory, manifest, name);
  run(['pnpm', 'pack', '--out', tarball], stage);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.deepEqual(packed.exports, manifest.exports, `${name} exports changed while packing`);
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.license, manifest.license);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(!JSON.stringify(packed[field] ?? {}).includes('workspace:'), `${name} contains a workspace dependency`);
  }
  const entries = run(['tar', '-tzf', tarball], root).trim().split('\n');
  assert(entries.includes('package/LICENSE'), `${name} tarball has no license`);
  assert(entries.includes('package/README.md'), `${name} tarball has no README`);
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${name} tarball leaked source`);
  assert(!entries.some((entry) => entry.startsWith('package/node_modules/')), `${name} tarball contains node_modules`);
  for (const entry of entries)
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive path: ${entry}`);
  artifacts.push({
    name: packed.name,
    version: packed.version,
    path: tarball,
    bytes: bytes.length,
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
    ...artifacts.map((artifact) => artifact.path),
    'react@19.2.8',
    'react-dom@19.2.8',
    'vue@3.5.42',
    'zod@4.5.4',
    '@types/react@19.2.18',
    '@types/react-dom@19.2.7',
    '@types/node@24.13.3',
    'typescript@7.0.2',
    'vite@8.2.2',
    '@playwright/test@1.63.0',
  ],
  consumer,
);
const lockBytes = await readFile(join(consumer, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const [name, version] of Object.entries({
  react: '19.2.8',
  'react-dom': '19.2.8',
  vue: '3.5.42',
  typescript: '7.0.2',
  vite: '8.2.2',
})) {
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version);
}
for (const artifact of artifacts) {
  const location = `node_modules/${artifact.name}`;
  assert.equal(lock.packages[location]?.version, artifact.version);
  assert.equal(lock.packages[location]?.integrity, artifact.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate ${artifact.name}`,
  );
  for (const entry of artifact.entries) {
    if (entry.endsWith('/')) continue;
    const installed = await readFile(join(consumer, location, entry.slice('package/'.length)));
    const packed = run(['tar', '-xOf', artifact.path, entry], root, null);
    assert.equal(hash(installed), hash(packed), `Installed ${artifact.name} bytes differ for ${entry}`);
  }
}
assert.equal(lock.packages['node_modules/@varendo/runtime']?.dependencies?.['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/web']?.dependencies?.['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react']?.dependencies?.['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react']?.dependencies?.['@varendo/web'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react']?.peerDependencies?.['@varendo/runtime'], RELEASE_VERSION);
assert.deepEqual(
  Object.keys(lock.packages)
    .filter((key) => key.startsWith('node_modules/@varendo/'))
    .sort(),
  [
    'node_modules/@varendo/core',
    'node_modules/@varendo/react',
    'node_modules/@varendo/runtime',
    'node_modules/@varendo/web',
  ],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const quickstart = await readFile(join(root, 'docs/site/pages/quickstart.md'), 'utf8');
const quickstartDirectory = await mkdtemp(join(tmpdir(), 'aeliqo-quickstart-consumer-'));
const codeFence = String.fromCharCode(96).repeat(3);
const readme = await readFile(join(root, 'README.md'), 'utf8');
const readmeInstall = readme.match(
  new RegExp(`${codeFence}sh\\nnpm install --save-exact ([\\s\\S]*?)\\n${codeFence}`, 'u'),
);
assert(readmeInstall, 'README install command is missing');
for (const name of packageNames)
  assert(
    readmeInstall[1].includes(`@varendo/${name}@${RELEASE_VERSION}`),
    `README does not install @varendo/${name}@${RELEASE_VERSION} for its React example`,
  );
const readmeExample = readme.match(new RegExp(`${codeFence}tsx\\n([\\s\\S]*?)\\n${codeFence}`, 'u'));
assert(readmeExample, 'README React example is missing');

// The documented flow scaffolds a Vite react-ts app, installs the pinned SDK
// packages, then writes src/people.ts and one complete src/main.tsx. Rebuild that consumer
// honestly: extract the install command and the authored source blocks, then
// provide a minimal Vite scaffold with pinned dependencies; this does not execute create-vite.
const installMatch = quickstart.match(
  new RegExp(`${codeFence}bash\\nnpm install --save-exact ([^\\n]+)\\n${codeFence}`, 'u'),
);
assert(installMatch, 'Quickstart install command is missing');
const installSpecifiers = installMatch[1].trim().split(/\s+/u);
for (const name of packageNames)
  assert(
    installSpecifiers.includes(`@varendo/${name}@${RELEASE_VERSION}`),
    `Quickstart does not pin @varendo/${name}@${RELEASE_VERSION}`,
  );

const fencedBlocks = (language) =>
  [...quickstart.matchAll(new RegExp(`${codeFence}${language}\\n([\\s\\S]*?)\\n${codeFence}`, 'gu'))].map(
    (match) => match[1],
  );
const tsBlocks = fencedBlocks('ts');
const tsxBlocks = fencedBlocks('tsx');
const cssBlocks = fencedBlocks('css');
assert.equal(tsBlocks.length, 1, 'Quickstart must contain exactly one TypeScript data definition');
assert.equal(tsxBlocks.length, 1, 'Quickstart must contain one complete intent entry');
assert.equal(cssBlocks.length, 1, 'Quickstart must contain one complete host stylesheet');
assert.match(tsBlocks[0], /measures: \{ hires:/u, 'The quickstart data must declare the hires measure');

await mkdir(join(quickstartDirectory, 'src'), { recursive: true });
await writeFile(join(quickstartDirectory, 'src/people.ts'), `${tsBlocks[0]}\n`);
await writeFile(join(quickstartDirectory, 'src/main.tsx'), `${tsxBlocks[0]}\n`);
await writeFile(join(quickstartDirectory, 'src/people.css'), `${cssBlocks[0]}\n`);
await writeFile(join(quickstartDirectory, 'src/readme-example.tsx'), `${readmeExample[1]}\n`);
const quickstartSource = await readFile(join(quickstartDirectory, 'src/main.tsx'), 'utf8');
for (const kind of ['browse', 'analyze']) assert.match(quickstartSource, new RegExp(`kind: '${kind}'`, 'u'));
assert.doesNotMatch(quickstartSource, /factory|model|agent/u);

const quickstartManifest = {
  name: 'aeliqo-quickstart-consumer',
  private: true,
  type: 'module',
  dependencies: {
    react: '19.2.8',
    'react-dom': '19.2.8',
    zod: '4.5.4',
  },
  devDependencies: {
    '@types/node': '24.13.3',
    '@types/react': '19.2.18',
    '@types/react-dom': '19.2.7',
    typescript: '7.0.2',
    vite: '8.2.2',
  },
};
for (const artifact of artifacts) quickstartManifest.dependencies[artifact.name] = `file:${artifact.path}`;
await writeFile(join(quickstartDirectory, 'package.json'), `${JSON.stringify(quickstartManifest, null, 2)}\n`);
await writeFile(
  join(quickstartDirectory, 'index.html'),
  '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
);
await writeFile(
  join(quickstartDirectory, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        jsx: 'react-jsx',
        noEmit: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: ['node', 'react', 'vite/client'],
        verbatimModuleSyntax: true,
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
);
run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], quickstartDirectory);
const quickstartLock = JSON.parse(await readFile(join(quickstartDirectory, 'package-lock.json'), 'utf8'));
for (const artifact of artifacts) {
  const installed = quickstartLock.packages[`node_modules/${artifact.name}`];
  assert.equal(installed?.version, RELEASE_VERSION);
  assert.equal(installed.integrity, artifact.integrity);
}
for (const [name, version] of Object.entries({
  ...quickstartManifest.dependencies,
  ...quickstartManifest.devDependencies,
})) {
  if (name.startsWith('@varendo/')) continue;
  assert.equal(
    quickstartLock.packages[`node_modules/${name}`]?.version,
    version,
    `${name} was not independently installed`,
  );
}
run([join(quickstartDirectory, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], quickstartDirectory);

const wrappers = [
  'AeliqoButton',
  'AeliqoIconButton',
  'AeliqoLink',
  'AeliqoText',
  'AeliqoHeading',
  'AeliqoBadge',
  'AeliqoAvatar',
  'AeliqoSeparator',
  'AeliqoSurface',
  'AeliqoStack',
  'AeliqoGrid',
  'AeliqoSplitPane',
  'AeliqoScrollArea',
  'AeliqoTextField',
  'AeliqoTextArea',
  'AeliqoNumberField',
  'AeliqoCheckbox',
  'AeliqoRadioGroup',
  'AeliqoSwitch',
  'AeliqoSelect',
  'AeliqoCombobox',
  'AeliqoDateField',
  'AeliqoDateRange',
  'AeliqoSlider',
  'AeliqoSearchField',
  'AeliqoFileInput',
  'AeliqoFieldGroup',
  'AeliqoForm',
  'AeliqoTabs',
  'AeliqoBreadcrumb',
  'AeliqoPagination',
  'AeliqoMenu',
  'AeliqoTreeNav',
  'AeliqoTooltip',
  'AeliqoPopover',
  'AeliqoDialog',
  'AeliqoDrawer',
  'AeliqoToast',
  'AeliqoAlert',
  'AeliqoProgress',
  'AeliqoSkeleton',
  'AeliqoEmptyState',
  'AeliqoMetric',
  'AeliqoDelta',
  'AeliqoKeyValue',
  'AeliqoDetail',
  'AeliqoRecordList',
  'AeliqoCardCollection',
  'AeliqoTable',
  'AeliqoFilterBuilder',
  'AeliqoSelectionSummary',
  'AeliqoTrend',
  'AeliqoBar',
  'AeliqoArea',
  'AeliqoScatter',
  'AeliqoHistogram',
  'AeliqoHeatmap',
  'AeliqoMatrix',
  'AeliqoRelationship',
  'AeliqoTree',
  'AeliqoTreemap',
  'AeliqoTimeline',
  'AeliqoCalendarGrid',
  'AeliqoExplorer',
  'AeliqoComparison',
  'AeliqoBreakdown',
  'AeliqoInvestigation',
  'AeliqoSearchResults',
  'AeliqoRecordEditor',
  'AeliqoFormFlow',
  'AeliqoQualityPanel',
];
assert.equal(wrappers.length, 71);

const wrapperFamilies = ['foundation', 'inputs', 'navigation', 'feedback', 'data', 'plot', 'visualization', 'compound'];
const wrapperImports = wrapperFamilies
  .map((family) => `import * as ${family} from "@varendo/react/${family}";`)
  .join('\n');
const wrapperGroups = wrapperFamilies.join(', ');
await writeFile(
  join(consumer, 'framework-types.tsx'),
  `
${wrapperImports}
import type {AeliqoTableColumn, AeliqoTableRow} from "@varendo/web/data";
import type {AeliqoInputChangeDetail as InputChangeDetail} from "@varendo/web/inputs";
import {AeliqoTextField} from "@varendo/react/inputs";
import {AeliqoTable} from "@varendo/react/data";
import {defineReactViews} from "@varendo/react/surface";

const wrapperNames = ${JSON.stringify(wrappers)};
const groups: readonly Record<string, unknown>[] = [${wrapperGroups}];
for (const name of wrapperNames) {
  if (!groups.some((group) => typeof group[name] === "function")) throw new Error(name + " is not exported by its family");
}
const columns: readonly AeliqoTableColumn[] = [{key: "name", label: "Name"}];
const rows: readonly AeliqoTableRow[] = [{name: "Ada"}];
const detail: InputChangeDetail<string> = {value: "Ada", source: "user"};
const input = <AeliqoTextField label="Person" value={detail.value} onValueChange={(event) => { const value: string = event.detail.value; void value; }} />;
const table = <AeliqoTable caption="People" columns={columns} rows={rows} />;
const nativeViews = defineReactViews<{readonly kind: "browse"}, {readonly rows: readonly string[]}>([
  {id: "people.native", revision: "1", render: ({snapshot}) => <p>{snapshot.state.rows.length}</p>},
  {id: "people.lazy", revision: "1", load: async () => ({snapshot}) => <p>{snapshot.state.rows.length}</p>},
]);
void [input, table, nativeViews];
`,
);

await writeFile(
  join(consumer, 'framework-vanilla.ts'),
  `
import {registerAeliqoElements} from "@varendo/web";
import {AeliqoInputChangeEvent, type AeliqoTextFieldElement} from "@varendo/web/inputs";
import type {AeliqoTableElement} from "@varendo/web/data";
registerAeliqoElements();
const input = document.createElement("aeliqo-text-field") as AeliqoTextFieldElement;
const table = document.createElement("aeliqo-table") as AeliqoTableElement;
input.addEventListener("aeliqo-input-change", (event) => {
  if (!(event instanceof AeliqoInputChangeEvent)) throw new Error("Unexpected input event");
  const next: string = event.detail.value;
  input.value = next;
});
table.columns = [{key: "name", label: "Name"}];
table.rows = [{name: "Ada"}];
document.body.append(input, table);
`,
);

await writeFile(
  join(consumer, 'framework-vue.ts'),
  `
import {createApp, h, ref, type VNode} from "vue";
import {registerAeliqoElements} from "@varendo/web";
import {AeliqoInputChangeEvent} from "@varendo/web/inputs";
registerAeliqoElements();
const Fixture = {setup(): (() => VNode) { const value = ref("Vue"); return () => h("aeliqo-text-field", {
  label: "Vue person", value: value.value, "onAeliqo-input-change": (event: Event) => { if (event instanceof AeliqoInputChangeEvent) value.value = event.detail.value; },
}); }};
createApp(Fixture).mount(document.body);
`,
);

await writeFile(
  join(consumer, 'adaptive-app.ts'),
  `
import {defineResource} from "@varendo/core";
import {createQueryFunctionRegistry} from "@varendo/core/expressions";
import {createLocalDataService} from "@varendo/runtime/data";
import {createAeliqoApp, type AeliqoApp} from "@varendo/web/app";
import {z} from "zod";

const people = defineResource({
  id: "people", revision: "people-1", label: "People", identity: ["id"],
  schema: z.object({id: z.string(), name: z.string(), team: z.string()}),
  fields: {name: {label: "Name"}, team: {label: "Team", role: "dimension"}},
  presentation: {allowedViews: ["table", "cards"]},
});

export const browsePeople = Object.freeze({
  version: "1", id: "browse-people", kind: "browse", resource: "people", fields: ["name", "team"],
});

export function createPeopleApp(): AeliqoApp {
  const functions = createQueryFunctionRegistry({version: "2"});
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const data = createLocalDataService({
    snapshot: {catalog: people.catalog, sourceRevision: "people-data-1", records: {people: [
      {id: "ada", name: "Ada Chen", team: "Design"},
      {id: "sam", name: "Sam Rivera", team: "Engineering"},
    ]}},
    functionRegistry: functions.value,
    sourceLimits: {rows: 100, bytes: 100_000},
    authorize: () => ({ok: true, value: {scopeDigest: "people-scope", policyRevision: "people-policy-1"}}),
  });
  return createAeliqoApp({
    resources: [{resource: people, data}],
    authority: {read: () => ({ok: true, value: {
      principalKey: "framework-user", scopeDigest: "people-scope", policyRevision: "people-policy-1",
      experienceRevision: "framework-web-1", grants: ["task.evaluate", "result.inspect", "experience.commit"],
      readContext: {principal: "framework-user"},
    }})},
  });
}
`,
);

const catalogQuickstart = `
import {createStandardFunctionRegistry} from "@varendo/core/expressions";
import {parseCatalog, type Catalog} from "@varendo/core";
import {createMeaningAuthoring} from "@varendo/runtime/meaning";
const registry = createStandardFunctionRegistry("framework-meaning-consumer");
if (!registry.ok) throw new Error("function registry");
const catalog = {version: "1", revision: "framework-catalog", functionRegistryDigest: registry.value.digest,
  entities: [{id: "orders", label: "Orders", identity: ["id"], rowGrain: ["id"], fields: [
    {id: "id", label: "ID", role: "identity", type: {value: "text", nullable: false}},
    {id: "amount", label: "Amount", role: "measure", type: {value: "integer", nullable: false}},
  ]}], relationships: [], meanings: [], capabilities: []} as const satisfies Catalog;
const authoring = createMeaningAuthoring({catalog, registry: registry.value});
if (!authoring.ok) throw new Error("authoring");
const amount = authoring.value.field("orders", "amount");
if (!amount.ok) throw new Error("amount field");
// @ts-expect-error The reused Catalog rejects a field that is absent from orders.
authoring.value.field("orders", "missing");
const total = authoring.value.call({id: "core.aggregate.sum", revision: "1"}, [amount]);
if (!total.ok) throw new Error("typed aggregate");
const meaning = authoring.value.defineMeaning({id: "orders.total", label: "Order total", description: "Sum of order amounts", expression: total.value});
if (!meaning.ok) throw new Error("meaning");
void meaning.value;
const loaded = parseCatalog(catalog);
if (!loaded.ok) throw new Error("loaded catalog");
const dynamic = createMeaningAuthoring({catalog: loaded.value, registry: registry.value});
if (!dynamic.ok) throw new Error("dynamic authoring");
dynamic.value.field("orders", "amount");
`;
await writeFile(join(consumer, 'meaning-quickstart.ts'), catalogQuickstart);
assert(
  !/@varendo\/(agent|studio)|model|chart|layout/i.test(catalogQuickstart),
  'Manual meaning path coupled to model, Studio, chart, or layout',
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
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        jsx: 'react-jsx',
        noEmit: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: ['node', 'react'],
      },
      files: [
        'framework-types.tsx',
        'framework-vanilla.ts',
        'framework-vue.ts',
        'meaning-quickstart.ts',
        'adaptive-app.ts',
      ],
    },
    null,
    2,
  ) + '\n',
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);

await writeFile(
  join(consumer, 'ssr.mjs'),
  `
import assert from "node:assert/strict";
import "@varendo/react/ssr";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import {AeliqoTextField} from "@varendo/react/inputs";
import {AeliqoTable} from "@varendo/react/data";
import {defineReactViews} from "@varendo/react/surface";
assert.equal(typeof globalThis.window, "undefined");
const input = renderToString(createElement(AeliqoTextField, {label: "SSR person", value: "Ada"}));
const table = renderToString(createElement(AeliqoTable, {caption: "SSR people", columns: [{key: "name", label: "Name"}], rows: [{name: "Ada"}]}));
assert.match(input, /aeliqo-text-field/); assert.match(input, /SSR person/); assert.match(input, /shadowrootmode="open"/);
assert.match(table, /aeliqo-table/); assert.match(table, /SSR people/); assert.match(table, /Ada/);
const nativeViews = defineReactViews([{id: "people.native", revision: "1", render: () => null}]);
assert.equal(nativeViews.resolve({id: "people.native", revision: "1"})?.ref.id, "people.native");
const lazyViews = defineReactViews([{id: "people.lazy", revision: "1", load: async () => () => null}]);
assert.equal(typeof lazyViews.resolve({id: "people.lazy", revision: "1"})?.load, "function");
assert.throws(() => defineReactViews([{id: "people.native", revision: "1", render: () => null}, {id: "people.native", revision: "1", render: () => null}]));
console.log(JSON.stringify({input: input.length, table: table.length, hasDeclarativeShadow: input.includes("shadowrootmode=\\\"open\\\"")}));
`,
);
const ssr = run(['node', 'ssr.mjs'], consumer).trim();
const ssrReport = JSON.parse(ssr.split('\n').at(-1));
assert.equal(ssrReport.hasDeclarativeShadow, true);

await writeFile(
  join(consumer, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Installed framework consumer</title><style>body{font-family:system-ui;margin:1rem}.framework-grid{display:grid;gap:1rem}.adaptive-region{container-type:inline-size;min-height:12rem}.adaptive-narrow{width:360px;max-width:100%}</style></head><body>
<div class="framework-grid"><main id="vanilla"><h1>Vanilla</h1><p id="vanilla-status" role="status">Ready</p><aeliqo-text-field id="vanilla-input" label="Vanilla person" value="Vanilla"></aeliqo-text-field><aeliqo-table id="vanilla-table"></aeliqo-table><p id="vanilla-app-status" role="status">Mounting</p><div id="vanilla-region" class="adaptive-region"></div></main>
<main id="react-root" class="adaptive-narrow"><h1>React</h1></main><main id="vue-root"><h1>Vue</h1></main></div><script type="module" src="/framework-app.tsx"></script></body></html>`,
);
await writeFile(
  join(consumer, 'framework-app.tsx'),
  `
import {registerAeliqoElements} from "@varendo/web";
import {AeliqoInputChangeEvent} from "@varendo/web/inputs";
import type {AeliqoTableElement} from "@varendo/web/data";
import {createRoot} from "react-dom/client";
import React, {useState} from "react";
import {AeliqoTextField} from "@varendo/react/inputs";
import {AeliqoTable} from "@varendo/react/data";
import {registerAeliqoReactElements} from "@varendo/react";
import {AeliqoProvider, AeliqoRegion} from "@varendo/react/app";
import {createApp, h, ref, type VNode} from "vue";
import {browsePeople, createPeopleApp} from "./adaptive-app.js";
registerAeliqoElements(); registerAeliqoReactElements();
const vanillaInput = document.querySelector("#vanilla-input");
const vanillaTable = document.querySelector<AeliqoTableElement>("#vanilla-table");
const vanillaStatus = document.querySelector("#vanilla-status");
const vanillaRegion = document.querySelector<HTMLElement>("#vanilla-region");
const vanillaAppStatus = document.querySelector("#vanilla-app-status");
if (!(vanillaInput instanceof HTMLElement) || !vanillaTable || !vanillaStatus || !vanillaRegion || !vanillaAppStatus) throw new Error("Vanilla shell is incomplete");
vanillaTable.caption = "Vanilla people"; vanillaTable.columns = [{key: "name", label: "Name"}]; vanillaTable.rows = [{name: "Ada"}];
vanillaInput.addEventListener("aeliqo-input-change", (event) => { if (event instanceof AeliqoInputChangeEvent) { vanillaInput.value = event.detail.value; vanillaStatus.textContent = event.detail.value; } });
const vanillaApp = createPeopleApp();
const vanillaMounted = vanillaApp.mount({target: vanillaRegion, regionId: "vanilla-people", resourceId: "people"});
if (!vanillaMounted.ok) throw new Error(vanillaMounted.diagnostics[0].message);
vanillaAppStatus.textContent = (await vanillaApp.render({regionId: "vanilla-people", intent: browsePeople})).status;

const reactApp = createPeopleApp();
function ReactFixture(): React.JSX.Element { const [value, setValue] = useState("React"); return <AeliqoProvider app={reactApp}><p id="react-status" role="status">{value}</p><AeliqoTextField id="react-input" label="React person" value={value} onValueChange={(event) => setValue(event.detail.value)} /><AeliqoTable caption="React people" columns={[{key: "name", label: "Name"}]} rows={[{name: "Ada"}]} /><p id="react-app-status" role="status">Mounting</p><AeliqoRegion className="adaptive-region" regionId="react-people" resourceId="people" intent={browsePeople} onReceipt={(receipt) => { const status = document.querySelector("#react-app-status"); if (status) status.textContent = receipt.status; }} /></AeliqoProvider>; }
createRoot(document.querySelector("#react-root")!).render(<ReactFixture />);
const VueFixture = {setup(): (() => VNode) { const value = ref("Vue"); return () => h("section", [h("p", {id: "vue-status", role: "status"}, value.value), h("aeliqo-text-field", {id: "vue-input", label: "Vue person", value: value.value, "onAeliqo-input-change": (event: Event) => { if (event instanceof AeliqoInputChangeEvent) value.value = event.detail.value; }}), h("aeliqo-table", {caption: "Vue people", columns: [{key: "name", label: "Name"}], rows: [{name: "Ada"}]}), h("p", {id: "vue-app-status", role: "status"}, "Mounting"), h("div", {id: "vue-region", class: "adaptive-region"})]); }};
createApp(VueFixture).mount(document.querySelector("#vue-root")!);
const vueRegion = document.querySelector<HTMLElement>("#vue-region");
const vueAppStatus = document.querySelector("#vue-app-status");
if (!vueRegion || !vueAppStatus) throw new Error("Vue Region shell is incomplete");
const vueApp = createPeopleApp();
const vueMounted = vueApp.mount({target: vueRegion, regionId: "vue-people", resourceId: "people"});
if (!vueMounted.ok) throw new Error(vueMounted.diagnostics[0].message);
vueAppStatus.textContent = (await vueApp.render({regionId: "vue-people", intent: browsePeople})).status;
window.addEventListener("pagehide", () => { vanillaApp.dispose(); reactApp.dispose(); vueApp.dispose(); }, {once: true});
`,
);
const guideEntries = await stageAuthoredGuides(root, consumer, run);
await writeFile(
  join(consumer, 'vite.config.mjs'),
  `export default {build: {target: 'es2022',rolldownOptions:{input:${JSON.stringify(['index.html', ...guideEntries])}}}};\n`,
);
run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
assert(await fileExists(join(consumer, 'dist', 'index.html')), 'Consumer build has no index.html');
run([join(quickstartDirectory, 'node_modules/.bin/vite'), 'build', '--base', '/quickstart/'], quickstartDirectory);
await cp(join(quickstartDirectory, 'dist'), join(consumer, 'dist', 'quickstart'), { recursive: true });
assert(await fileExists(join(consumer, 'dist', 'quickstart', 'index.html')), 'Quickstart build has no index.html');

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(consumer, 'dist', pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(join(consumer, 'dist') + '/')) throw new Error('invalid path');
    response.setHeader(
      'content-type',
      { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ??
        'application/octet-stream',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
let browser;
let browserVersion;
const browserErrors = [];
try {
  browser = await chromium.launch();
  browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#vanilla-input').waitFor();
  await page.locator('#react-input').waitFor();
  await page.locator('#vue-input').waitFor();
  await page.waitForFunction(() =>
    ['vanilla', 'react', 'vue'].every(
      (framework) => document.querySelector(`#${framework}-app-status`)?.textContent === 'renderer-ready',
    ),
  );
  assert.equal(await page.locator('#vanilla-table').locator('table').count(), 1);
  assert.equal(await page.locator('#react-root aeliqo-table').locator('table').count(), 1);
  assert.equal(await page.locator('#vue-root > section > aeliqo-table').locator('table').count(), 1);
  assert.equal(await page.locator('#vanilla-region aeliqo-table').count(), 1);
  assert.equal(await page.locator('#react-root [data-varendo-react-region] aeliqo-card-collection').count(), 1);
  assert.equal(await page.locator('#vue-region aeliqo-table').count(), 1);
  assert.match(await page.locator('#vanilla-region aeliqo-table table').textContent(), /Ada Chen/);
  assert.match(
    await page
      .locator('#react-root [data-varendo-react-region] aeliqo-card-collection [part=card]')
      .first()
      .textContent(),
    /Ada Chen/,
  );
  assert.match(await page.locator('#vue-region aeliqo-table table').textContent(), /Ada Chen/);
  await page.locator('#vanilla-input').locator('input').fill('Lin');
  await page.locator('#react-input').locator('input').fill('Mina');
  await page.locator('#vue-input').locator('input').fill('Noor');
  await page.waitForFunction(() => document.querySelector('#vanilla-status')?.textContent === 'Lin');
  await page.waitForFunction(() => document.querySelector('#react-status')?.textContent === 'Mina');
  await page.waitForFunction(() => document.querySelector('#vue-status')?.textContent === 'Noor');
  assert.equal(await page.locator('#vanilla-input').locator('input').inputValue(), 'Lin');
  assert.equal(await page.locator('#react-input').locator('input').inputValue(), 'Mina');
  assert.equal(await page.locator('#vue-input').locator('input').inputValue(), 'Noor');
  assert.deepEqual(browserErrors, []);
  await page.screenshot({ path: join(runDirectory, 'framework-consumer.png'), fullPage: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const externalRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  await page.goto(`${origin}/quickstart/index.html`);
  const minimal = page.locator('#root main');
  const region = minimal.locator('aeliqo-region');
  const shows = (text) => region.getByText(text, { exact: true }).first().waitFor({ timeout: 15_000 });
  const ask = async (name) => {
    await minimal.getByRole('button', { name, exact: true }).click();
    assert.equal(await minimal.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
  };
  await shows('Ada Chen');
  await shows('Sam Rivera');
  await ask('Engineering only');
  await shows('Jo Patel');
  await expect(region.getByText('Ada Chen', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await ask('Hires per month');
  await region.locator('svg').first().waitFor({ timeout: 15_000 });
  await region.getByText('New hires', { exact: true }).first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(runDirectory, 'quickstart-hires-per-month.png'), fullPage: true });
  await ask('Hires per team');
  await shows('Product');
  await region.locator('svg').first().waitFor({ timeout: 15_000 });
  await shows('New hires by Team');
  await expect
    .poll(async () => {
      const chart = await region.locator('aeliqo-bar svg').first().boundingBox();
      const host = await region.boundingBox();
      return chart !== null && host !== null && chart.width >= host.width - 40;
    })
    .toBe(true);
  await page.screenshot({ path: join(runDirectory, 'quickstart-hires-per-team.png'), fullPage: true });
  await ask('Everyone');
  await shows('Ada Chen');
  for (const button of await minimal.getByRole('button').all()) {
    const box = await button.boundingBox();
    assert(box && box.height >= 44, 'Quickstart question targets must be at least 44px tall');
  }
  await minimal.getByRole('button', { name: 'Everyone', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Engineering only');
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), '3px');
  assert.deepEqual(externalRequests, [], 'Quickstart app made a remote request');
  assert.deepEqual(browserErrors, [], 'Quickstart app raised a browser error');
  await page.screenshot({ path: join(runDirectory, 'quickstart-local-react.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await shows('Ada Chen');
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Quickstart overflows at 320px',
  );
  await page.screenshot({ path: join(runDirectory, 'quickstart-local-react-narrow.png'), fullPage: true });
  await verifyAuthoredGuides(page, origin, runDirectory);
  assert.deepEqual(browserErrors, [], 'Authored framework guide raised a browser error');
} finally {
  await browser?.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}

assert.equal(sourceDigest(), before, 'Source changed during framework consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      passed: true,
      scope:
        'Installed core/runtime/web/react tarballs; Authored React quickstart in a minimal Vite consumer with pinned dependencies answers browse, filtered browse, monthly trend, and per-team analyze intents from one resource without a remote request; all 71 React wrapper exports; one adaptive app facade rendered through Vanilla, React, and Vue hosts; React declarative Shadow DOM SSR; property/event behavior in Chromium; manual schema-reuse meaning path without model, Studio, chart, or layout imports.',
      artifacts: artifacts.map(({ entries, ...artifact }) => ({ ...artifact, entries })),
      consumerDirectory: consumer,
      quickstartConsumerDirectory: quickstartDirectory,
      lock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      ssr: ssrReport,
      browser: {
        version: browserVersion,
        errors: browserErrors,
        screenshot: join(runDirectory, 'framework-consumer.png'),
        quickstartScreenshot: join(runDirectory, 'quickstart-local-react.png'),
      },
      environment: {
        node: process.version,
        npm: run(['npm', '--version'], consumer).trim(),
        typescript: '7.0.2',
        vite: '8.2.2',
        chromium: browserVersion,
        os: platform(),
        release: release(),
        arch: arch(),
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`Installed framework consumer proof passed. Evidence: ${join(runDirectory, 'report.json')}`);
