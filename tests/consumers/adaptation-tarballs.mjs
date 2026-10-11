import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/** Actual published-shape package installation outside the source workspace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'artifacts/adaptation-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-adaptation-consumer-'));
const run = (args, cwd = root) => {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', timeout: 180000 });
  if (r.error || r.status !== 0) throw Error(`${args.join(' ')}\n${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const digest = () => run(['node', 'scripts/source-digest.mjs']).trim();
const before = digest();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
run(['pnpm', 'build:platform']);
const artifacts = [];
for (const name of ['core', 'runtime', 'web']) {
  const dir = join(root, 'packages', name);
  const path = join(runDirectory, `${name}.tgz`);
  run(['pnpm', 'pack', '--out', path], dir);
  const packed = JSON.parse(run(['tar', '-xOf', path, 'package/package.json']));
  assert.equal(packed.name, `@varendo/${name}`);
  assert.equal(packed.version, RELEASE_VERSION);
  assert.equal(packed.license, 'Apache-2.0');
  for (const key of ['dependencies', 'peerDependencies'])
    assert(!JSON.stringify(packed[key] ?? {}).includes('workspace:'));
  if (name === 'web') {
    assert.equal(packed.peerDependenciesMeta['@varendo/runtime'].optional, true);
    assert.equal(packed.dependencies['@varendo/runtime'], undefined);
  }
  artifacts.push({ name: packed.name, path, sha256: hash(await readFile(path)) });
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
    ...artifacts.map((a) => a.path),
    'typescript@7.0.2',
    'vite@8.2.2',
    '@types/node@24.13.3',
  ],
  consumer,
);
for (const a of artifacts) {
  const installed = join(consumer, 'node_modules', a.name);
  assert((await realpath(installed)).startsWith(await realpath(consumer)));
  for (const entry of run(['tar', '-tzf', a.path]).trim().split('\n')) {
    assert(entry.startsWith('package/') && !entry.split('/').includes('..'));
    if (entry.endsWith('/')) continue;
    const original = spawnSync('tar', ['-xOf', a.path, entry], { encoding: null });
    assert.equal(original.status, 0);
    assert.equal(hash(await readFile(join(installed, entry.slice(8)))), hash(original.stdout));
  }
}
const source = (await readFile(join(root, 'tests/adaptation-semantic/browser.ts'), 'utf8')).replace(
  "'../contracts/fixtures.js'",
  "'./fixtures.js'",
);
await writeFile(join(consumer, 'browser.ts'), source);
await writeFile(
  join(consumer, 'recipes.ts'),
  `import type {RecipeContext, RecipePresentationPolicy} from '@varendo/web';
import type {RecipePresentationPolicy as SubpathPolicy} from '@varendo/web/recipes';
import type {AeliqoAppOptions, AeliqoAppDraftExitRequest, RendererReadyReceipt} from '@varendo/web/app';
import type {RuntimeRenderOptions, RuntimePreparedRender, RuntimePresentationProjection} from '@varendo/runtime/app';
import type {RuntimeRenderPreparation as RootPreparation} from '@varendo/runtime';
const transaction = { prepare(candidate: RootPreparation) {
  void candidate.current; void candidate.outputs; void candidate.signal;
  return {ok: true as const, value: undefined};
}} satisfies RuntimeRenderOptions;
declare const prepared: RuntimePreparedRender;
const projection: RuntimePresentationProjection = prepared;
void transaction; void projection;
import type {PresentationPatternManifest, PresentationStateMappingManifest} from '@varendo/core/presentation';
declare const options: AeliqoAppOptions;
const patterns: readonly PresentationPatternManifest[] = options.patterns ?? [];
const stateMappings: readonly PresentationStateMappingManifest[] = options.stateMappings ?? [];
void patterns; void stateMappings;
type PatternContext = Parameters<PresentationPatternManifest['expand']>[0]['context'];
declare const patternContext: PatternContext;
void patternContext.incumbent?.nodes;
const hooks = {
  onDraftExit(request: AeliqoAppDraftExitRequest) { void request.signal; return {status: 'stay' as const}; },
  onPresentation(receipt: RendererReadyReceipt) { void receipt.environment; },
} satisfies Pick<AeliqoAppOptions, 'onDraftExit' | 'onPresentation'>;
void hooks;
export const policy = {allowedRepresentations: ['data.table']} satisfies RecipePresentationPolicy;
const subpathPolicy: SubpathPolicy = policy;
declare const context: RecipeContext;
void context.presentationPolicy;
void context.results;
void subpathPolicy;
`,
);
await writeFile(join(consumer, 'fixtures.ts'), await readFile(join(root, 'tests/contracts/fixtures.ts')));
await writeFile(
  join(consumer, 'registered-bar.mjs'),
  await readFile(join(root, 'tests/consumers/adaptation-registered-bar.mjs')),
);
await writeFile(join(consumer, 'index.html'), await readFile(join(root, 'tests/adaptation-semantic/index.html')));
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['browser.ts', 'fixtures.ts', 'recipes.ts', 'workspace/*.ts', 'page/*.ts'],
  }),
);
await mkdir(join(consumer, 'workspace'));
for (const name of ['index.html', 'main.ts']) {
  const content = await readFile(join(root, 'examples/vnext/workspace-goal', name), 'utf8');
  await writeFile(join(consumer, 'workspace', name), content.replace('../workspace/goal.js', './goal.js'));
}
await writeFile(join(consumer, 'workspace/goal.ts'), await readFile(join(root, 'examples/vnext/workspace/goal.ts')));
await writeFile(join(consumer, 'workspace/page.ts'), await readFile(join(root, 'examples/vnext/workspace/page.ts')));
await mkdir(join(consumer, 'page'));
for (const name of ['index.html', 'main.ts'])
  await writeFile(join(consumer, 'page', name), await readFile(join(root, 'examples/vnext/page-goal', name)));

run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
run(
  [
    'node',
    '--disallow-code-generation-from-strings',
    '--input-type=module',
    '-e',
    `import assert from 'node:assert/strict';import {measureAeliqoRegionEnvironment} from '@varendo/web/region/adaptation';import {createPresentationAdaptationController} from '@varendo/runtime/presentation';assert.equal(typeof createPresentationAdaptationController,'function');assert.equal(measureAeliqoRegionEnvironment(undefined).keyboard,'unknown');assert.equal(measureAeliqoRegionEnvironment(undefined).inlineSize.state,'unknown');`,
  ],
  consumer,
);
run(['node', '--disallow-code-generation-from-strings', 'registered-bar.mjs'], consumer);
await writeFile(
  join(consumer, 'vite.config.mjs'),
  `export default {build:{target:'es2022',rolldownOptions:{input:['index.html','workspace/index.html','page/index.html']}}};`,
);
run(['node', 'node_modules/vite/bin/vite.js', 'build'], consumer);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = resolve(consumer, 'dist', url.pathname === '/' ? 'index.html' : '.' + url.pathname);
    if (!p.startsWith(join(consumer, 'dist') + '/')) throw Error('path');
    res.setHeader(
      'content-type',
      extname(p) === '.js' ? 'text/javascript' : extname(p) === '.css' ? 'text/css' : 'text/html',
    );
    res.end(await readFile(p));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
let chromiumVersion;
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.ready === true);
  assert.equal((await page.evaluate(() => window.initial)).value.status, 'committed');
  const input = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(input).toHaveValue('Ada');
  await input.fill('Installed draft');
  assert.equal((await page.evaluate(() => window.proof.request(320))).value.status, 'deferred');
  await expect(input).toBeFocused();
  await page.locator('#outside').click();
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el) => el.direction)).toBe('column');
  await expect(input).toHaveValue('Installed draft');
  assert.equal((await page.evaluate(() => window.proof.request(900))).value.status, 'committed');
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el) => el.direction)).toBe('row');
  assert.equal(
    await page.evaluate(
      () =>
        JSON.stringify(window.proof.element.presentation.plan.preconditions) ===
        JSON.stringify(window.proof.region.snapshot().state.presentation.preconditions),
    ),
    true,
  );
  const rejectedTargets = await page.evaluate(async () => {
    const capture = () => ({
      revision: window.proof.region.snapshot().regionRevision,
      plan: JSON.stringify(window.proof.element.presentation?.plan),
    });
    const before = capture();
    const stale = await window.proof.requestWithTarget(900, 'stale');
    const afterStale = capture();
    const mismatched = await window.proof.requestWithTarget(900, 'active', 'another-surface');
    const afterMismatch = capture();
    return { before, stale, afterStale, mismatched, afterMismatch };
  });
  assert.equal(rejectedTargets.stale.ok, false);
  assert.equal(rejectedTargets.stale.diagnostics[0].code, 'presentation.target-inactive');
  assert.equal(rejectedTargets.mismatched.ok, false);
  assert.equal(rejectedTargets.mismatched.diagnostics[0].code, 'presentation.target-inactive');
  assert.deepEqual(rejectedTargets.afterStale, rejectedTargets.before);
  assert.deepEqual(rejectedTargets.afterMismatch, rejectedTargets.before);
  await page.screenshot({ path: join(runDirectory, 'installed.png'), fullPage: true });
  await page.evaluate(() => window.proof.region.revoke('revoked'));
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'e-1', exact: true })).toHaveCount(0);
  await page.goto('http://127.0.0.1:' + server.address().port + '/workspace/index.html');
  const workspace = page.getByTestId('goal-workspace');
  await expect(workspace).toHaveAttribute('data-facade', 'app.render');
  await expect(workspace).toHaveAttribute('data-node-results', 'summary:summary,trend:trend,breakdown:breakdown');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-aeliqo-node-id="summary"]')).toContainText('2');
    await expect(page.locator('[data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
  }
  await page.getByRole('button', { name: 'Fail breakdown update' }).click();
  await expect(page.getByTestId('goal-status')).toHaveText('failed:attendance.breakdown-failed');
  await expect(page.locator('[data-aeliqo-node-id="summary"]')).toContainText('2');
  await page.goto('http://127.0.0.1:' + server.address().port + '/page/index.html');
  await expect(page.locator('#status')).toContainText('renderer-ready');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('renderer-ready: workspace');
  await page.getByRole('button', { name: 'Entire page', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('renderer-ready: page');
  await expect(page.getByRole('navigation', { name: 'Registered page navigation' })).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Attendance overview', exact: true })).toBeVisible();
    await expect(page.locator('[data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
assert.equal(digest(), before, 'Source changed during consumer proof');
await writeFile(
  join(runDirectory, 'report.json'),
  JSON.stringify(
    {
      passed: true,
      sourceDigest: before,
      artifacts,
      consumerDirectory: consumer,
      scope:
        'Actual core/runtime/web tarballs, optional web runtime peer, strict public declarations, packed registered-bar manifest/config/selection/analyze proof, Node SSR measurement without code generation, production-built Chromium matching active target plus stale/mismatched target fence without stage/render, default region draft/focus/replay/revoke.',
      environment: { node: process.version, chromium: chromiumVersion },
    },
    null,
    2,
  ) + '\n',
);
console.log('Installed adaptation proof passed: ' + join(runDirectory, 'report.json'));
