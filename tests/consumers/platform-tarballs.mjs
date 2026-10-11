import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/** Build, install and execute the actual M0 packages outside the workspace. */
import assert from 'node:assert/strict';
import { foundationProbe } from './foundation-probe.mjs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/platform-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-installed-consumer-'));
function run(argv, cwd, encoding = 'utf8') {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding, timeout: 180_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
// Only known TypeScript-generated output is removable; unexpected files/symlinks fail closed.
async function clearCompiledOutput(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
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
const sourceDigest = run(['node', 'scripts/source-digest.mjs'], root).trim();
const artifacts = [];
for (const name of ['core', 'runtime', 'web', 'react']) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.notEqual(manifest.private, true);
  const dist = join(directory, 'dist');
  try {
    assert(!(await lstat(dist)).isSymbolicLink(), 'Refuse symlinked dist');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await clearCompiledOutput(dist);
  run(['pnpm', 'build'], directory);
  const tarball = join(runDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
  run(['pnpm', 'pack', '--out', tarball], directory);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.notEqual(packed.private, true);
  assert.deepEqual(packed.exports, manifest.exports);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(!JSON.stringify(packed[field] ?? {}).includes('workspace:'), 'Unresolved workspace dependency');
  }
  if (name === 'runtime') assert.equal(packed.dependencies['@varendo/core'], RELEASE_VERSION);
  if (name === 'web') assert.equal(packed.dependencies['@varendo/core'], RELEASE_VERSION);
  if (name === 'react') assert.equal(packed.dependencies['@varendo/web'], RELEASE_VERSION);
  artifacts.push({
    name: packed.name,
    version: packed.version,
    path: tarball,
    sha256: hash(bytes),
    integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
  });
}
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
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
})) {
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
  assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
}
for (const artifact of artifacts) {
  const location = `node_modules/${artifact.name}`;
  assert.equal(lock.packages[location].integrity, artifact.integrity);
  assert.equal(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)).length,
    1,
    'Duplicate package resolution',
  );
  const names = run(['tar', '-tzf', artifact.path], root).trim().split('\n');
  for (const name of names) {
    assert(name.startsWith('package/') && !name.split('/').includes('..'), 'Unexpected archive path');
    if (name.endsWith('/')) continue;
    const installed = await readFile(join(consumer, location, name.slice('package/'.length)));
    const packed = run(['tar', '-xOf', artifact.path, name], root, null);
    assert.equal(hash(installed), hash(packed), `Installed bytes differ: ${name}`);
  }
}
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);
await writeFile(
  join(consumer, 'consumer.tsx'),
  `
import {AeliqoTextFieldElement, type AeliqoInputChangeDetail} from '@varendo/web/inputs';
import {AeliqoTableElement} from '@varendo/web/table';
import {AeliqoChartElement} from '@varendo/web/chart';
import {AeliqoTextField} from '@varendo/react/inputs';
import {registerAeliqoReactElements} from '@varendo/react';
import {aeliqoThemeStyles, createAeliqoLocaleContext} from '@varendo/web/styles';
const locale = createAeliqoLocaleContext('ar-EG', {direction: 'rtl'});
const styleText: string = aeliqoThemeStyles.cssText;
void [locale, styleText];
const value: AeliqoInputChangeDetail<string> = {value: 'Ada', source: 'user'};
const input = <AeliqoTextField label="Person" value="Ada" onValueChange={event => {const text:string=event.detail.value;void text;}} />;
void [AeliqoTextFieldElement,AeliqoTableElement,AeliqoChartElement,registerAeliqoReactElements,value,input];
`,
);
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      jsx: 'react-jsx',
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      noEmit: true,
      types: ['react'],
    },
    files: ['consumer.tsx'],
  }),
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);
await writeFile(
  join(consumer, 'consumer.mjs'),
  `
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {AeliqoTextField} from '@varendo/react/inputs';
import {AeliqoTextFieldElement} from '@varendo/web/inputs';
assert.equal(typeof window, 'undefined');
const styles = await import('@varendo/web/styles');
assert.equal(styles.createAeliqoLocaleContext('ar-EG', {direction:'rtl'}).direction, 'rtl');
assert.match(styles.aeliqoThemeStyles.cssText, /:host/);
assert.equal(typeof AeliqoTextFieldElement, 'function');
const reactMarkup=renderToString(createElement(AeliqoTextField,{label:'Person',value:'Ada'}));
assert.match(reactMarkup, /aeliqo-text-field/);assert.match(reactMarkup,/label="Person"/);
const {renderAeliqo}=await import('@varendo/web/server');const {html}=await import('lit');
const markup=await renderAeliqo(html\`<aeliqo-text-field label="Installed person" value="Ada"></aeliqo-text-field>\`);
assert.match(markup,/shadowrootmode="open"/);assert.match(markup,/Installed person/);assert.match(markup,/<input/);
console.log('Installed web/React types, Node import and Lit SSR content pass.');
`,
);
const stdout = run(['node', 'consumer.mjs'], consumer);
await writeFile(
  join(consumer, 'index.html'),
  '<!doctype html><html lang="en"><title>Installed Varendo input</title><body><script type="module" src="/browser.js"></script></body></html>',
);
await writeFile(
  join(consumer, 'browser.js'),
  `
import {AeliqoTextFieldElement} from '@varendo/web/inputs';
customElements.define('installed-aeliqo-text-field',AeliqoTextFieldElement);
const form=document.createElement('form');const input=document.createElement('installed-aeliqo-text-field');
input.label='Installed person';input.value='Ada';input.name='person';
input.addEventListener('aeliqo-input-change',event=>{input.value=event.detail.value;});
form.append(input);document.body.append(form);
`,
);
await writeFile(
  join(consumer, 'vite.config.mjs'),
  `
export default {build:{minify:true},plugins:[{name:'record-modules',generateBundle(_,bundle){
 const modules=Object.values(bundle).filter(x=>x.type==='chunk').flatMap(x=>Object.keys(x.modules));
 this.emitFile({type:'asset',fileName:'modules.json',source:JSON.stringify(modules)});
}}]};
`,
);
run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
const modules = JSON.parse(await readFile(join(consumer, 'dist/modules.json'), 'utf8'));
// AeliqoTextField delegates to the shared TextField; these are its exact required bases/events and release compatibility marker.
// Runtime, planner, agent, chart, and other component modules remain excluded.
const allowed =
  /(?:\/browser\.js$|\/index\.html$|vite\/modulepreload-polyfill|\/node_modules\/(?:lit(?:-html|-element)?\/|@lit\/reactive-element\/|@varendo\/web\/dist\/(?:version|elements\/aeliqo-text-field|events|input\/(?:events|base|text-control|text-field)|foundation\/base|styles\/(?:theme|tokens))\.js$))/;
assert.deepEqual(
  modules.filter((id) => !allowed.test(id)),
  [],
  'Unexpected standalone input module',
);
const browserBundles = [];
for (const file of await readdir(join(consumer, 'dist/assets'))) {
  if (!file.endsWith('.js')) continue;
  const bytes = await readFile(join(consumer, 'dist/assets', file));
  browserBundles.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(consumer, 'dist', pathname === '/' ? 'index.html' : '.' + pathname);
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
let browserVersion;
let foundation;
const viewport = { width: 1280, height: 720 };
try {
  browser = await chromium.launch();
  browserVersion = browser.version();
  const page = await browser.newPage({ viewport, locale: 'en-US', deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(`http://127.0.0.1:${server.address().port}/`))
      failures.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.getByLabel('Installed person');
  await input.waitFor();
  assert.equal(await input.inputValue(), 'Ada');
  await input.fill('Lin');
  assert.equal(await input.inputValue(), 'Lin');
  await page
    .locator('installed-aeliqo-text-field')
    .evaluate((element) => element.setAttribute('data-aeliqo-theme', 'dark'));
  assert.equal(await input.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(15, 17, 23)');
  assert.equal(await input.inputValue(), 'Lin');
  assert.equal(await page.locator('form').evaluate((form) => new FormData(form).get('person')), 'Lin');
  await input.focus();
  assert(await input.evaluate((element) => element.getRootNode().activeElement === element));
  assert.deepEqual(failures, []);
  await page.screenshot({ path: join(runDirectory, 'installed-input.png') });
  foundation = await foundationProbe({
    consumer,
    runDirectory,
    run,
    page,
    origin: `http://127.0.0.1:${server.address().port}`,
  });
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.equal(
  run(['node', 'scripts/source-digest.mjs'], root).trim(),
  sourceDigest,
  'Source changed during consumer test',
);
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest,
      scope:
        'Installed web, React, styles, input, form, focus, theme, and all thirteen foundation types; Lit SSR, React client rendering/action events and standalone Button bundle. Full React/Vue hydration and manual assistive-technology matrix are separate.',
      artifacts,
      consumerDirectory: consumer,
      consumerLock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      screenshot: {
        path: join(runDirectory, 'installed-input.png'),
        sha256: hash(await readFile(join(runDirectory, 'installed-input.png'))),
      },
      environment: {
        node: process.version,
        npm: run(['npm', '--version'], consumer).trim(),
        pnpm: run(['pnpm', '--version'], root).trim(),
        typescript: '7.0.2',
        vite: '8.2.2',
        playwright: JSON.parse(await readFile(join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
          .version,
        chromium: browserVersion,
        os: platform(),
        release: release(),
        arch: arch(),
        viewport,
        locale: 'en-US',
        deviceScaleFactor: 1,
      },
      foundation,
      stdout,
      browserBundles,
      standaloneModules: modules,
      moduleCheckScope: 'Vite module-ID graph allowlist; not arbitrary generated-code certification',
      passed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(stdout.trim());
console.log(`Evidence: ${join(runDirectory, 'report.json')}`);
