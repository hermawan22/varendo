import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/**
 * Build,
  install and execute the agent boundary from actual package tarballs
 * outside the pnpm workspace. This is a bounded consumer proof for the
 * installed core/runtime/agent graph; it does not certify every adapter or host.
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
const output = join(root, 'artifacts/agent-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'varendo-agent-consumer-'));
const consumerReal = await realpath(consumer);

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
  ['agent', RELEASE_VERSION],
]) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, `@varendo/${name}`);
  assert.equal(manifest.version, version);
  assert.notEqual(manifest.private, true);
  run(['pnpm', 'build'], directory);
}

const packages = [];
for (const name of ['core', 'runtime', 'agent']) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const tarball = join(runDirectory, `varendo-${name}-${RELEASE_VERSION}.tgz`);
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
    'zod@4.5.4',
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
  zod: '4.5.4',
})) {
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
  assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
}
assert.equal(lock.packages['node_modules/@varendo/runtime'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.equal(lock.packages['node_modules/@varendo/agent'].dependencies['@varendo/core'], RELEASE_VERSION);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/runtime/node_modules/')),
  [],
);
assert.deepEqual(
  Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/@varendo/agent/node_modules/')),
  [],
);
await writeFile(join(runDirectory, 'consumer-package-lock.json'), lockBytes);

const fixture = await import('../contracts/fixtures.ts');
const compositionFixture = {
  plan: fixture.presentationPlan,
  task: fixture.presentationTask,
  result: fixture.result,
  experience: fixture.experience,
  environment: fixture.environment,
};
const probe = `
import { VARENDO_AGENT_INSTRUCTIONS, createAppToolEndpoint, createAppToolSession } from '@varendo/agent';
import { createAppToolSession as createSessionFromApp } from '@varendo/agent/app';
import {
  createAgentCapabilityDispatcher,
  createAgentCapabilityRegistry,
  createAgentCompositionRegistry,
  validateAgentComposition,
} from '@varendo/agent/capabilities';
import { createAgentSession } from '@varendo/agent/session';
import { defineResource, parseWireValue } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { validatePresentationPlan } from '@varendo/core/presentation';
import { createVarendoRuntime } from '@varendo/runtime/app';
import { createLocalDataService } from '@varendo/runtime/data';
import { z } from 'zod';

export async function probe() {
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  const people = defineResource({
    id: 'people',
    label: 'People',
    description: 'People directory',
    revision: '1',
    identity: ['id'],
    schema: z.object({ id: z.string(), name: z.string(), team: z.enum(['Platform', 'Research']) }),
    fields: { team: { role: 'dimension' } },
    presentation: { allowedViews: ['table', 'cards'] },
  });
  const functions = createQueryFunctionRegistry({ version: '2' });
  check(functions.ok, 'query registry');
  const data = createLocalDataService({
    snapshot: {
      catalog: people.catalog,
      sourceRevision: 'people-1',
      records: { people: [{ id: 'p-1', name: 'Ada', team: 'Platform' }] },
    },
    functionRegistry: functions.value,
    authorize: () => ({ ok: true, value: { scopeDigest: 'scope-1', policyRevision: 'policy-1' } }),
  });
  const runtime = createVarendoRuntime({
    resources: [{ resource: people, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'person-1',
          scopeDigest: 'scope-1',
          policyRevision: 'policy-1',
          experienceRevision: 'experience-1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect', 'experience.commit', 'action.propose'],
          readContext: { principal: 'person-1' },
        },
      }),
    },
  });
  const mounted = runtime.mount({ regionId: 'main', resourceId: 'people' });
  check(mounted.ok, 'runtime mount');
  const contextMetadata = {
    customIntents: [{ ref: { id: 'people.overview', revision: '1' }, inputSchema: { type: 'object' } }],
    patterns: [{ ref: { id: 'people.overview-pattern', revision: '1' }, intent: { id: 'people.overview', revision: '1' }, outputs: ['summary'] }],
    queryConstraint: {
      interpretation: 'One approved local day.',
      requiredFilter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Platform' },
      supportedPeriod: {
        from: '2026-09-01T00:00:00+07:00',
        toExclusive: '2026-09-02T00:00:00+07:00',
        calendar: 'gregorian',
        timezone: 'Asia/Jakarta',
        interpretation: 'One approved local day.',
      },
    },
  };
  const endpoint = createAppToolEndpoint({
    runtime,
    regionId: 'main',
    goalEpoch: 'goal-app',
    transport: 'manual',
    expiresAt: Date.now() + 60_000,
    context: {
      read() {
        const current = runtime.contexts('main');
        if (!current.ok) return current;
        return { ok: true, value: current.value.map((resource) => ({ ...resource, ...contextMetadata })) };
      },
    },
  });
  check(endpoint.ok, 'app endpoint');
  const tools = await endpoint.value.discover();
  check(
    tools.ok && tools.value.map((tool) => tool.name).join(',') === 'varendo_context,varendo_render,varendo_act',
    'bounded app tool discovery',
  );
  const context = await endpoint.value.invoke('varendo_context', {}, { requestId: 'context' });
  check(context.ok && context.value.state === 'accepted', 'context capability');
  check(context.value.value.activeResource === 'people', 'paired resource context');
  check(JSON.stringify(context.value.value.resources[0].customIntents) === JSON.stringify(contextMetadata.customIntents), 'installed custom-intent metadata');
  check(JSON.stringify(context.value.value.resources[0].patterns) === JSON.stringify(contextMetadata.patterns), 'installed pattern metadata');
  check(JSON.stringify(context.value.value.resources[0].queryConstraint) === JSON.stringify(contextMetadata.queryConstraint), 'installed query-constraint metadata');
  check(!JSON.stringify(context).includes('principalKey'), 'private authority stays out of context');
  check(Array.isArray(context.value.value.resources[0].examples) && context.value.value.resources[0].examples[0].kind === 'browse', 'installed context examples');
  check(JSON.stringify(context.value.value.timeGrains) === JSON.stringify(['day', 'week', 'month', 'quarter', 'year']), 'installed time grains');
  const renderTool = tools.value.find((tool) => tool.name === 'varendo_render');
  check(renderTool.description.includes('varendo_context') && !JSON.stringify(renderTool.inputSchema.oneOf[0].required).includes('version'), 'installed agent-friendly render tool');
  check(VARENDO_AGENT_INSTRUCTIONS.includes('varendo_context'), 'installed recommended agent instructions');
  endpoint.value.close();
  check(createSessionFromApp === createAppToolSession, 'root/app session export parity');
  const appSession = createAppToolSession({ runtime, regionId: 'main', goalEpoch: 'host-session', transport: 'manual', expiresAt: Date.now() + 60_000 });
  check(appSession.ok, 'host-owned application session');
  const borrowed = appSession.value.createEndpoint({ principalKey: 'person-1', scopeDigest: 'scope-1' });
  check(borrowed.ok, 'borrowed endpoint');
  borrowed.value.close();
  const fresh = appSession.value.createEndpoint({ principalKey: 'person-1', scopeDigest: 'scope-1' });
  check(fresh.ok && (await fresh.value.discover()).ok, 'fresh endpoint survives earlier close');
  appSession.value.close();
  check(!appSession.value.createEndpoint({ principalKey: 'person-1', scopeDigest: 'scope-1' }).ok && !(await fresh.value.discover()).ok, 'host close fences borrowed endpoints');
  runtime.dispose();

  const inspected = {
    ref: { id: 'result.inspect', revision: '1' },
    operation: 'result.inspect',
    label: 'Inspect results',
    parse: (input) => parseWireValue(input),
    invoke: () => ({ state: 'data-ready', value: { rows: [{ id: 'private-row' }] } }),
  };
  const registry = createAgentCapabilityRegistry([inspected]);
  check(registry.ok, 'capability registry');
  const dispatcher = createAgentCapabilityDispatcher({
    registry: registry.value,
    host: {
      readContext: () => ({
        ok: true,
        value: { principalKey: 'person-1', regionId: 'main', goalEpoch: 'goal-cap', grants: ['result.inspect'] },
      }),
    },
  });
  const request = {
    version: '1',
    requestId: 'direct',
    targetRegionId: 'main',
    goalEpoch: 'goal-cap',
    capability: inspected.ref,
    operation: 'result.inspect',
    input: {},
  };
  const direct = await dispatcher.direct.invoke(request);
  const manual = await dispatcher.manual.invoke({ ...request, requestId: 'manual' });
  check(direct.ok && direct.value.state === 'data-ready', 'direct capability dispatch');
  check(manual.ok && manual.value.state === 'data-ready', 'manual capability dispatch');
  check(JSON.stringify(direct.value.value) === JSON.stringify(manual.value.value), 'direct/manual parity');
  const external = await dispatcher.mcp.invoke({ ...request, requestId: 'mcp', transport: 'direct' });
  check(
    external.ok && external.value.state === 'denied' && external.value.value === undefined,
    'model egress is denied without host grant',
  );
  const session = createAgentSession({ dispatcher, transport: 'mcp' });
  const sessionResult = await session.run({
    request: { ...request, requestId: 'session', transport: 'manual' },
    budget: { maxTurns: 2, maxRepairs: 1, maxMilliseconds: 1_000, maxProposalBytes: 4_096 },
  });
  check(
    sessionResult.ok && sessionResult.value.stop === 'denied' && sessionResult.value.transport === 'mcp',
    'trusted session transport overrides request metadata',
  );
  check(sessionResult.ok && sessionResult.value.last?.value === undefined, 'denied session output is cleared');
  session.dispose();
  check(session.inspect().status === 'closed', 'session closes cleanly');

  const fx=${JSON.stringify(compositionFixture)};
  const read={id:'data.read',revision:'1'};
  const view={ref:{id:'data.table',revision:'1'},
    configSchema:{id:'data.table.config',revision:'1'},
    roles:['table'],operations:[read],result:'required',children:{min:0,max:0},
    visibility:'leaf',extension:false,
    resolveConfig:(values,result)=>Object.keys(values).length===0&&result
      ?{ok:true,value:{values:{},fields:result.fields.map(field=>field.id),ports:[]}}
      :{ok:false,diagnostics:[{code:'config.invalid',message:'Invalid config.',retryable:false}]}};
  const viewRegistry=createAgentCompositionRegistry([view]);
  check(viewRegistry.ok,'canonical view registry');
  const viewContext={task:{...fx.task,needs:[{id:'browse',operation:read,fields:['employee.id'],outputId:'rows',required:true}]},
    experience:{...fx.experience,mode:'composable',allowedRepresentations:['data.table']},
    results:[fx.result],current:fx.plan.preconditions,environment:fx.environment,rendererCapabilities:[view.ref]};
  const viewPlan={...fx.plan,coverage:[{needId:'browse',nodeIds:['table-1'],operations:[read]}]};
  const agentView=validateAgentComposition(viewPlan,viewRegistry.value,viewContext);
  const manualView=validatePresentationPlan(viewPlan,viewContext,viewRegistry.value);
  check(agentView.ok&&manualView.ok&&JSON.stringify(agentView.value.plan)===JSON.stringify(manualView.value.plan),
    'canonical composition parity');
  check(!validateAgentComposition({...viewPlan,coverage:[]},viewRegistry.value,viewContext).ok,
    'agent cannot omit required coverage');
  check(!validateAgentComposition(viewPlan,viewRegistry.value,{...viewContext,results:[]}).ok,
    'agent cannot invent authorized descriptor');
  return {appEndpoint:true,appToolSession:true,capabilityParity:true,trustedSessionTransport:true,externalEgress:true,
    canonicalCompositionParity:true};
}
`;
await writeFile(join(consumer, 'probe.mjs'), probe);
await writeFile(
  join(consumer, 'node.mjs'),
  `import {probe} from './probe.mjs'; import {realpath} from 'node:fs/promises'; import {fileURLToPath} from 'node:url';
for(const specifier of ['@varendo/core',
  '@varendo/core/agent',
  '@varendo/core/expressions',
  '@varendo/core/presentation',
  '@varendo/runtime/app',
  '@varendo/runtime/data',
  '@varendo/runtime/results',
  '@varendo/agent',
  '@varendo/agent/app',
  '@varendo/agent/capabilities',
  '@varendo/agent/session',
  '@varendo/agent/model']){const path=await realpath(fileURLToPath(import.meta.resolve(specifier)));if(!path.startsWith(${JSON.stringify(consumerReal)}+'/node_modules/'))throw Error('Non-installed resolution');}
console.log(JSON.stringify(await probe()));
`,
);
const nodeReport = JSON.parse(run(['node', '--disallow-code-generation-from-strings', 'node.mjs'], consumer).trim());
await writeFile(
  join(consumer, 'consumer.ts'),
  `import { createAppToolEndpoint, createAppToolSession, type VarendoAppToolSession } from '@varendo/agent';
import { createAppToolSession as createSessionFromApp } from '@varendo/agent/app';
import { createAgentCapabilityRegistry, type AgentCapabilityDispatcher } from '@varendo/agent/capabilities';
import { createAgentSession } from '@varendo/agent/session';
import type { OperationGrant } from '@varendo/core/agent';
import type { VarendoRuntime } from '@varendo/runtime/app';
declare const runtime: VarendoRuntime;
const endpoint = createAppToolEndpoint({ runtime, regionId: 'main', goalEpoch: 'goal', transport: 'manual', expiresAt: Date.now() + 60_000 });
void endpoint;
const appSession = createAppToolSession({ runtime, regionId: 'main', goalEpoch: 'goal', transport: 'manual', expiresAt: Date.now() + 60_000 });
if (appSession.ok) { const typed: VarendoAppToolSession = appSession.value; void typed.createEndpoint({ principalKey: 'person-1', scopeDigest: 'scope-1' }); typed.close(); }
void createSessionFromApp;
// @ts-expect-error Model quality does not create an act grant.
const invalid:OperationGrant='act';void invalid;
declare const dispatcher: AgentCapabilityDispatcher;
const session = createAgentSession({ dispatcher, transport: 'mcp' });
void session;
const emptyRegistry = createAgentCapabilityRegistry([]);
void emptyRegistry;
// @ts-expect-error Trust cannot be selected by an arbitrary transport label.
createAgentSession({dispatcher,transport:'trusted-ai'});
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
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['consumer.ts'],
  }),
);
run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
await writeFile(
  join(consumer, 'index.html'),
  '<div id="status">Running</div><script type="module" src="/browser.mjs"></script>',
);
await writeFile(
  join(consumer, 'browser.mjs'),
  `import {createOpaqueModelSecret} from '@varendo/agent/model';import {probe} from './probe.mjs';let trustedEnvironmentRequired=false;try{createOpaqueModelSecret('synthetic-browser-value');}catch{trustedEnvironmentRequired=true;}window.agentReport={...await probe(),trustedEnvironmentRequired};document.querySelector('#status').textContent='Passed';`,
);
await writeFile(join(consumer, 'vite.config.mjs'), `export default {build:{target:'es2022'}};`);
const browserSecretSentinel = 'synthetic-browser-bundle-secret-sentinel';
run(['node', 'node_modules/vite/bin/vite.js', 'build'], consumer, 'utf8', {
  ...process.env,
  VARENDO_BROWSER_SECRET_SENTINEL: browserSecretSentinel,
});
for (const relative of await readdir(join(consumer, 'dist'), { recursive: true })) {
  const path = join(consumer, 'dist', relative);
  if (!(await lstat(path)).isFile()) continue;
  assert(
    !String(await readFile(path)).includes(browserSecretSentinel),
    'Browser build captured an unrelated host credential value',
  );
}
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
let browser;
let chromiumVersion;
let browserReport;
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Passed');
  browserReport = await page.evaluate(() => window.agentReport);
  const { trustedEnvironmentRequired, ...sharedBrowserReport } = browserReport;
  assert.equal(trustedEnvironmentRequired, true);
  assert.deepEqual(sharedBrowserReport, nodeReport);
  assert.deepEqual(errors, []);
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
        'Installed core/runtime/agent app endpoint, capability dispatch and composition subpaths; direct/manual parity, trusted session transport, model egress rejection, strict declarations, Node without code generation, and Chromium browser bundling.',
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
console.log('Installed agent public API consumer passed. Evidence: ' + join(runDirectory, 'report.json'));
