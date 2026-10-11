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
const output = join(root, 'artifacts/protocol-consumers');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-protocol-consumer-'));
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
    'openai@7.10.0',
    'zod@4.5.4',
    '@modelcontextprotocol/server@2.0.0',
    '@modelcontextprotocol/client@2.2.0',
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
  zod: '4.5.4',
  typescript: '7.0.2',
  vite: '8.2.2',
  '@playwright/test': '1.63.0',
  '@types/node': '24.13.3',
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

const probe = `
import {parseWireValue,
} from '@varendo/core';
import {createAgentCapabilityRegistry} from '@varendo/agent/capabilities';
import {createAgentToolEndpoint} from '@varendo/agent/protocol';
import {runToolModel} from '@varendo/agent/model';
import {createWebMcpAdapter} from '@varendo/agent/webmcp';
export function fixture(transport='manual') {
 const registry=createAgentCapabilityRegistry([{ref:{id:'summary',revision:'1'},label:'Summary',operation:'catalog.read',parse:parseWireValue,invoke:()=>({state:'data-ready',value:{count:2}})}]);
 if(!registry.ok)throw Error('registry');
 const made=createAgentToolEndpoint({transport,targetRegionId:'region',goalEpoch:'goal',principalKey:'owner',expiresAt:Date.now()+60000,registry:registry.value,tools:[{name:'summary',capability:{id:'summary',revision:'1'},operation:'catalog.read',inputSchema:{type:'object'}}],host:{readContext:()=>({ok:true,value:{principalKey:'owner',regionId:'region',goalEpoch:'goal',grants:['catalog.read','model.egress']}})}});
 if(!made.ok)throw Error('endpoint');return made.value;
}
export async function probe(){
 const assert=(v,m)=>{if(!v)throw Error(m);};
 const manual=fixture(); const direct=await manual.invoke('summary',{}, {requestId:'manual'});assert(direct.ok,'manual');
 let nativeTool;const web=fixture('webmcp'); const adapter=createWebMcpAdapter({endpoint:web,modelContext:{registerTool(tool){nativeTool=tool;}}});
 const registration=await adapter.register();assert(registration.ok&&adapter.evidence==='simulated','simulated registration');
 const viaWeb=await nativeTool.execute({}, {signal:new AbortController().signal});assert(viaWeb.ok&&JSON.stringify(viaWeb.value.value)===JSON.stringify(direct.value.value),'WebMCP parity');
 adapter.close();assert(!(await nativeTool.execute({})).ok,'late WebMCP invocation');
 const byok=fixture('byok');let turn=0;
 const run=await runToolModel({requestId:'model',goal:'chat',prompt:'Read summary',endpoint:byok,model:{countInputTokens:async()=>10,complete:async()=>({text:'Draft',calls:++turn===1?[{id:'call',name:'summary',input:{}}]:[],usage:{inputTokens:10,outputTokens:5}})},budget:{maxTurns:3,maxModelRequests:6,maxToolCalls:3,maxMilliseconds:5000,maxInputTokens:1000,maxOutputTokens:100,maxTotalTokens:2000,maxInputBytes:100000,maxOutputBytes:10000,maxRepeatedCalls:1}});
 assert(run.ok&&run.value.stop==='text-ready'&&JSON.stringify(run.value.receipts[0]?.value)===JSON.stringify(direct.value.value),'BYOK real dispatcher parity');
 manual.close();byok.close();return {manual:true,webmcpSimulated:true,byokSynthetic:true,sharedDispatcher:true,lateCallDenied:true};
}
`;
await writeFile(join(consumer, 'probe.mjs'), probe);
await writeFile(
  join(consumer, 'stdio.mjs'),
  `import {fixture} from './probe.mjs';import {createMcpStdioServer} from '@varendo/agent/mcp';createMcpStdioServer({createEndpoint:()=>fixture('mcp')});`,
);
await writeFile(
  join(consumer, 'node.mjs'),
  `
import {probe} from './probe.mjs';import {realpath} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {connectMcpStdioClient} from '@varendo/agent/mcp';import {createOpenAIToolModel} from '@varendo/agent/model/openai';
for(const specifier of ['@varendo/core','@varendo/agent','@varendo/agent/protocol','@varendo/agent/model','@varendo/agent/mcp','@varendo/agent/webmcp','@varendo/agent/model/openai']){const path=await realpath(fileURLToPath(import.meta.resolve(specifier)));if(!path.startsWith(${JSON.stringify(consumerReal)}+'/node_modules/'))throw Error('Non-installed resolution');}
const result=await probe();const client=await connectMcpStdioClient({targetRegionId:'region',goalEpoch:'goal',server:{command:process.execPath,args:[fileURLToPath(new URL('./stdio.mjs',import.meta.url))],stderr:'pipe'}});
try{const tools=await client.discover();const receipt=await client.invoke('summary',{}, {requestId:'stdio'});if(!tools.ok||!receipt.ok||receipt.value.value?.count!==2)throw Error('Installed actual MCP failed');}finally{client.close();}
if(typeof createOpenAIToolModel!=='function')throw Error('Official SDK entry');console.log(JSON.stringify({...result,mcpActualStdio:true,officialProviderEntry:true}));
`,
);
const nodeReport = JSON.parse(run(['node', '--disallow-code-generation-from-strings', 'node.mjs'], consumer).trim());
await writeFile(
  join(consumer, 'consumer.ts'),
  `import {createAgentToolEndpoint,type AgentToolEndpointOptions} from '@varendo/agent/protocol';import {runToolModel,type ToolModelPort,type ToolModelLoopOptions} from '@varendo/agent/model';import {createMcpHttpHandler,type McpHttpServerOptions} from '@varendo/agent/mcp';import {createWebMcpAdapter,type WebMcpAdapterOptions} from '@varendo/agent/webmcp';import {createOpenAIToolModel,type OpenAIToolModelOptions} from '@varendo/agent/model/openai';
declare const endpoint:AgentToolEndpointOptions;createAgentToolEndpoint(endpoint);declare const loop:ToolModelLoopOptions;await runToolModel(loop);declare const http:McpHttpServerOptions;createMcpHttpHandler(http);declare const web:WebMcpAdapterOptions;createWebMcpAdapter(web);declare const provider:OpenAIToolModelOptions;createOpenAIToolModel(provider);
// @ts-expect-error The model cannot assign itself authority.
const invalid:ToolModelPort={approved:true};void invalid;
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
      types: ['node'],
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
  `import {probe} from './probe.mjs';window.protocolReport=await probe();document.querySelector('#status').textContent='Passed';`,
);
await writeFile(join(consumer, 'vite.config.mjs'), `export default {build:{target:'es2022',sourcemap:true}};`);
run(['node', 'node_modules/vite/bin/vite.js', 'build'], consumer);
for (const name of await readdir(join(consumer, 'dist/assets'))) {
  if (name.endsWith('.map')) {
    const map = JSON.parse(await readFile(join(consumer, 'dist/assets', name), 'utf8'));
    assert(
      !map.sources.some((source) => /node_modules\/(openai|@modelcontextprotocol)/u.test(source)),
      'Provider SDK entered browser graph',
    );
  }
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
  browserReport = await page.evaluate(() => window.protocolReport);
  assert.deepEqual(browserReport, {
    manual: true,
    webmcpSimulated: true,
    byokSynthetic: true,
    sharedDispatcher: true,
    lateCallDenied: true,
  });
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
        'Installed protocol/model/MCP/WebMCP entries; actual SDK stdio, synthetic BYOK and simulated WebMCP through real dispatcher; official OpenAI entry import; strict declarations; Node and Chromium; provider SDK excluded from browser graph. No live provider or native WebMCP claim.',
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
console.log('Installed protocol consumer passed. Evidence: ' + join(runDirectory, 'report.json'));
