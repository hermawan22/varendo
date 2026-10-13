import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/** Installed visualization package,
  strict TypeScript,
  React SSR and Chromium proof. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, lstat, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/visualization-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'varendo-visualization-consumer-'));
const consumerReal = await realpath(consumer);

function run(argv, cwd, encoding = 'utf8') {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
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

const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();
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

const hierarchy = await import('../visualization/hierarchy-fixtures.ts');
const cartesian = await import('../visualization/cartesian-fixtures.mjs');
const extraViews = [
  ...['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap'].map((view) => ({
    view,
    spec: cartesian.specs[view],
    context: cartesian.contextFor(view),
    datasets: [{ result: cartesian.ref, rows: cartesian.rowsFor(view) }],
  })),
  ...['tree', 'treemap', 'relationship'].map((view) => ({
    view,
    spec: hierarchy[view],
    context: hierarchy.context,
    datasets: hierarchy.datasets,
  })),
];
const extraNames = ['Trend', 'Bar', 'Area', 'Scatter', 'Histogram', 'Heatmap', 'Tree', 'Treemap', 'Relationship'];
const ref = { id: 'r', revision: '1', outputId: 'out', queryDigest: 'q', scopeDigest: 's' };
const result = {
  version: '1',
  ref,
  taskId: 't',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    {
      id: 'date',
      label: 'Date',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory' } },
      role: 'attribute',
    },
    { id: 'amount', label: 'Amount', type: { value: 'decimal', nullable: false }, role: 'measure' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 1, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Bounded supplied rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot unknown' },
  evidence: { kind: 'computed', queryDigest: 'q', definitions: [] },
  filters: [],
  warnings: [{ code: 'scope-page', message: 'Other rows may exist.', retryable: false }],
  lineage: [],
};
const rows = [{ id: 'a', date: '2026-09-08', amount: { decimal: '9007199254740993.001' } }];
const specs = [
  { version: '1', view: 'matrix', result: ref, columns: ['id', 'amount'] },
  { version: '1', view: 'timeline', result: ref, start: 'date' },
  { version: '1', view: 'calendar-grid', result: ref, date: 'date', value: 'amount', label: 'id' },
];
const dataSource = `const extraViews=${JSON.stringify(extraViews)};\nconst result=${JSON.stringify(result)},
  rows=${JSON.stringify(rows)},
  specs=${JSON.stringify(specs)};\n`;
await writeFile(
  join(consumer, 'consumer.tsx'),
  `import React from 'react';
import type {VisualizationSpec,
  Result,
} from '@varendo/core';
import {VarendoMatrixElement,VarendoTimelineElement,VarendoCalendarGridElement,type VisualizationInputs} from '@varendo/web/visualization';
import {VarendoMatrix,VarendoTimeline,VarendoCalendarGrid,${extraNames.map((name) => 'Varendo' + name).join(',')}} from '@varendo/react/visualization';
const result:Result=${JSON.stringify(result)};
const specs:readonly VisualizationSpec[]=${JSON.stringify(specs)};
const inputs:VisualizationInputs={visualization:specs[0],context:{results:[result]},datasets:[{result:result.ref,rows:${JSON.stringify(rows)}}],label:'Exact result',width:640,height:320,maxMarks:1000};
const element=new VarendoMatrixElement();element.visualization=specs[0];element.context=inputs.context;element.datasets=inputs.datasets;
const component=<VarendoMatrix {...inputs} onSelectionChange={e=>{const digest:string=e.detail.result.scopeDigest;const identity:string=e.detail.identity;void[digest,identity];}}/>;
void[component,VarendoTimeline,VarendoCalendarGrid,VarendoTimelineElement,VarendoCalendarGridElement,${extraNames.map((name) => 'Varendo' + name).join(',')}];
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
      noEmit: true,
      skipLibCheck: false,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    files: ['consumer.tsx'],
  }),
);
run([join(consumer, 'node_modules/.bin/tsc'), '-p', 'tsconfig.json'], consumer);
await writeFile(
  join(consumer, 'ssr.mjs'),
  `import '@varendo/react/ssr';
import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToString} from 'react-dom/server';import {VarendoMatrix,VarendoTimeline,VarendoCalendarGrid,${extraNames.map((name) => 'Varendo' + name).join(',')}} from '@varendo/react/visualization';
${dataSource}
for(const [index,component] of [VarendoMatrix,VarendoTimeline,VarendoCalendarGrid].entries()){
 const output=renderToString(createElement(component,{visualization:specs[index],context:{results:[result]},datasets:[{result:result.ref,rows}]}));
 assert(output.includes('9007199254740993.001'));assert(output.includes('shadowrootmode="open"'));assert(output.includes('Other rows may exist.'));
 const next=renderToString(createElement(component));assert(!next.includes('9007199254740993'));assert(!next.includes('<table'));
}
for(const [index,component] of [${extraNames.map((name) => 'Varendo' + name).join(',')}].entries()){const data=extraViews[index];const output=renderToString(createElement(component,{visualization:data.spec,context:data.context,datasets:data.datasets}));assert(output.includes('<table'));assert(output.includes('<svg'));assert(output.includes('shadowrootmode="open"'));const next=renderToString(createElement(component));assert(!next.includes('<table'));}
console.log('Installed React twelve-family plus Matrix, Timeline, CalendarGrid SSR exact values, warnings and request isolation passed.');`,
);
const ssr = run(['node', 'ssr.mjs'], consumer);
await writeFile(
  join(consumer, 'browser.ts'),
  `import {registerVarendoElements} from '@varendo/web';
${dataSource}
registerVarendoElements();const views=specs.map(spec=>{const element=document.createElement('varendo-'+spec.view);Object.assign(element,{label:spec.view,visualization:spec,context:{results:[result]},datasets:[{result:result.ref,rows}]});element.addEventListener('varendo-visualization-select',event=>Object.assign(window,{selection:event.detail}));document.querySelector('main').append(element);return element;});for(const data of extraViews){const element=document.createElement('varendo-'+data.view);Object.assign(element,{visualization:data.spec,context:data.context,datasets:data.datasets});element.addEventListener('varendo-visualization-select',event=>Object.assign(window,{selection:event.detail}));document.querySelector('main').append(element);views.push(element);}Object.assign(window,{views});`,
);
await writeFile(
  join(consumer, 'index.html'),
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed visualizations</title><body><main></main><script type="module" src="/browser.ts"></script></body></html>',
);
run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(consumer, 'dist', name === '/' ? 'index.html' : '.' + name);
    if (!file.startsWith(join(consumer, 'dist') + '/')) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
let browserVersion;
const failures = [];
try {
  browser = await chromium.launch();
  browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('varendo-matrix table').waitFor();
  assert.equal(await page.locator('table').count(), 12);
  assert.equal(await page.getByRole('cell', { name: '9007199254740993.001', exact: true }).count(), 3);
  assert.equal(await page.locator('varendo-timeline line').count(), 1);
  const button = page.locator('varendo-matrix').getByRole('button', { name: 'Select a', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const selected = await page.evaluate(() => window.selection);
  assert.equal(selected.source, 'user');
  assert.equal(selected.result.scopeDigest, 's');
  assert(selected.identity.includes('a'));
  for (const data of extraViews) {
    const host = page.locator('varendo-' + data.view);
    assert.equal(await host.locator('table').count(), 1);
    assert.equal(await host.locator('svg').count(), 1);
    assert((await host.locator('tbody tr').count()) > 0);
    assert(
      await host
        .locator('svg rect,svg line,svg circle,svg path')
        .evaluateAll((nodes) => nodes.length > 0 && nodes.every((node) => node instanceof SVGGraphicsElement)),
    );
    const disclosure = host.getByText('View data table', { exact: true });
    if ((await disclosure.count()) > 0) await disclosure.first().click();
    const button = host.locator('table button').first();
    await button.focus();
    await page.keyboard.press('Enter');
    const selected = await page.evaluate(() => window.selection);
    assert.equal(selected.source, 'user');
    assert.equal(selected.result.scopeDigest, data.datasets[0].result.scopeDigest);
  }
  await page.screenshot({ path: join(runDirectory, 'installed-visualizations.png'), fullPage: true });
  assert.deepEqual(failures, []);
  await page.evaluate(async () => {
    for (const view of window.views) {
      view.context = { results: [] };
      await view.updateComplete;
    }
  });
  assert.equal(await page.locator('table').count(), 0);
  assert.equal(await page.locator('svg').count(), 0);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.equal(sourceDigest(), before, 'Source changed during installed visualization proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      scope:
        'Installed twelve-family public web/React strict declarations, React SSR exact data/warnings/isolation, Chromium geometry/keyboard selection/revocation',
      artifacts: artifacts.map(({ bytes, entries, ...a }) => a),
      consumerDirectory: consumer,
      consumerLock: { sha256: hash(lockBytes) },
      ssr,
      failures,
      environment: { node: process.version, chromium: browserVersion },
      passed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Evidence: ${join(runDirectory, 'report.json')}`);
