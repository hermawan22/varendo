import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build, install and execute the installed navigation/feedback consumer proof.
 *
 * This deliberately installs the three published package artifacts into a
 * fresh npm consumer. It exercises direct web elements, SSR, React bindings,
 * strict declaration typing, native focus/cancel/dismiss behaviour and the
 * navigation event boundary without resolving anything from this workspace.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, unlink, rmdir, realpath } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/navigation-feedback-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'varendo-navigation-feedback-consumer-'));
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
const sourceDigest = () => run(['node', 'scripts/source-digest.mjs'], root).trim();

// Only TypeScript compiler output is removable. A symlink or an unexpected
// file fails closed so this proof cannot accidentally pack a workspace link.
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
    assert(!stat.isSymbolicLink(), `Refusing symlinked build output: ${path}`);
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

async function assertRegularTree(directory) {
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
    assert(!stat.isSymbolicLink(), `Symlink in packaged tree: ${path}`);
    if (stat.isDirectory()) await assertRegularTree(path);
  }
}

const before = sourceDigest();
const packages = [];
for (const name of ['core', 'runtime', 'web', 'react']) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.notEqual(manifest.private, true);
  const dist = join(directory, 'dist');
  await clearCompiledOutput(dist);
  run(['pnpm', 'build'], directory);
  await assertRegularTree(dist);
  const tarball = join(runDirectory, `varendo-${name}-${RELEASE_VERSION}.tgz`);
  run(['pnpm', 'pack', '--out', tarball], directory);
  const bytes = await readFile(tarball);
  const packed = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], root));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.license, 'Apache-2.0');
  assert.notEqual(packed.private, true);
  assert.deepEqual(packed.exports, manifest.exports);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert(
      !JSON.stringify(packed[field] ?? {}).includes('workspace:'),
      `${name} has a workspace dependency in ${field}`,
    );
  }
  if (name === 'web') assert.equal(packed.dependencies?.['@varendo/core'], RELEASE_VERSION);
  if (name === 'react') assert.equal(packed.dependencies?.['@varendo/web'], RELEASE_VERSION);
  const entries = run(['tar', '-tzf', tarball], root).trim().split('\n');
  assert(entries.includes('package/LICENSE'), `${name} tarball has no license`);
  assert(!entries.some((entry) => entry.startsWith('package/src/')), `${name} tarball leaked source files`);
  assert(!entries.some((entry) => entry.startsWith('package/node_modules/')), `${name} tarball contains dependencies`);
  for (const entry of entries)
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive path ${entry}`);
  packages.push({
    name: packed.name,
    version: packed.version,
    path: tarball,
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
    ...packages.map((item) => item.path),
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
for (const item of packages) {
  const location = `node_modules/${item.name}`;
  assert.equal(lock.packages[location].version, item.version);
  assert.equal(lock.packages[location].integrity, item.integrity);
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.endsWith(location)),
    [location],
    `Duplicate package resolution for ${item.name}`,
  );
  const installedRoot = join(consumer, location);
  const installedStat = await lstat(installedRoot);
  assert(
    installedStat.isDirectory() && !installedStat.isSymbolicLink(),
    `Installed package is not a real directory: ${installedRoot}`,
  );
  const entries = run(['tar', '-tzf', item.path], root).trim().split('\n');
  for (const entry of entries) {
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive path ${entry}`);
    if (entry.endsWith('/')) continue;
    const installedPath = join(installedRoot, entry.slice('package/'.length));
    const installedStat = await lstat(installedPath);
    assert(
      installedStat.isFile() && !installedStat.isSymbolicLink(),
      `Installed ${item.name} entry is not a regular file: ${entry}`,
    );
    const installed = await readFile(installedPath);
    const packed = run(['tar', '-xOf', item.path, entry], root, null);
    assert.equal(hash(installed), hash(packed), `Installed ${item.name} bytes differ for ${entry}`);
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

// Resolve every public navigation/feedback entry point from a module inside
// the temporary consumer. All results must remain under its node_modules tree.
const subpaths = [
  '@varendo/web/navigation',
  '@varendo/web/tabs',
  '@varendo/web/breadcrumb',
  '@varendo/web/pagination',
  '@varendo/web/menu',
  '@varendo/web/tree-nav',
  '@varendo/web/feedback',
  '@varendo/web/dialog',
  '@varendo/web/drawer',
  '@varendo/web/popover',
  '@varendo/web/tooltip',
  '@varendo/web/alert',
  '@varendo/web/toast',
  '@varendo/web/progress',
  '@varendo/web/skeleton',
  '@varendo/web/empty-state',
  '@varendo/react',
  '@varendo/react/ssr',
  '@varendo/web/server',
];
const consumerNodeModules = JSON.stringify(join(consumerReal, 'node_modules'));
await writeFile(
  join(consumer, 'resolution-check.mjs'),
  `
import {realpath} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const specifiers = ${JSON.stringify(subpaths)};
const resolved = {};
for (const specifier of specifiers) resolved[specifier] = await realpath(fileURLToPath(import.meta.resolve(specifier)));
const installedRoot = ${consumerNodeModules};
for (const [specifier, path] of Object.entries(resolved)) {
  if (!path.startsWith(installedRoot + "/")) throw new Error("Non-installed resolution for " + specifier + ": " + path);
}
console.log(JSON.stringify(resolved));
`,
);
const resolvedPackages = JSON.parse(run(['node', 'resolution-check.mjs'], consumer).trim().split('\n').at(-1));
assert.equal(Object.keys(resolvedPackages).length, subpaths.length);

// The consumer has no workspace source files in its graph. Vite module IDs
// are recorded so a source checkout or a pnpm link cannot hide in the proof.
await writeFile(
  join(consumer, 'consumer.tsx'),
  `
import React from "react";
import {VarendoTabs, VarendoBreadcrumb, VarendoPagination, VarendoMenu, VarendoTreeNav} from "@varendo/react/navigation";
import {VarendoDialog, VarendoDrawer, VarendoPopover, VarendoTooltip, VarendoAlert, VarendoToast, VarendoProgress, VarendoSkeleton, VarendoEmptyState} from "@varendo/react/feedback";
import type {VarendoTabItem, VarendoBreadcrumbItem, VarendoTreeNavNode} from "@varendo/web/navigation";
import type {VarendoEmptyStateKind} from "@varendo/web/empty-state";
import {createVarendoPresentationRegistry, type VarendoNavigationFeedbackBindings} from "@varendo/web/region";
const semanticBindings = {revision:"nav-1",contents:[{id:"title",text:"Navigation"}]} satisfies VarendoNavigationFeedbackBindings;
const semanticRegistry = createVarendoPresentationRegistry({navigationFeedback:semanticBindings});
void semanticRegistry;
import {VarendoTabsElement} from "@varendo/web/tabs";
import {VarendoBreadcrumbElement} from "@varendo/web/breadcrumb";
import {VarendoPaginationElement} from "@varendo/web/pagination";
import {VarendoMenuElement} from "@varendo/web/menu";
import {VarendoTreeNavElement} from "@varendo/web/tree-nav";
import {VarendoDialogElement} from "@varendo/web/dialog";
import {VarendoDrawerElement} from "@varendo/web/drawer";
import {VarendoPopoverElement} from "@varendo/web/popover";
import {VarendoTooltipElement} from "@varendo/web/tooltip";
import {VarendoAlertElement} from "@varendo/web/alert";
import {VarendoToastElement} from "@varendo/web/toast";
import {VarendoProgressElement} from "@varendo/web/progress";
import {VarendoSkeletonElement} from "@varendo/web/skeleton";
import {VarendoEmptyStateElement} from "@varendo/web/empty-state";

const tabs: readonly VarendoTabItem[] = [{id:"overview",label:"Overview",content:"Overview"}];
const crumbs: readonly VarendoBreadcrumbItem[] = [{id:"home",label:"Home",href:"/"}];
const nodes: readonly VarendoTreeNavNode[] = [{id:"root",label:"Root",children:[{id:"child",label:"Child"}]}];
const tone: "info" = "info";
const kind: VarendoEmptyStateKind = "no-records";
const typed = (
  <>
    <VarendoTabs items={tabs} onSelectionChange={event => { const id: string = event.detail.id; const source: "user" = event.detail.source; void [id, source]; }} />
    <VarendoBreadcrumb items={crumbs} onNavigate={event => { const id: string = event.detail.id; const href: string | undefined = event.detail.href; void [id, href]; }} />
    <VarendoPagination page={1} hasNext onPageChange={event => { const page: number = event.detail.page; const direction: "previous" | "next" = event.detail.direction; void [page, direction]; }} />
    <VarendoMenu items={[{id:"open",label:"Open"}]} onAction={event => { const id: string = event.detail.id; const source: "user" = event.detail.source; void [id, source]; }} />
    <VarendoTreeNav nodes={nodes} onSelectionChange={event => { const id: string = event.detail.id; void id; }} onExpand={event => { const expanded: boolean = event.detail.expanded; void expanded; }} />
    <VarendoDialog onClose={event => { const source: "user" = event.detail.source; void source; }} />
    <VarendoDrawer onClose={event => { const source: "user" = event.detail.source; void source; }} />
    <VarendoPopover onClose={event => { const source: "user" = event.detail.source; void source; }} />
    <VarendoTooltip label="Tip" />
    <VarendoAlert tone={tone} onDismiss={event => { const source: "user" = event.detail.source; void source; }} onAction={event => { const source: "user" = event.detail.source; void source; }} />
    <VarendoToast onDismiss={event => { const source: "user" = event.detail.source; void source; }} />
    <VarendoProgress value={1} />
    <VarendoSkeleton />
    <VarendoEmptyState kind={kind} onAction={event => { const received: VarendoEmptyStateKind = event.detail.kind; void received; }} />
  </>
);
void typed;
void React;
void [VarendoTabsElement,VarendoBreadcrumbElement,VarendoPaginationElement,VarendoMenuElement,VarendoTreeNavElement,VarendoDialogElement,VarendoDrawerElement,VarendoPopoverElement,VarendoTooltipElement,VarendoAlertElement,VarendoToastElement,VarendoProgressElement,VarendoSkeletonElement,VarendoEmptyStateElement];
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
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        jsx: 'react-jsx',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        noEmit: true,
        types: ['react'],
      },
      files: ['consumer.tsx'],
    },
    null,
    2,
  ) + '\n',
);
run([join(consumer, 'node_modules/.bin/tsc'), '--project', 'tsconfig.json'], consumer);

// Node SSR and React SSR are deliberately concurrent: request values must not
// bleed between templates, and importing the React binding must stay SSR-safe.
await writeFile(
  join(consumer, 'ssr-consumer.mjs'),
  `
import assert from "node:assert/strict";
import "@varendo/react/ssr";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import {html} from "lit";
import {renderVarendo} from "@varendo/web/server";
import {VarendoTabs, VarendoMenu} from "@varendo/react/navigation";
import {VarendoDialog, VarendoAlert} from "@varendo/react/feedback";
assert.equal(typeof window, "undefined");
const [first, second] = await Promise.all([
  renderVarendo(html\`<varendo-tabs .items=\${[{id:"one",label:"One",content:"First request"}]}></varendo-tabs><varendo-dialog heading="Request one"></varendo-dialog>\`),
  renderVarendo(html\`<varendo-tabs .items=\${[{id:"two",label:"Two",content:"Second request"}]}></varendo-tabs><varendo-dialog heading="Request two"></varendo-dialog>\`),
]);
assert.match(first, /First request/); assert.match(first, /Request one/); assert.doesNotMatch(first, /Second request|Request two/);
assert.match(second, /Second request/); assert.match(second, /Request two/); assert.doesNotMatch(second, /First request|Request one/);
const markup = renderToString(createElement("section", null,
  createElement(VarendoTabs, {items: [{id:"ssr", label:"SSR", content:"React tabs"}]}),
  createElement(VarendoDialog, {heading: "React dialog"}),
  createElement(VarendoAlert, {heading: "React alert", message: "React alert body"}),
  createElement(VarendoMenu, {items: [{id:"item", label:"React menu"}]}),
));
for (const tag of ["varendo-tabs", "varendo-dialog", "varendo-alert", "varendo-menu"]) assert.match(markup, new RegExp(tag));
assert.match(markup, /shadowrootmode="open"/);
assert.match(markup, /React alert body/);
const secondReactRequest = renderToString(createElement(VarendoAlert, {heading: "Second React request", message: "Second body"}));
assert.match(secondReactRequest, /Second body/);
assert.doesNotMatch(secondReactRequest, /React alert body|React dialog/);
console.log(JSON.stringify({firstBytes:first.length, secondBytes:second.length, reactBytes:markup.length, secondReactBytes:secondReactRequest.length}));
`,
);
const ssrReport = JSON.parse(run(['node', 'ssr-consumer.mjs'], consumer).trim().split('\n').at(-1));

await writeFile(
  join(consumer, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Installed navigation and feedback</title></head><body><main><button id="outside" type="button">Outside</button><varendo-tabs id="tabs"></varendo-tabs><varendo-breadcrumb id="breadcrumb"></varendo-breadcrumb><varendo-pagination id="pagination"></varendo-pagination><varendo-menu id="menu"></varendo-menu><varendo-tree-nav id="tree"></varendo-tree-nav><varendo-dialog id="dialog"></varendo-dialog><varendo-popover id="popover"></varendo-popover><varendo-drawer id="drawer"></varendo-drawer><varendo-tooltip id="tooltip"></varendo-tooltip><varendo-alert id="alert"></varendo-alert><varendo-toast id="toast"></varendo-toast><varendo-progress id="progress"></varendo-progress><varendo-skeleton id="skeleton"></varendo-skeleton><varendo-empty-state id="empty"></varendo-empty-state></main><script type="module" src="/browser.js"></script></body></html>\n`,
);
await writeFile(
  join(consumer, 'browser.js'),
  `
import {registerVarendoElements} from "@varendo/web/register";
registerVarendoElements();
const byId = id => document.getElementById(id);
const tabs = byId("tabs"); tabs.items = [{id:"overview",label:"Overview",content:"Overview panel"},{id:"details",label:"Details",content:"Details panel"}];
const breadcrumb = byId("breadcrumb"); breadcrumb.items = [{id:"home",label:"Home",href:"/home"},{id:"current",label:"Current",current:true}];
const pagination = byId("pagination"); pagination.page = 2; pagination.hasPrevious = true; pagination.hasNext = true; pagination.pageCount = 4;
const menu = byId("menu"); menu.items = [{id:"first",label:"First"},{id:"second",label:"Second"}];
const tree = byId("tree"); tree.nodes = [{id:"root",label:"Root",children:[{id:"child",label:"Child"}]},{id:"other",label:"Other"}]; tree.expandedIds = ["root"];
const dialog = byId("dialog"); dialog.heading = "Confirm"; dialog.open = false;
const popover = byId("popover"); popover.label = "Open popover"; popover.content = "Popover content"; popover.modal = true;
const drawer = byId("drawer"); drawer.heading = "Details"; drawer.mode = "modal";
const tooltip = byId("tooltip"); tooltip.label = "Help"; tooltip.content = "Tooltip content";
const alert = byId("alert"); alert.heading = "Notice"; alert.message = "Alert message"; alert.dismissible = true;
const toast = byId("toast"); toast.message = "Toast message"; toast.duration = 0; toast.open = true;
const progress = byId("progress"); progress.value = 40; progress.label = "Loading";
const skeleton = byId("skeleton"); skeleton.lines = 2; skeleton.animated = false;
const empty = byId("empty"); empty.heading = "No rows"; empty.message = "Nothing matched"; empty.actionLabel = "Retry";
const events = [];
for (const [element, type] of [[tabs,"varendo-tabs-change"],[breadcrumb,"varendo-navigation"],[pagination,"varendo-page-change"],[menu,"varendo-menu-action"],[tree,"varendo-tree-nav-select"],[tree,"varendo-tree-nav-expand"],[dialog,"varendo-dialog-close"],[popover,"varendo-popover-close"],[drawer,"varendo-drawer-close"],[alert,"varendo-alert-dismiss"],[toast,"varendo-toast-dismiss"],[empty,"varendo-empty-state-action"]]) element.addEventListener(type, event => { events.push({type, detail:event.detail}); if (type === "varendo-navigation") event.preventDefault(); });
window.fixture = {tabs, breadcrumb, pagination, menu, tree, dialog, popover, drawer, tooltip, alert, toast, progress, skeleton, empty, events};
`,
);
await writeFile(
  join(consumer, 'vite.config.mjs'),
  `
export default {build: {minify: true, rollupOptions: {output: {assetFileNames: "assets/[name]-[hash][extname]"}}, plugins: []}, plugins: [{name: "record-modules", generateBundle(_, bundle) { const modules = Object.values(bundle).filter(item => item.type === "chunk").flatMap(item => Object.keys(item.modules)); this.emitFile({type: "asset", fileName: "modules.json", source: JSON.stringify(modules)}); }}]};
`,
);
run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
const modules = JSON.parse(await readFile(join(consumer, 'dist/modules.json'), 'utf8'));
for (const module of modules) {
  assert(
    !module.includes('/packages/') && !module.includes('/workspace/'),
    `Bundle resolved workspace source: ${module}`,
  );
  if (module.includes('@varendo/'))
    assert(module.startsWith(consumerReal + '/node_modules/'), `Bundle resolved outside installed consumer: ${module}`);
}
const browserBundles = [];
for (const file of await readdir(join(consumer, 'dist/assets'))) {
  if (!file.endsWith('.js')) continue;
  const bytes = await readFile(join(consumer, 'dist/assets', file));
  browserBundles.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}

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
await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
let browser;
let chromiumVersion;
let browserReport = {};
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', deviceScaleFactor: 1 });
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
  await page.locator('varendo-tabs').evaluate((element) => customElements.whenDefined(element.localName));
  const tabs = page.locator('varendo-tabs');
  const tabButtons = tabs.locator('[role=tab]');
  await tabButtons.first().waitFor();
  assert.equal((await tabs.locator('[role=tabpanel]:not([hidden])').textContent()).trim(), 'Overview panel');
  await tabButtons.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await tabButtons.nth(1).getAttribute('aria-selected'), 'true');
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some(
      (event) => event.type === 'varendo-tabs-change' && event.detail.id === 'details',
    ),
    true,
  );

  const menu = page.locator('varendo-menu');
  const menuTrigger = menu.locator('[part=trigger]');
  await menuTrigger.focus();
  await menuTrigger.click();
  const menuItem = menu.locator('[role=menuitem]').first();
  await menuItem.waitFor();
  await menuItem.focus();
  assert.equal(await menuItem.evaluate((element) => element.getRootNode().activeElement === element), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('varendo-menu').open);
  await page.waitForFunction(() => {
    const host = document.querySelector('varendo-menu');
    const trigger = host?.shadowRoot?.querySelector('[part=trigger]');
    return host?.shadowRoot?.activeElement === trigger;
  });
  assert.equal(await menuTrigger.evaluate((element) => element.getRootNode().activeElement === element), true);
  await menuTrigger.click();
  await menuItem.waitFor();
  await page.getByRole('button', { name: 'Outside' }).click();
  assert.equal(await menu.locator('[part=menu]').getAttribute('hidden'), '');

  const tree = page.locator('varendo-tree-nav');
  const rootItem = tree.locator('[role=treeitem][data-tree-id=root]');
  await rootItem.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await tree
      .locator('[role=treeitem][data-tree-id=child]')
      .evaluate((element) => element.getRootNode().activeElement === element),
    true,
  );
  await page.keyboard.press('Enter');
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some(
      (event) => event.type === 'varendo-tree-nav-select' && event.detail.id === 'child',
    ),
    true,
  );

  const pagination = page.locator('varendo-pagination');
  await pagination.getByRole('button', { name: 'Next page' }).click();
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some(
      (event) => event.type === 'varendo-page-change' && event.detail.page === 3,
    ),
    true,
  );
  await page.locator('varendo-breadcrumb').getByRole('link', { name: 'Home' }).click();
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some(
      (event) => event.type === 'varendo-navigation' && event.detail.id === 'home',
    ),
    true,
  );

  const dialog = page.locator('varendo-dialog');
  const dialogHost = dialog;
  await page.locator('#outside').focus();
  await dialogHost.evaluate((element) => {
    element.open = true;
  });
  await dialogHost.locator('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('varendo-dialog').open);
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some((event) => event.type === 'varendo-dialog-close'),
    true,
  );
  assert.equal(await page.locator('#outside').evaluate((element) => document.activeElement === element), true);

  const popover = page.locator('varendo-popover');
  await popover.locator('[part=trigger]').click();
  await popover.locator('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('varendo-popover').open);
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some((event) => event.type === 'varendo-popover-close'),
    true,
  );

  const drawer = page.locator('varendo-drawer');
  await drawer.evaluate((element) => {
    element.open = true;
  });
  await drawer.locator('dialog').waitFor();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => !document.querySelector('varendo-drawer').open);
  assert.equal(
    (await page.evaluate(() => window.fixture.events)).some((event) => event.type === 'varendo-drawer-close'),
    true,
  );

  await page.locator('varendo-alert').getByRole('button', { name: 'Dismiss' }).click();
  await page.locator('varendo-toast').getByRole('button', { name: 'Dismiss' }).click();
  await page.locator('varendo-empty-state').getByRole('button', { name: 'Retry' }).click();
  const eventTypes = await page.evaluate(() => window.fixture.events.map((event) => event.type));
  assert(eventTypes.includes('varendo-alert-dismiss'));
  assert(eventTypes.includes('varendo-toast-dismiss'));
  assert(eventTypes.includes('varendo-empty-state-action'));
  await page.locator('varendo-tooltip').locator('[part=trigger]').focus();
  assert.equal(await page.locator('varendo-tooltip').locator('[role=tooltip]').getAttribute('hidden'), null);
  assert.equal(await page.locator('varendo-progress').locator('progress').getAttribute('aria-label'), 'Loading');
  assert.equal(await page.locator('varendo-skeleton').locator('[part=line]').count(), 2);
  assert.equal(await page.locator('varendo-empty-state').locator('[role=status]').count(), 1);
  assert.deepEqual(failures, []);
  browserReport = {
    tabsSelection: true,
    menuFocusRestored: true,
    treeKeyboardSelection: true,
    paginationEvent: true,
    breadcrumbEvent: true,
    dialogEscapeCancel: true,
    popoverEscapeDismiss: true,
    drawerClose: true,
    feedbackEvents: eventTypes,
    failures,
  };
  await page.screenshot({ path: join(runDirectory, 'navigation-feedback-installed.png'), fullPage: true });
} finally {
  await browser?.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

assert.equal(sourceDigest(), before, 'Source changed during navigation/feedback tarball consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      sourceDigest: before,
      sourceChangedDuringRun: false,
      passed: true,
      scope:
        'Installed @varendo/core, @varendo/web and @varendo/react tarballs; public navigation and feedback subpath resolution; strict React event declarations; concurrent Lit/React SSR isolation; Chromium focus, keyboard navigation, dismiss and cancel behavior.',
      artifacts: packages.map(({ entries, ...item }) => item),
      consumerDirectory: consumer,
      consumerLock: { path: join(runDirectory, 'consumer-package-lock.json'), sha256: hash(lockBytes) },
      resolution: resolvedPackages,
      ssr: ssrReport,
      browser: browserReport,
      browserBundles,
      standaloneModules: modules,
      environment: {
        node: process.version,
        npm: run(['npm', '--version'], consumer).trim(),
        pnpm: run(['pnpm', '--version'], root).trim(),
        typescript: '7.0.2',
        vite: '8.2.2',
        playwright: JSON.parse(await readFile(join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
          .version,
        chromium: chromiumVersion,
        os: platform(),
        release: release(),
        arch: arch(),
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
        deviceScaleFactor: 1,
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`Installed navigation/feedback consumer proof passed. Evidence: ${join(runDirectory, 'report.json')}`);
