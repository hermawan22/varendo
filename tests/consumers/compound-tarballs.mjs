import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/** Actual installed compound web/React consumer proof outside the workspace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/compound-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-compound-consumer-'));
const consumerReal = await realpath(consumer);

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
for (const [name, version] of [
  ['core', RELEASE_VERSION],
  ['runtime', RELEASE_VERSION],
  ['web', RELEASE_VERSION],
  ['react', RELEASE_VERSION],
]) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, version);
  assert.notEqual(manifest.private, true);
  run(['pnpm', 'build'], directory);
}

const packages = [];
for (const name of ['core', 'runtime', 'web', 'react']) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const tarball = join(runDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
  run(['pnpm', 'pack', '--out', tarball], directory);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.license, 'Apache-2.0');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(!JSON.stringify(packed[field] ?? {}).includes('workspace:'), `${name} has a workspace alias in ${field}`);
  }
  packages.push({
    name: packed.name,
    version: packed.version,
    path: tarball,
    bytes,
    sha256: hash(bytes),
    integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
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
    ...packages.map((item) => item.path),
    'typescript@7.0.2',
    'vite@8.2.2',
    '@playwright/test@1.63.0',
    '@types/node@24.13.3',
    'react@19.2.8',
    'react-dom@19.2.8',
    '@types/react@19.2.18',
    '@types/react-dom@19.2.7',
    'lit@3.3.3',
  ],
  consumer,
);
const lockBytes = await readFile(join(consumer, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const item of packages) {
  const location = `node_modules/${item.name}`;
  assert.equal(lock.packages[location].version, item.version);
  assert.equal(lock.packages[location].integrity, item.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate ${item.name}`,
  );
  const entries = run(['tar', '-tzf', item.path], root).trim().split('\n');
  for (const entry of entries) {
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive path ${entry}`);
    if (entry.endsWith('/')) continue;
    const installed = await readFile(join(consumer, location, entry.slice('package/'.length)));
    const packed = run(['tar', '-xOf', item.path, entry], root, null);
    assert.equal(hash(installed), hash(packed), `Installed ${item.name} bytes differ for ${entry}`);
  }
}
for (const [name, version] of Object.entries({
  typescript: '7.0.2',
  vite: '8.2.2',
  '@playwright/test': '1.63.0',
  '@types/node': '24.13.3',
})) {
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
  assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
}
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/web'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/react'].dependencies['@varendo/web'], RELEASE_VERSION);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/runtime/node_modules/')),
  [],
);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/web/node_modules/')),
  [],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const names = [
  'Explorer',
  'Comparison',
  'Breakdown',
  'Investigation',
  'SearchResults',
  'RecordEditor',
  'FormFlow',
  'QualityPanel',
];
const tags = [
  'explorer',
  'comparison',
  'breakdown',
  'investigation',
  'search-results',
  'record-editor',
  'form-flow',
  'quality-panel',
];
await writeFile(
  join(consumer, 'node.mjs'),
  `
import {html} from 'lit';import {renderAeliqo} from '@varendo/web/server';import * as bindings from '@varendo/react/compound';import '@varendo/react/ssr';import React from 'react';import {renderToString} from 'react-dom/server';
const output=await renderAeliqo(html\`<aeliqo-explorer></aeliqo-explorer><aeliqo-comparison></aeliqo-comparison><aeliqo-breakdown></aeliqo-breakdown><aeliqo-investigation></aeliqo-investigation><aeliqo-search-results></aeliqo-search-results><aeliqo-record-editor></aeliqo-record-editor><aeliqo-form-flow></aeliqo-form-flow><aeliqo-quality-panel></aeliqo-quality-panel>\`);
if((output.match(/shadowrootmode=/g)||[]).length<8)throw Error('Missing compound SSR');
for(const name of ${JSON.stringify(names)}){if(typeof bindings['Aeliqo'+name]!=='object'&&typeof bindings['Aeliqo'+name]!=='function')throw Error('Missing React binding');}
const react=renderToString(React.createElement(bindings.AeliqoRecordEditor,{entity:'person',entityKey:'a',entityRevision:'1'},React.createElement('input',{name:'name',defaultValue:'Ada'})));if(!react.includes('aeliqo-record-editor')||!react.includes('Ada'))throw Error('React SSR');console.log(JSON.stringify({webSsr:true,reactSsr:true,eightBindings:true}));
`,
);
const nodeReport = JSON.parse(run(['node', '--disallow-code-generation-from-strings', 'node.mjs'], consumer).trim());
await writeFile(
  join(consumer, 'consumer.tsx'),
  `
import React from 'react';import {AeliqoRecordEditor,AeliqoFormFlow,AeliqoComparison,AeliqoExplorer,AeliqoBreakdown,AeliqoInvestigation,AeliqoSearchResults,AeliqoQualityPanel} from '@varendo/react/compound';import type {AeliqoRecordEditorSaveDetail,AeliqoCompoundRecipeInput} from '@varendo/web/compound';import {explorerPresentationRecipe} from '@varendo/web/explorer';
const editor=<AeliqoRecordEditor entity="person" entityKey="a" entityRevision="1" onSave={event=>{const detail:AeliqoRecordEditorSaveDetail=event.detail;void detail;}}/>;
const flow=<AeliqoFormFlow steps={[{id:'a',label:'A'}]} draft={{values:['a','b']}} onCommit={event=>{void event.detail.draft;}}/>;
const compare=<AeliqoComparison metrics={[{id:'amount',label:'Amount',values:{a:{decimal:'9007199254740993.01'}}}]} compareKeys={['a']}/>;
const all=[<AeliqoExplorer/>,<AeliqoBreakdown/>,<AeliqoInvestigation/>,<AeliqoSearchResults/>,<AeliqoQualityPanel/>];void [editor,flow,compare,all];declare const input:AeliqoCompoundRecipeInput;explorerPresentationRecipe(input);
// @ts-expect-error Commit receipts require host revision identity.
const wrong:AeliqoRecordEditorSaveDetail={source:'user',entity:'person',key:'a',values:{}};void wrong;
`,
);
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      jsx: 'react-jsx',
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      noEmit: true,
      types: ['node', 'react', 'react-dom'],
    },
    include: ['consumer.tsx'],
  }),
);
run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
await writeFile(join(consumer, 'index.html'), '<div id="app"></div><script type="module" src="/browser.mjs"></script>');
await writeFile(
  join(consumer, 'browser.mjs'),
  `
import React from 'react';import {createRoot} from 'react-dom/client';import {registerAeliqoElements} from '@varendo/web';import * as wrappers from '@varendo/react/compound';registerAeliqoElements();window.receipts=[];
const components=${JSON.stringify(names)}.map(name=>React.createElement(wrappers['Aeliqo'+name],{key:name,...(name==='RecordEditor'?{entity:'person',entityKey:'a',entityRevision:'1',onSave:event=>window.receipts.push(event.detail)}:{})},name==='RecordEditor'?React.createElement('input',{name:'name',defaultValue:'Ada',required:true,'aria-label':'Name'}):undefined));
createRoot(document.querySelector('#app')).render(React.createElement(React.Fragment,null,...components));
`,
);
await writeFile(join(consumer, 'vite.config.mjs'), `export default {build:{target:'es2022'}};`);
run(['node', 'node_modules/vite/bin/vite.js', 'build'], consumer);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(consumer, 'dist', pathname === '/' ? 'index.html' : '.' + pathname);
    if (!path.startsWith(join(consumer, 'dist') + '/')) throw Error('path');
    response.setHeader('content-type', extname(path) === '.js' ? 'text/javascript' : 'text/html');
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, chromiumVersion, browserReport;
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(
    (tags) => tags.every((tag) => document.querySelector('aeliqo-' + tag)?.shadowRoot?.querySelector('section')),
    tags,
  );
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.receipts.length === 1);
  const receipt = await page.evaluate(() => window.receipts[0]);
  assert.deepEqual(receipt, {
    source: 'user',
    entity: 'person',
    key: 'a',
    entityRevision: '1',
    values: { name: 'Ada Lovelace' },
  });
  assert.deepEqual(errors, []);
  browserReport = { eightRendered: true, reactPropertyAndEvent: true, draftReceipt: true };
  await page.screenshot({ path: join(runDirectory, 'installed-compounds.png'), fullPage: true });
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.equal(sourceDigest(), before, 'Source changed during consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      passed: true,
      scope:
        'Installed core/runtime/web/react tarballs; eight compound React bindings, web/React SSR, strict declarations, actual Chromium property and event behavior. Detailed states and semantics are separate focused suites.',
      artifacts: packages.map(({ bytes, ...item }) => item),
      consumerDirectory: consumer,
      node: nodeReport,
      browser: browserReport,
      environment: { node: process.version, chromium: chromiumVersion },
    },
    null,
    2,
  ) + '\n',
);
console.log('Installed compound consumer passed. Evidence: ' + join(runDirectory, 'report.json'));
