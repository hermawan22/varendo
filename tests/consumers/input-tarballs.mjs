import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build and consume the complete input family from real package tarballs.
 *
 * The consumer is deliberately outside the pnpm workspace. It verifies the
 * published web and React entry points, strict declarations, Lit SSR, and a
 * real Chromium flow covering native form state, defaults/reset, IME input,
 * controlled event echoing, file metadata, stale validation, and form parity.
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
const output = join(root, 'artifacts/input-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-input-consumer-'));
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

const webSubpaths = [
  'inputs',
  'text-field',
  'text-area',
  'number-field',
  'checkbox',
  'radio-group',
  'switch',
  'select',
  'combobox',
  'date-field',
  'date-range',
  'slider',
  'search-field',
  'file-input',
  'field-group',
  'form',
];
const webSpecifiers = ['@varendo/web/server', ...webSubpaths.map((path) => `@varendo/web/${path}`)];
const reactSpecifiers = ['@varendo/react', '@varendo/react/inputs'];
const resolutionEntry = join(consumer, 'resolve-inputs.mjs');
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
  if (!path.startsWith(${JSON.stringify(join(consumerReal, 'node_modules'))} + '/')) throw new Error(spec + ' escaped installed node_modules: ' + path);
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
import {AeliqoTextField, AeliqoTextArea, AeliqoNumberField, AeliqoCheckbox, AeliqoRadioGroup, AeliqoSwitch, AeliqoSelect, AeliqoCombobox, AeliqoDateField, AeliqoDateRange, AeliqoSlider, AeliqoSearchField, AeliqoFileInput, AeliqoFieldGroup, AeliqoForm} from '@varendo/react/inputs';
import {AeliqoTextFieldElement, AeliqoTextAreaElement, AeliqoNumberFieldElement, AeliqoCheckboxElement, AeliqoRadioGroupElement, AeliqoSwitchElement, AeliqoSelectElement, AeliqoComboboxElement, AeliqoDateFieldElement, AeliqoDateRangeElement, AeliqoSliderElement, AeliqoSearchFieldElement, AeliqoFileInputElement, AeliqoFieldGroupElement, AeliqoFormElement} from '@varendo/web/inputs';
import {AeliqoTextFieldElement as TextFieldByPath} from '@varendo/web/text-field';
import type {AeliqoInputChangeDetail, AeliqoInputCommitDetail, AeliqoValidationDetail, AeliqoSearchDetail, AeliqoFileChangeDetail, AeliqoFormSubmitDetail, AeliqoDateRangeValue} from '@varendo/web/inputs';
import {createAeliqoPresentationRegistry, type AeliqoInputBindings} from '@varendo/web/region';
const semanticBindings = {revision:'inputs-1',inputs:[{id:'name',ref:{id:'input.text-field',revision:'1'},config:{label:'Name'},draft:{entity:'profile',key:'self',field:'name',entityRevision:'1',type:{value:'text',nullable:false}}}]} satisfies AeliqoInputBindings;
const semanticRegistry = createAeliqoPresentationRegistry({inputs:semanticBindings});
void semanticRegistry;

const app = <>
  <AeliqoTextField label='Name' onValueChange={event => { const value: string = event.detail.value; void value; }} onValueCommit={event => { const value: string = event.detail.value; void value; }} onValidation={event => { const state: AeliqoValidationDetail['state'] = event.detail.state; void state; }} />
  <AeliqoTextArea label='Notes' onValueChange={event => { const value: string = event.detail.value; void value; }} />
  <AeliqoNumberField label='Amount' onValueChange={event => { const valid: boolean = event.detail.value.valid; void valid; }} />
  <AeliqoCheckbox label='Agree' onValueChange={event => { const checked: boolean = event.detail.value; void checked; }} />
  <AeliqoRadioGroup label='Role' onValueChange={event => { const value: string = event.detail.value; void value; }} />
  <AeliqoSwitch label='Enabled' onValueChange={event => { const checked: boolean = event.detail.value; void checked; }} />
  <AeliqoSelect label='Country' onValueChange={event => { const value: string = event.detail.value; void value; }} />
  <AeliqoCombobox label='Person' onValueChange={event => { const value: string = event.detail.value; void value; }} onQueryChange={event => { const query: string = event.detail.query; void query; }} />
  <AeliqoDateField label='Date' onValueChange={event => { const value: string = event.detail.value; void value; }} />
  <AeliqoDateRange label='Period' onValueChange={event => { const range: AeliqoDateRangeValue = event.detail.value; void range; }} />
  <AeliqoSlider label='Progress' onValueChange={event => { const value: number = event.detail.value.value; void value; }} />
  <AeliqoSearchField label='Search' onValueChange={event => { const value: string = event.detail.value; void value; }} onSearch={event => { const query: string = event.detail.query; void query; }} />
  <AeliqoFileInput label='Attachment' onFilesChange={event => { const files: readonly AeliqoFileChangeDetail['files'][number][] = event.detail.files; void files; }} />
  <AeliqoFieldGroup legend='Group' />
  <AeliqoForm label='Form' onSubmit={event => { const submitter: string | undefined = event.detail.submitter; void submitter; }} onReset={event => { const type: string = event.type; void type; }} />
</>;
void app;
void [AeliqoTextFieldElement, AeliqoTextAreaElement, AeliqoNumberFieldElement, AeliqoCheckboxElement, AeliqoRadioGroupElement, AeliqoSwitchElement, AeliqoSelectElement, AeliqoComboboxElement, AeliqoDateFieldElement, AeliqoDateRangeElement, AeliqoSliderElement, AeliqoSearchFieldElement, AeliqoFileInputElement, AeliqoFieldGroupElement, AeliqoFormElement, TextFieldByPath];
const inputDetail: AeliqoInputChangeDetail<string> | AeliqoInputCommitDetail<string> = {source: 'user', value: 'typed'};
const searchDetail: AeliqoSearchDetail = {source: 'user', query: 'typed'};
const fileDetail: AeliqoFileChangeDetail = {source: 'user', files: []};
const submitDetail: AeliqoFormSubmitDetail = {source: 'user', submitter: undefined};
void [inputDetail, searchDetail, fileDetail, submitDetail];
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
import {renderAeliqo} from '@varendo/web/server';
import {AeliqoTextField, AeliqoForm} from '@varendo/react/inputs';
const markup = await renderAeliqo(html\`<aeliqo-text-field label="SSR name" default-value="Ada"></aeliqo-text-field><aeliqo-number-field label="SSR amount" default-value="10.50"></aeliqo-number-field><aeliqo-checkbox label="SSR agree" default-checked></aeliqo-checkbox><aeliqo-radio-group label="SSR role" .options=\${[{value:'a',label:'Admin'}]} default-value="a"></aeliqo-radio-group><aeliqo-switch label="SSR switch" default-checked></aeliqo-switch><aeliqo-select label="SSR country" .options=\${[{value:'id',label:'Indonesia'}]} default-value="id"></aeliqo-select><aeliqo-combobox label="SSR person" .options=\${[{value:'ada',label:'Ada'}]} default-value="ada"></aeliqo-combobox><aeliqo-date-field label="SSR date" default-value="2026-09-08"></aeliqo-date-field><aeliqo-date-range label="SSR range" default-start="2026-09-01" default-end="2026-09-08"></aeliqo-date-range><aeliqo-slider label="SSR progress" default-value="20"></aeliqo-slider><aeliqo-search-field label="SSR search" default-value="Ada"></aeliqo-search-field><aeliqo-file-input label="SSR file"></aeliqo-file-input><aeliqo-field-group legend="SSR group"></aeliqo-field-group><aeliqo-form label="SSR form"></aeliqo-form>\`);
assert.match(markup, /shadowrootmode="open"/);
for (const text of ['SSR name','SSR amount','SSR agree','SSR role','SSR switch','SSR country','SSR person','SSR date','SSR range','SSR progress','SSR search','SSR file','SSR group','SSR form']) assert.match(markup, new RegExp(text));
const reactMarkup = renderToString(createElement(AeliqoTextField, {label: 'React SSR name', value: 'Ada'}));
assert.match(reactMarkup, /aeliqo-text-field/);
assert.match(reactMarkup, /React SSR name/);
assert.match(reactMarkup, /shadowrootmode="open"/);
const secondRequest=renderToString(createElement(AeliqoTextField,{label:'Second request'}));
assert(!secondRequest.includes('Ada'));
assert(!secondRequest.includes('React SSR name'));
const reactForm = renderToString(createElement(AeliqoForm, {label: 'React SSR form'}));
assert.match(reactForm, /aeliqo-form/);
console.log(JSON.stringify({webBytes: markup.length, reactBytes: reactMarkup.length + reactForm.length}));
`,
);
const ssrOutput = run(['node', join(consumer, 'ssr.mjs')], consumer).trim();

await writeFile(
  join(consumer, 'browser-entry.ts'),
  `
import {AeliqoTextFieldElement} from '@varendo/web/text-field';
import {AeliqoTextAreaElement} from '@varendo/web/text-area';
import {AeliqoNumberFieldElement} from '@varendo/web/number-field';
import {AeliqoCheckboxElement} from '@varendo/web/checkbox';
import {AeliqoRadioGroupElement} from '@varendo/web/radio-group';
import {AeliqoSwitchElement} from '@varendo/web/switch';
import {AeliqoSelectElement} from '@varendo/web/select';
import {AeliqoComboboxElement} from '@varendo/web/combobox';
import {AeliqoDateFieldElement} from '@varendo/web/date-field';
import {AeliqoDateRangeElement} from '@varendo/web/date-range';
import {AeliqoSliderElement} from '@varendo/web/slider';
import {AeliqoSearchFieldElement} from '@varendo/web/search-field';
import {AeliqoFileInputElement} from '@varendo/web/file-input';
import {AeliqoFieldGroupElement} from '@varendo/web/field-group';
import {AeliqoFormElement} from '@varendo/web/form';
const definitions = [
  ['aeliqo-text-field', AeliqoTextFieldElement], ['aeliqo-text-area', AeliqoTextAreaElement], ['aeliqo-number-field', AeliqoNumberFieldElement],
  ['aeliqo-checkbox', AeliqoCheckboxElement], ['aeliqo-radio-group', AeliqoRadioGroupElement], ['aeliqo-switch', AeliqoSwitchElement],
  ['aeliqo-select', AeliqoSelectElement], ['aeliqo-combobox', AeliqoComboboxElement], ['aeliqo-date-field', AeliqoDateFieldElement],
  ['aeliqo-date-range', AeliqoDateRangeElement], ['aeliqo-slider', AeliqoSliderElement], ['aeliqo-search-field', AeliqoSearchFieldElement],
  ['aeliqo-file-input', AeliqoFileInputElement], ['aeliqo-field-group', AeliqoFieldGroupElement], ['aeliqo-form', AeliqoFormElement],
];
for (const [tag, constructor] of definitions) if (!customElements.get(tag)) customElements.define(tag, constructor);
const root = document.querySelector('#fixture');
if (!root) throw new Error('input fixture root missing');
const form = document.createElement('form'); form.id = 'native-form'; root.append(form);
const text = new AeliqoTextFieldElement(); text.id = 'text'; text.label = 'Name'; text.name = 'person'; text.defaultValue = 'Ada';
const area = new AeliqoTextAreaElement(); area.label = 'Notes'; area.name = 'notes'; area.defaultValue = 'Draft';
const number = new AeliqoNumberFieldElement(); number.label = 'Amount'; number.name = 'amount'; number.defaultValue = '1234.50';
const check = new AeliqoCheckboxElement(); check.label = 'Agree'; check.name = 'agree'; check.value = 'yes'; check.defaultChecked = true;
const radio = new AeliqoRadioGroupElement(); radio.label = 'Role'; radio.name = 'role'; radio.defaultValue = 'admin'; radio.options = [{value: 'admin', label: 'Admin'}, {value: 'user', label: 'User'}];
const sw = new AeliqoSwitchElement(); sw.label = 'Enabled'; sw.name = 'enabled'; sw.value = 'yes'; sw.defaultChecked = true;
const select = new AeliqoSelectElement(); select.label = 'Country'; select.name = 'country'; select.defaultValue = 'id'; select.options = [{value: 'id', label: 'Indonesia'}, {value: 'us', label: 'United States'}];
const combo = new AeliqoComboboxElement(); combo.label = 'Person'; combo.name = 'personChoice'; combo.defaultValue = 'ada'; combo.options = [{value: 'ada', label: 'Ada'}, {value: 'grace', label: 'Grace'}];
const date = new AeliqoDateFieldElement(); date.label = 'Date'; date.name = 'date'; date.defaultValue = '2026-09-08';
const range = new AeliqoDateRangeElement(); range.label = 'Period'; range.name = 'period'; range.defaultStart = '2026-09-01'; range.defaultEnd = '2026-09-08';
const slider = new AeliqoSliderElement(); slider.label = 'Progress'; slider.name = 'progress'; slider.defaultValue = 40;
const search = new AeliqoSearchFieldElement(); search.label = 'Search'; search.name = 'search'; search.defaultValue = 'Ada';
const file = new AeliqoFileInputElement(); file.label = 'Attachment'; file.name = 'attachment';
const all = [text, area, number, check, radio, sw, select, combo, date, range, slider, search, file];
for (const element of all) form.append(element);
const group = new AeliqoFieldGroupElement(); group.legend = 'Group'; const groupedField=new AeliqoTextFieldElement(); groupedField.label='Group name'; group.append(groupedField); root.append(group);
const appForm = new AeliqoFormElement(); appForm.id = 'app-form'; const appField = new AeliqoTextFieldElement(); appField.label = 'App field'; appForm.append(appField); const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Submit'; appForm.append(submit); const reset = document.createElement('button'); reset.type = 'reset'; reset.textContent = 'Reset'; appForm.append(reset); root.append(appForm);
const ready = Promise.all(all.map(element => element.updateComplete));
const valueEvents: string[] = []; const queryEvents: string[] = []; const searchEvents: string[] = []; const files: string[] = []; let submitted = 0; let resetCount = 0;
text.addEventListener('aeliqo-input-change', event => { const value = (event as CustomEvent<{value: string}>).detail.value; valueEvents.push(value); text.value = value; });
combo.addEventListener('aeliqo-combobox-query', event => queryEvents.push((event as CustomEvent<{query: string}>).detail.query));
search.addEventListener('aeliqo-search', event => searchEvents.push((event as CustomEvent<{query: string}>).detail.query));
file.addEventListener('aeliqo-file-change', event => files.push((event as CustomEvent<{files: readonly {name: string}[]}>).detail.files[0]?.name ?? ''));
appForm.addEventListener('aeliqo-form-submit', () => { submitted += 1; }); appForm.addEventListener('aeliqo-form-reset', () => { resetCount += 1; });
Object.assign(window, {inputFixture: {form, text, area, number, check, radio, sw, select, combo, date, range, slider, search, file, all, appForm, appField, submit, reset, valueEvents, queryEvents, searchEvents, files, get submitted() { return submitted; }, get resetCount() { return resetCount; }, ready}});
`,
);
await writeFile(
  join(consumer, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Installed Varendo inputs</title></head><body><main id="fixture"></main><script type="module" src="/browser-entry.js"></script></body></html>\n',
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
  await page.waitForFunction(() => Boolean(window.inputFixture));
  await page.evaluate(() => window.inputFixture.ready);
  const defaults = await page.evaluate(() => {
    const f = window.inputFixture;
    return {
      text: f.text.value,
      area: f.area.value,
      number: f.number.value,
      checked: f.check.checked,
      radio: f.radio.value,
      switch: f.sw.checked,
      select: f.select.value,
      combo: f.combo.value,
      date: f.date.value,
      range: [f.range.start, f.range.end],
      slider: f.slider.value,
      search: f.search.value,
    };
  });
  assert.deepEqual(defaults, {
    text: 'Ada',
    area: 'Draft',
    number: '1234.50',
    checked: true,
    radio: 'admin',
    switch: true,
    select: 'id',
    combo: 'ada',
    date: '2026-09-08',
    range: ['2026-09-01', '2026-09-08'],
    slider: 40,
    search: 'Ada',
  });
  const formData = await page.evaluate(() =>
    [...new FormData(window.inputFixture.form).entries()].map(([key, value]) => [key, String(value)]),
  );
  assert(formData.some(([key, value]) => key === 'person' && value === 'Ada'));
  assert(formData.some(([key, value]) => key === 'agree' && value === 'yes'));
  assert(formData.some(([key, value]) => key === 'country' && value === 'id'));
  const resetDefaults = await page.evaluate(async () => {
    const f = window.inputFixture;
    f.text.value = 'Changed';
    f.check.checked = false;
    f.select.value = 'us';
    f.form.reset();
    await Promise.all(f.all.map((element) => element.updateComplete));
    return { text: f.text.value, checked: f.check.checked, select: f.select.value };
  });
  assert.deepEqual(resetDefaults, { text: 'Ada', checked: true, select: 'id' });
  const interactions = await page.evaluate(async () => {
    const f = window.inputFixture;
    const native = f.text.shadowRoot.querySelector('input[part=input]');
    native.value = 'Lin';
    native.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Lin' }));
    await f.text.updateComplete;
    const comboInput = f.combo.shadowRoot.querySelector('input[part=input]');
    comboInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    comboInput.value = 'あ';
    comboInput.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'あ' }),
    );
    await f.combo.updateComplete;
    const during = { queries: [...f.queryEvents], valueEvents: [...f.valueEvents] };
    comboInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'あ' }));
    await f.combo.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    comboInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'あ' }));
    await f.combo.updateComplete;
    const searchInput = f.search.shadowRoot.querySelector('input[part=input]');
    searchInput.value = 'new';
    searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'new' }));
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await f.search.updateComplete;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['abc'], 'proof.txt', { type: 'text/plain' }));
    const fileInput = f.file.shadowRoot.querySelector('input[type=file]');
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await f.file.updateComplete;
    f.submit.click();
    await f.appForm.updateComplete;
    f.reset.click();
    await f.appForm.updateComplete;
    return {
      during,
      textEvent: f.valueEvents.at(-1),
      textValue: f.text.value,
      queryEvents: [...f.queryEvents],
      comboValue: f.combo.value,
      comboQuery: f.combo.query,
      searchEvents: [...f.searchEvents],
      files: [...f.files],
      submitted: f.submitted,
      resetCount: f.resetCount,
    };
  });
  assert.deepEqual(interactions.during, { queries: [], valueEvents: ['Lin'] });
  assert.equal(interactions.textEvent, 'Lin');
  assert.equal(interactions.textValue, 'Lin');
  assert.deepEqual(interactions.queryEvents, ['あ']);
  assert.equal(interactions.comboValue, '');
  assert.equal(interactions.comboQuery, 'あ');
  assert.deepEqual(interactions.searchEvents, ['new']);
  assert.deepEqual(interactions.files, ['proof.txt']);
  assert.equal(interactions.submitted, 1);
  assert.equal(interactions.resetCount, 1);
  const regressions = await page.evaluate(async () => {
    const wrapper = document.createElement('aeliqo-form');
    const native = document.createElement('form');
    const ranges = [wrapper, native].map((form) => {
      const range = document.createElement('aeliqo-date-range');
      range.name = 'period';
      range.defaultStart = '2026-09-01';
      range.defaultEnd = '2026-09-08';
      form.append(range);
      document.body.append(form);
      return range;
    });
    const readRanges = () => [wrapper.formData(), new FormData(native)].map((data) => [...data.entries()]);
    const settleRanges = () => Promise.all(ranges.map((range) => range.updateComplete));
    await Promise.all([wrapper.updateComplete, settleRanges()]);
    const rangeInitial = readRanges();
    ranges.forEach((range) => (range.end = '2026-09-09'));
    await settleRanges();
    const rangeUpdated = readRanges();
    ranges.forEach((range) => (range.start = '2026-09-10'));
    await settleRanges();
    const rangeInvalid = readRanges();
    wrapper.reset();
    native.reset();
    await settleRanges();
    const rangeReset = readRanges();
    ranges.forEach((range) => (range.disabled = true));
    await settleRanges();
    const rangeDisabled = readRanges();
    wrapper.remove();
    native.remove();

    const number = document.createElement('aeliqo-number-field');
    number.min = '0';
    number.max = '0';
    number.step = '0.1';
    document.body.append(number);
    const zeroBounds = [];
    for (const value of ['-0', '-0.00', '0', '0.00', '-0.1', '0.1']) {
      number.value = value;
      await number.updateComplete;
      zeroBounds.push({ value: number.value, valid: number.checkValidity() });
    }
    number.remove();

    const legendForm = document.createElement('aeliqo-form');
    const legendNative = document.createElement('form');
    const legendMarkup =
      '<fieldset disabled><legend><input name="first" value="included"><aeliqo-text-field name="custom-first" default-value="included"></aeliqo-text-field></legend><legend><input name="later" value="excluded"><aeliqo-text-field name="custom-later" default-value="excluded"></aeliqo-text-field></legend><input name="body" value="excluded"><aeliqo-text-field name="custom-body" default-value="excluded"></aeliqo-text-field><fieldset disabled><legend><aeliqo-text-field name="inner-first" default-value="excluded"></aeliqo-text-field></legend></fieldset></fieldset>';
    legendForm.innerHTML = legendMarkup;
    legendNative.innerHTML = legendMarkup;
    document.body.append(legendForm, legendNative);
    await Promise.all([
      legendForm.updateComplete,
      ...[legendForm, legendNative].flatMap((form) =>
        [...form.querySelectorAll('aeliqo-text-field')].map((field) => field.updateComplete),
      ),
    ]);
    const legendEntries = [[...legendForm.formData().entries()], [...new FormData(legendNative).entries()]];
    legendForm.remove();
    legendNative.remove();

    const validation = [];
    for (const kind of ['number-field', 'date-range']) {
      for (const hostError of ['', 'Host rejected this record']) {
        const field = document.createElement('aeliqo-' + kind);
        field.start = '2026-09-01';
        field.end = '2026-09-03';
        let finish;
        let signal;
        field.validator = (_value, validationSignal) => {
          signal = validationSignal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        };
        document.body.append(field);
        await field.updateComplete;
        const input = field.shadowRoot.querySelector(kind === 'date-range' ? 'input.end' : '[part=input]');
        input.value = kind === 'date-range' ? '2026-09-04' : '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await field.updateComplete;
        field.error = hostError;
        if (kind === 'date-range') field.end = '2026-09-08';
        else field.value = '2';
        await field.updateComplete;
        finish('Old value invalid');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await field.updateComplete;
        validation.push({
          kind,
          error: field.error,
          state: field.validationState,
          valid: field.checkValidity(),
          aborted: signal.aborted,
        });
        field.remove();
      }
    }

    const summaryForm = document.createElement('aeliqo-form');
    summaryForm.id = 'installed-summary';
    summaryForm.innerHTML =
      '<aeliqo-text-field label="Required name" required></aeliqo-text-field><button type="submit">Save</button>';
    document.body.append(summaryForm);
    await summaryForm.updateComplete;
    return {
      rangeInitial,
      rangeUpdated,
      rangeInvalid,
      rangeReset,
      rangeDisabled,
      zeroBounds,
      legendEntries,
      validation,
    };
  });
  const initialRange = [
    ['period[start]', '2026-09-01'],
    ['period[end]', '2026-09-08'],
  ];
  const updatedRange = [
    ['period[start]', '2026-09-01'],
    ['period[end]', '2026-09-09'],
  ];
  assert.deepEqual(regressions, {
    rangeInitial: [initialRange, initialRange],
    rangeUpdated: [updatedRange, updatedRange],
    rangeInvalid: [[], []],
    rangeReset: [initialRange, initialRange],
    rangeDisabled: [[], []],
    zeroBounds: ['-0', '-0.00', '0', '0.00', '-0.1', '0.1'].map((value, index) => ({ value, valid: index < 4 })),
    legendEntries: [
      [
        ['first', 'included'],
        ['custom-first', 'included'],
      ],
      [
        ['first', 'included'],
        ['custom-first', 'included'],
      ],
    ],
    validation: ['number-field', 'date-range'].flatMap((kind) => [
      { kind, error: '', state: 'idle', valid: true, aborted: true },
      { kind, error: 'Host rejected this record', state: 'idle', valid: false, aborted: true },
    ]),
  });
  const summaryForm = page.locator('#installed-summary');
  for (const method of ['click', 'Enter']) {
    if (method === 'click') await summaryForm.locator('button').click();
    else await summaryForm.locator('aeliqo-text-field').locator('input').press('Enter');
    await page.waitForFunction(() => {
      const form = document.querySelector('#installed-summary');
      return form.shadowRoot.activeElement === form.shadowRoot.querySelector('[part=error-summary]');
    });
  }
  await page.evaluate(() => document.querySelector('#installed-summary').remove());
  browserReport.defaults = defaults;
  browserReport.formEntries = formData.length;
  browserReport.interactions = interactions;
  browserReport.regressions = { ...regressions, invalidSubmitSummaryFocus: ['click', 'Enter'] };
  browserReport.failures = failures;
  await page.screenshot({ path: join(runDirectory, 'installed-inputs.png'), fullPage: true });
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}

assert.equal(sourceDigest(), before, 'Source changed during input tarball consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      scope:
        'Installed @varendo/core, @varendo/web input-family entry points and @varendo/react input wrappers from actual tarballs; strict TypeScript; Node Lit SSR and React SSR; Chromium native and wrapper form parity, defaults/reset, disabled first-legend semantics, invalid submit focus, signed zero bounds, stale validation with host-error preservation, IME, controlled value/query events, search, file metadata and submit/reset.',
      artifacts: artifacts.map(({ bytes, entries, ...item }) => item),
      consumerDirectory: consumer,
      consumerLock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      resolution: resolved,
      ssr: ssrOutput,
      screenshot: {
        path: join(runDirectory, 'installed-inputs.png'),
        sha256: hash(await readFile(join(runDirectory, 'installed-inputs.png'))),
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
