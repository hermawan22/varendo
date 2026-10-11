import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build, install and execute the vertical HR slice from actual package tarballs
 * outside the pnpm workspace. This is a bounded consumer proof for the
 * installed core/runtime/web graph; it does not certify every adapter or host.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/vertical-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-vertical-consumer-'));
const consumerReal = await realpath(consumer);
const source = {
  examples: resolve(root, 'examples/vertical-slice'),
  fixture: resolve(root, 'fixtures/hr/raw.json'),
};

function run(argv, cwd, encoding = 'utf8', env = process.env) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding, env, timeout: 180_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
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
const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();

const before = sourceDigest();
for (const [name, version] of [
  ['core', RELEASE_VERSION],
  ['runtime', RELEASE_VERSION],
  ['web', RELEASE_VERSION],
]) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, version);
  assert.notEqual(manifest.private, true);
  run(['pnpm', 'build'], directory);
}

const packages = [];
for (const name of ['core', 'runtime', 'web']) {
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
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/runtime/node_modules/')),
  [],
);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/web/node_modules/')),
  [],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

// Copy only the source files consumed by this probe. The workspace example may
// have a node_modules directory with workspace symlinks after pnpm install;
// copying the entire example would silently bypass the installed tarballs.
const exampleFiles = ['src/hr.ts', 'src/data-session.ts', 'src/view-session.ts'];
for (const relativePath of exampleFiles) {
  const from = join(source.examples, relativePath);
  const stat = await lstat(from);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Refuse non-regular example source: ${from}`);
  const to = join(consumer, 'examples/vertical-slice', relativePath);
  await mkdir(resolve(to, '..'), { recursive: true });
  await copyFile(from, to);
}
await mkdir(join(consumer, 'fixtures/hr'), { recursive: true });
const fixtureStat = await lstat(source.fixture);
assert(fixtureStat.isFile() && !fixtureStat.isSymbolicLink(), `Refuse non-regular HR fixture: ${source.fixture}`);
await copyFile(source.fixture, join(consumer, 'fixtures/hr/raw.json'));
assert.deepEqual(
  (await readdir(join(consumer, 'examples/vertical-slice'))).sort(),
  ['src'],
  'Copied example contains unexpected files',
);

// Resolve imports from a module physically located beside the copied example
// source. This exercises Node's ESM package resolver from that directory and
// proves every package comes from this temp consumer's node_modules tree.
const resolutionModule = join(consumer, 'examples/vertical-slice/src/module-resolution-check.mjs');
await writeFile(
  resolutionModule,
  `
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const packages = ['@varendo/core', '@varendo/runtime/data', '@varendo/runtime/evaluation', '@varendo/web/region'];
const resolved = {};
for (const packageName of packages) resolved[packageName] = await realpath(fileURLToPath(import.meta.resolve(packageName)));
console.log(JSON.stringify(resolved));
`,
);
const resolvedPackages = JSON.parse(run(['node', resolutionModule], consumer).trim().split('\n').at(-1));
for (const [packageName, resolved] of Object.entries(resolvedPackages)) {
  assert(
    resolved.startsWith(join(consumerReal, 'node_modules') + '/'),
    `Example import escaped installed consumer: ${packageName} -> ${resolved}`,
  );
}

await writeFile(
  join(consumer, 'src-node-entry.ts'),
  `
import {createHrDataSession} from './examples/vertical-slice/src/data-session.js';
import {initialTask} from './examples/vertical-slice/src/hr.js';
import type {ResultHandle} from '@varendo/runtime/results';
const rows = (handle: ResultHandle): readonly Record<string, unknown>[] => handle.snapshot().batches.flatMap(batch => batch.rows);
const session = createHrDataSession('local');
const first = await session.evaluate(initialTask());
const ranking = first.get('ranking');
const trend = first.get('trend');
if (ranking === undefined || trend === undefined) throw new Error('Named HR outputs were not produced.');
if (rows(ranking.handle).length !== 5 || rows(trend.handle).length !== 60) throw new Error('Unexpected HR result cardinality.');
const rankingIds = rows(ranking.handle).map(row => row.employee_id);
const trendRows = rows(trend.handle).length;
first.release(); session.dispose();
console.log(JSON.stringify({ranking: rankingIds, trendRows}));
`,
);
await writeFile(
  join(consumer, 'raw-import.d.ts'),
  'declare module "*?raw" { const value: string; export default value; }\n',
);
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        noEmit: true,
        types: ['node'],
      },
      include: ['src-node-entry.ts', 'browser-entry.ts', 'raw-import.d.ts'],
    },
    null,
    2,
  ) + '\n',
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);

await writeFile(
  join(consumer, 'vite.node.config.mjs'),
  `
export default {build: {ssr: 'src-node-entry.ts', outDir: 'dist-node', rollupOptions: {output: {format: 'es'}}}};
`,
);
run([join(consumer, 'node_modules/.bin/vite'), 'build', '--config', 'vite.node.config.mjs'], consumer);
const nodeBundle = join(consumer, 'dist-node/src-node-entry.js');
assert(await fileExists(nodeBundle), `Missing Node bundle: ${nodeBundle}`);
const nodeOutput = run(['node', nodeBundle], consumer).trim();
const nodeReport = JSON.parse(nodeOutput.split('\n').at(-1));
assert.deepEqual(nodeReport.ranking, ['e1', 'e2', 'e3', 'e4', 'e5']);
assert.equal(nodeReport.trendRows, 60);

await writeFile(
  join(consumer, 'browser-entry.ts'),
  `
import {registerAeliqoElements} from '@varendo/web/register';
import type {AeliqoRegionElement} from '@varendo/web/region';
import {createHrViewSession} from './examples/vertical-slice/src/view-session.js';
declare global { interface Window { hrFixture?: Awaited<ReturnType<typeof createHrViewSession>>; } }
registerAeliqoElements();
const view = document.querySelector<AeliqoRegionElement>('#hr-region');
const status = document.querySelector<HTMLElement>('#status');
const reorder = document.querySelector<HTMLButtonElement>('#reorder');
if (!view || !status || !reorder) throw new Error('Consumer fixture shell is incomplete.');
const session = await createHrViewSession();
window.hrFixture = session;
const render = () => { view.presentation = session.presentation; view.results = session.results; view.interaction = session.interaction; };
session.subscribe(render); render();
status.textContent = 'Five employees · Weekly rates use the same ranked population.';
reorder.disabled = false;
view.onSemanticInteraction = async request => {
  const receipt = await session.dispatch(request);
  if (!receipt.ok) { status.textContent = receipt.diagnostics[0]?.message ?? 'Selection failed.'; return; }
  status.textContent = request.payload.kind === 'selection' && request.payload.selection.mode === 'ids'
    ? 'Selected employee ' + request.payload.selection.keys.map(key => session.selectionLabel(key) ?? 'Unknown employee').join(', ') + '.' : 'Selection cleared.';
};
reorder.addEventListener('click', async () => {
  reorder.disabled = true;
  try { await session.reorder(); status.textContent = 'View order changed. The same results and selection are preserved.'; }
  finally { reorder.disabled = false; }
});
`,
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);
await writeFile(
  join(consumer, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Installed vertical slice</title></head><body><main data-aeliqo-theme="light"><button id="reorder" disabled>Swap view order</button><p id="status">Loading…</p><aeliqo-region id="hr-region" data-aeliqo-theme="inherit"></aeliqo-region></main><script type="module" src="/browser-entry.ts"></script></body></html>\n`,
);
await writeFile(join(consumer, 'vite.browser.config.mjs'), `export default {build: {outDir: 'dist-browser'}};\n`);
run([join(consumer, 'node_modules/.bin/vite'), 'build', '--config', 'vite.browser.config.mjs'], consumer);
const browserAssets = [];
for (const file of await readdir(join(consumer, 'dist-browser/assets'))) {
  if (!file.endsWith('.js')) continue;
  const bytes = await readFile(join(consumer, 'dist-browser/assets', file));
  browserAssets.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(consumer, 'dist-browser', pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(join(consumer, 'dist-browser') + '/')) {
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browserVersion;
const browserReport = {};
let browser;
try {
  browser = await chromium.launch();
  browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'en-US', deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await assert.doesNotReject(() => page.locator('#status').waitFor());
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Five employees'));
  const table = page.locator('#hr-region aeliqo-table');
  await assert.doesNotReject(() => table.locator('tbody tr').first().waitFor());
  assert.equal(await table.locator('tbody tr').count(), 5);
  const selected = table.getByRole('radio', { name: 'Select employees e2', exact: true });
  await selected.check();
  assert.equal(await page.locator('#status').textContent(), 'Selected employee e2.');
  assert.equal(await page.evaluate(() => window.hrFixture.data.queryCount), 2);
  await page.getByRole('button', { name: 'Swap view order' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('same results and selection'),
  );
  assert(await table.getByRole('radio', { name: 'Select employees e2', exact: true }).isChecked());
  assert.equal(await page.evaluate(() => window.hrFixture.data.queryCount), 2);
  const stale = await page.evaluate(async () => {
    const before = JSON.stringify(window.hrFixture.presentation.plan);
    const diagnostics = await window.hrFixture.refuseStaleProposal();
    return { code: diagnostics[0]?.code, preserved: JSON.stringify(window.hrFixture.presentation.plan) === before };
  });
  assert.deepEqual(stale, { code: 'runtime.region-stale', preserved: true });
  browserReport.rows = await table.locator('tbody tr').count();
  browserReport.selection = await table.getByRole('radio', { name: 'Select employees e2', exact: true }).isChecked();
  browserReport.queryCount = await page.evaluate(() => window.hrFixture.data.queryCount);
  browserReport.stale = stale;
  browserReport.failures = failures;
  await page.screenshot({ path: join(runDirectory, 'vertical-installed.png'), fullPage: true });
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

assert.equal(sourceDigest(), before, 'Source changed during tarball consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      scope:
        'Installed @varendo/core, @varendo/runtime and @varendo/web tarballs with copied HR vertical source; strict TypeScript; bundled Node evaluator; Chromium render, typed selection, queryless reorder and stale proposal.',
      artifacts: packages.map(({ bytes, ...item }) => item),
      consumerDirectory: consumer,
      consumerLock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      node: nodeReport,
      browser: browserReport,
      browserAssets,
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
        viewport: { width: 1280, height: 720 },
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
