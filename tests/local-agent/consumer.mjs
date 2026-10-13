import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const consumer = await mkdtemp(join(tmpdir(), 'varendo-local-agent-'));
const artifacts = join(root, 'artifacts/local-agent');
await mkdir(artifacts, { recursive: true });
const packages = ['core', 'runtime', 'web', 'agent'];
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
await cp(join(root, 'examples/local-agent'), consumer, {
  recursive: true,
  filter: (path) => !/(?:^|\/)(?:node_modules|dist|\.env\.local)(?:\/|$)/u.test(path),
});
const manifest = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'));
const overrides = [];
for (const name of packages) {
  const tarball = join(artifacts, `${name}.tgz`);
  run('pnpm', ['pack', '--out', tarball], join(root, 'packages', name));
  assert.equal(manifest.dependencies[`@varendo/${name}`], '0.2.0');
  overrides.push(`  '@varendo/${name}': 'file:${tarball}'`);
}
// Candidate tarballs stand in for the not-yet-published registry version. All other
// install/start files are copied unchanged and installed outside the workspace.
await writeFile(join(consumer, 'pnpm-workspace.yaml'), `packages:\n  - .\noverrides:\n${overrides.join('\n')}\n`);
run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile']);
run('pnpm', ['test']);
await writeFile(join(consumer, 'mcp-consumer.mjs'), "export * from '@varendo/agent/mcp';\n");
const mcp = await import(pathToFileURL(join(consumer, 'mcp-consumer.mjs')).href);
const token = 'local-agent-consumer-token';
const intent = {
  version: '1',
  id: 'people-cards',
  kind: 'browse',
  resource: 'people',
  fields: ['name', 'team'],
  preferredView: 'cards',
};
let modelRequests = 0;
let holdModel = false;
let modelCancelled = false;
const fixture = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(input.model, 'deterministic-fixture');
  modelRequests += 1;
  if (holdModel) {
    response.once('close', () => {
      modelCancelled = true;
    });
    return;
  }
  const tool = modelRequests === 1 ? 'varendo_context' : 'varendo_render';
  const message =
    modelRequests <= 2
      ? {
          content: null,
          tool_calls: [
            {
              id: `call-${modelRequests}`,
              type: 'function',
              function: { name: tool, arguments: JSON.stringify(modelRequests === 1 ? {} : intent) },
            },
          ],
        }
      : { content: 'The People directory is rendered.', tool_calls: [] };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `fixture-${modelRequests}`,
      model: input.model,
      choices: [{ message }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    }),
  );
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = fixture.address().port;
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, VARENDO_LOCAL_PORT: String(port), VARENDO_MCP_TOKEN: token };
for (const key of Object.keys(env)) if (key.startsWith('VARENDO_MODEL_')) delete env[key];
let server;
let browser;
let errors = [];
async function startServer(model = false) {
  const modelEnv = model
    ? {
        VARENDO_MODEL_BASE_URL: `http://127.0.0.1:${fixturePort}/v1/`,
        VARENDO_MODEL: 'deterministic-fixture',
        VARENDO_MODEL_PROTOCOL: 'openai-compatible-chat',
        VARENDO_MODEL_AUTH_SCHEME: 'none',
        VARENDO_MODEL_CAPABILITIES: 'tool-calls,usage,request-cancellation',
        VARENDO_ALLOW_INSECURE_MODEL_HTTP: '1',
      }
    : {};
  server = spawn('pnpm', ['run', 'dev'], {
    cwd: consumer,
    detached: true,
    env: { ...env, ...modelEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* listener not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not start: ${output}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  process.kill(-server.pid, 'SIGTERM');
  await stopped;
}
async function assertTransport(endpoint, page, prefix) {
  try {
    const discovered = await endpoint.discover();
    assert(discovered.ok, JSON.stringify(discovered));
    assert.deepEqual(discovered.value.map(({ name }) => name).sort(), [
      'varendo_act',
      'varendo_context',
      'varendo_render',
    ]);
    const context = await endpoint.invoke('varendo_context', {}, { requestId: `${prefix}-context` });
    assert(context.ok && context.value.state === 'accepted', JSON.stringify(context));
    assert.equal(context.value.value.activeResource, 'people');
    const rendered = await endpoint.invoke(
      'varendo_render',
      { ...intent, id: `${prefix}-cards` },
      { requestId: `${prefix}-render` },
    );
    assert(rendered.ok && rendered.value.state === 'renderer-ready', JSON.stringify(rendered));
    await page.locator('varendo-card-collection').getByText('Ada Lovelace').waitFor();
    const invalid = await endpoint.invoke(
      'varendo_render',
      { ...intent, fields: ['invented'] },
      { requestId: `${prefix}-invalid` },
    );
    assert(!invalid.ok || invalid.value.state !== 'renderer-ready');
    await page.locator('varendo-card-collection').getByText('Ada Lovelace').waitFor();
  } finally {
    endpoint.close();
  }
}
try {
  await startServer();
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByText('Connected — MCP is ready.', { exact: false }).waitFor();
  assert(await page.locator('#prompt').isDisabled());
  assert.equal(modelRequests, 0, 'default startup must not call a model');
  const http = await mcp.connectMcpHttpClient({
    url: `${base}/mcp`,
    targetRegionId: 'people-main',
    goalEpoch: 'local-agent',
    policy: { allowInsecureLoopback: true },
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await assertTransport(http, page, 'http');
  const stdio = await mcp.connectMcpStdioClient({
    server: {
      command: process.execPath,
      args: [join(consumer, 'runner/mcp-stdio.mjs')],
      env: { ...env, VARENDO_LOCAL_URL: base },
      stderr: 'pipe',
    },
    targetRegionId: 'people-main',
    goalEpoch: 'local-agent',
  });
  await assertTransport(stdio, page, 'stdio');
  for (const headers of [
    { origin: 'https://attacker.example' },
    { 'sec-fetch-site': 'cross-site', 'x-varendo-session-bootstrap': '1' },
    {},
  ]) {
    const result = await fetch(`${base}/api/varendo/session`, { headers: { accept: 'application/json', ...headers } });
    assert.equal(result.status, 403);
  }
  assert.equal(
    (
      await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.equal(
    (
      await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await page.getByText('Connected — MCP is ready.', { exact: false }).waitFor();
  await stopServer();
  await page.getByText('The local host disconnected.', { exact: false }).waitFor({ timeout: 3_000 });
  await page.close();
  await startServer(true);
  const modelPage = await browser.newPage();
  modelPage.on('pageerror', (error) => errors.push(error.message));
  await modelPage.goto(base);
  await modelPage.getByText('Connected — MCP is ready.', { exact: false }).waitFor();
  assert.equal(modelRequests, 0, 'configured startup must wait for a user prompt');
  await modelPage.getByRole('button', { name: 'Send to local agent' }).click();
  await modelPage.locator('varendo-card-collection').getByText('Ada Lovelace').waitFor();
  await modelPage.waitForFunction(() => document.querySelector('#receipt')?.textContent !== 'Agent working…');
  assert(modelRequests >= 2 && modelRequests <= 4);
  assert.doesNotMatch(await modelPage.locator('#receipt').textContent(), /failed|denied|Error|budget/u);
  const completedModelRequests = modelRequests;
  holdModel = true;
  await modelPage.getByRole('button', { name: 'Send to local agent' }).click();
  for (let attempt = 0; modelRequests === completedModelRequests && attempt < 100; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(modelRequests, completedModelRequests + 1);
  await modelPage.getByRole('button', { name: 'Disconnect', exact: true }).click();
  for (let attempt = 0; !modelCancelled && attempt < 100; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(modelCancelled, true, 'disconnect aborts the provider transport');
  for (const [engine, browserType] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const smokeBrowser = await browserType.launch();
    try {
      const smoke = await smokeBrowser.newPage();
      smoke.on('pageerror', (error) => errors.push(error.message));
      await smoke.goto(base);
      await smoke.getByText('Connected — MCP is ready.', { exact: false }).waitFor();
      for (const width of [360, 768, 1440]) {
        await smoke.setViewportSize({ width, height: 900 });
        assert(
          await smoke.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${engine} reflow at ${width}`,
        );
        await smoke.screenshot({ path: join(artifacts, `${engine}-${width}.png`), fullPage: true });
      }
      await smoke.getByRole('button', { name: 'Disconnect', exact: true }).focus();
      await smoke.keyboard.press('Enter');
      assert(await smoke.getByRole('button', { name: 'Start a new session' }).isVisible());
    } finally {
      await smokeBrowser.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        consumer,
        node: process.version,
        chromium: browser.version(),
        modelRequests,
        proof: [
          'independent-pnpm-install',
          'pnpm-dev-build-and-start',
          'three-engine-responsive-keyboard',
          'unit',
          'http-context-and-render',
          'stdio-context-and-render',
          'invalid-intent-retains-view',
          'origin-auth-disconnect',
          'default-no-model',
          'deterministic-model-loop',
          'provider-cancellation',
          'host-disconnect-state',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Standalone local agent passed: ${join(artifacts, 'report.json')}`);
} finally {
  await browser?.close();
  await stopServer();
  await new Promise((resolve) => fixture.close(resolve));
}
