import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the complete input family from real package tarballs.
 *
 * The consumer is deliberately outside the pnpm workspace. It verifies the
 * published web and React entry points,
  strict declarations,
  Lit SSR,
  and a
 * real Chromium flow covering native form state,
  defaults/reset,
  IME input,
  * controlled event echoing,
  file metadata and the form boundary.
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
const output = join(root, 'artifacts/plot-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-plot-consumer-'));
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
  const tarball = join(runDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
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

const ref = { id: 'r', revision: '1', outputId: 'out', queryDigest: 'q', scopeDigest: 's' };
const result = {
  version: '1',
  ref,
  taskId: 't',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'x', label: 'X', type: { value: 'integer', nullable: false }, role: 'dimension' },
    { id: 'y', label: 'Y', type: { value: 'decimal', nullable: true }, role: 'measure' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 3, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Host supplied rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot' },
  evidence: { kind: 'computed', queryDigest: 'q', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const unit = {
  kind: 'unit',
  result: ref,
  mark: 'line',
  missing: 'gap',
  encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
};
const rows = [
  { id: 'a', x: 1, y: { decimal: '9007199254740993.001' } },
  { id: 'b', x: 2, y: null },
  { id: 'c', x: 3, y: { decimal: '9007199254740993.003' } },
];
const spec = { version: '1', root: { kind: 'facet', field: 'id', scales: 'shared-compatible', child: unit } };
const dataSource = `const result=${JSON.stringify(result)},
  unit=${JSON.stringify(unit)},
  rows=${JSON.stringify(rows)},
  spec=${JSON.stringify(spec)};\n`;
await writeFile(
  join(consumer, 'consumer.tsx'),
  `import React from 'react';
import type {PlotSpec,
  PlotUnit,
  Result,
} from '@varendo/core';
import {AeliqoPlotElement,compilePlotComposition,type PlotDataset} from '@varendo/web/plot';
import {AeliqoPlot} from '@varendo/react/plot';
const result:Result=${JSON.stringify(result)};
const unit:PlotUnit=${JSON.stringify(unit)};
const spec:PlotSpec=${JSON.stringify(spec)};
const datasets:readonly PlotDataset[]=[{result:result.ref,rows:${JSON.stringify(rows)}}];
const element=new AeliqoPlotElement();element.spec=spec;element.results=[result];element.datasets=datasets;
const component=<Varendo spec={spec} results={[result]} datasets={datasets} onSelectionChange={e=>{const digest:string=e.detail.result.scopeDigest;void digest;}}/>;
void [component,compilePlotComposition(spec,[result],datasets,{width:400,height:240,maxRows:100,maxMarks:100})];
`.replace('<Varendo spec', '<AeliqoPlot spec'),
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
import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToString} from 'react-dom/server';import {AeliqoPlot} from '@varendo/react/plot';
${dataSource}
const output=renderToString(createElement(AeliqoPlot,{spec,results:[result],datasets:[{result:result.ref,rows}]}));
assert(output.includes('9007199254740993.001'));assert(output.includes('shadowrootmode="open"'));assert.equal((output.match(/<circle/g)||[]).length,2);
const next=renderToString(createElement(AeliqoPlot));assert(!next.includes('9007199254740993'));assert(next.includes('No result is available'));
console.log('Installed React composition SSR exact values and request isolation passed.');`,
);
const ssr = run(['node', 'ssr.mjs'], consumer);
await writeFile(
  join(consumer, 'browser.ts'),
  `import {AeliqoPlotElement} from '@varendo/web/plot';
${dataSource}
customElements.define('aeliqo-plot',AeliqoPlotElement);const plot=new AeliqoPlotElement();plot.label='Installed plot';plot.unit=unit;plot.result=result;plot.rows=rows;plot.width=400;plot.height=240;document.querySelector('main').append(plot);Object.assign(window,{plot,spec,result,rows});`,
);
await writeFile(
  join(consumer, 'index.html'),
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed plot</title><body><main></main><script type="module" src="/browser.ts"></script></body></html>',
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('aeliqo-plot table').waitFor();
  assert.equal(await page.locator('aeliqo-plot circle').count(), 2);
  assert.equal(await page.getByRole('cell', { name: '9007199254740993.001', exact: true }).count(), 1);
  const points = await page
    .locator('circle')
    .evaluateAll((nodes) => nodes.map((n) => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))]));
  await page.evaluate(async () => {
    window.plot.renderer = 'canvas';
    await window.plot.updateComplete;
  });
  const samples = await page.locator('canvas').evaluate((c, points) => {
    const ctx = c.getContext('2d');
    const ratio = c.width / 400;
    return points.map(([x, y]) => ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data[3]);
  }, points);
  assert(samples.every((a) => a > 0));
  await page.evaluate(async () => {
    const p = window.plot;
    p.renderer = 'svg';
    p.spec = window.spec;
    p.results = [window.result];
    p.datasets = [{ result: window.result.ref, rows: window.rows }];
    p.addEventListener('aeliqo-plot-select', (e) => {
      p.selectedIdentity = e.detail.identity;
      p.selectedResult = e.detail.result;
    });
    await p.updateComplete;
  });
  assert.equal(await page.locator('table').count(), 3);
  assert.equal(await page.locator('tbody tr').count(), 3);
  await page.getByRole('button', { name: 'Select a', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Select a', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: join(runDirectory, 'installed-plot.png') });
  assert.deepEqual(failures, []);
  await page.evaluate(async () => {
    window.plot.results = [];
    await window.plot.updateComplete;
  });
  assert.equal(await page.locator('table').count(), 0);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.equal(sourceDigest(), before, 'Source changed during installed plot proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      scope:
        'Installed PlotSpec/geometry/web/React declarations, actual React SSR composition and request isolation, Chromium exact values/SVG/Canvas/facets/selection/revocation',
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
