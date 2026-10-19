import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const FLAG = '--enable-features=WebMCPTesting';
const TOOL_NAME = 'varendo_native_adapter_probe';
const executablePath = process.env.WEBMCP_CHROME_PATH ?? chromium.executablePath();
const measuredAt = new Date().toISOString();
const repositoryRoot = resolve(process.cwd());
const serverErrors = [];
const zodRoot = dirname(fileURLToPath(import.meta.resolve('zod/package.json')));
const dependencyUrl = (specifier) =>
  `/dependencies/zod/${relative(zodRoot, fileURLToPath(import.meta.resolve(specifier))).replaceAll('\\', '/')}`;
const importMap = JSON.stringify({
  imports: {
    '@varendo/core': '/packages/core/dist/index.js',
    zod: dependencyUrl('zod'),
    'zod/mini': dependencyUrl('zod/mini'),
    'zod/': '/dependencies/zod/',
  },
});

const pageHtml = `<!doctype html>
<meta charset="utf-8">
<title>Varendo native WebMCP probe</title>
<p id="status">Running native WebMCP probe…</p>
<script type="importmap">
${importMap}
</script>
<script type="module">
import {parseWireValue,
} from '@varendo/core';
import {createAgentCapabilityRegistry} from '/packages/agent/dist/capabilities/registry.js';
import {createAgentToolEndpoint} from '/packages/agent/dist/protocol/index.js';
import {createWebMcpAdapter, detectWebMcp} from '/packages/agent/dist/webmcp/index.js';

(() => {
  const summary = (tools) => tools.map((tool) => ({
    name: tool?.name,
    annotations: tool?.annotations,
  }));
  const errorText = (error) => ({
    name: error?.name ?? 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
  });
  const result = {
    origin: location.origin,
    secureContext: window.isSecureContext === true,
    modelContextPresent: false,
    adapterEvidence: 'unavailable',
    adapterSupported: false,
    discoveryOk: false,
    registered: false,
    invoked: false,
    cancellationObserved: false,
    cancelled: false,
    disposed: false,
    lateDenied: false,
    authorityReads: 0,
    endpointInvocations: 0,
    events: [],
  };
  window.__nativeProbe = result;
  (async () => {
    let adapter;
    let nativeTool;
    let registeredTool;
    const executeNative = async (context, tool, input, options) => {
      try {
        return await context.executeTool(tool, input, options);
      } catch (error) {
        if (!errorText(error).message.includes('parse input arguments')) throw error;
        result.usedLegacyStringInput = true;
        return context.executeTool(tool, JSON.stringify(input), options);
      }
    };
    try {
      const context = document.modelContext;
      result.modelContextPresent = context !== undefined
        && typeof context?.registerTool === 'function';
      const registryResult = createAgentCapabilityRegistry([{
        ref: {id: 'catalog.summary', revision: '1'},
        operation: 'catalog.read',
        label: 'Summary',
        description: 'Read the authorized event catalog.',
        parse: (input) => {
          const checked = parseWireValue(input);
          return checked.ok ? {ok: true, value: checked.value} : checked;
        },
        invoke: async (input, capabilityContext) => {
          result.endpointInvocations += 1;
          result.events.push({
            phase: 'dispatcher',
            input: input?.query,
            requestId: capabilityContext.requestId,
            transport: capabilityContext.transport,
            region: capabilityContext.targetRegionId,
          });
          if (input?.query === 'cancel') {
            await new Promise((resolve) => {
              const cancelled = () => {
                result.cancellationObserved = true;
                resolve();
              };
              if (capabilityContext.signal.aborted) cancelled();
              else capabilityContext.signal.addEventListener('abort', cancelled, {once: true});
            });
            return {state: 'cancelled'};
          }
          return {
            state: 'data-ready',
            value: {
              region: capabilityContext.targetRegionId,
              transport: capabilityContext.transport,
              query: input?.query,
            },
          };
        },
      }]);
      if (!registryResult.ok) throw new Error('The browser could not create the capability registry.');
      const endpointResult = createAgentToolEndpoint({
        transport: 'webmcp',
        targetRegionId: 'region-1',
        goalEpoch: 'goal-1',
        principalKey: 'native-principal',
        expiresAt: 60_000,
        now: () => 1,
        registry: registryResult.value,
        tools: [{
          name: '${TOOL_NAME}',
          capability: {id: 'catalog.summary', revision: '1'},
          operation: 'catalog.read',
          inputSchema: {
            type: 'object',
            properties: {query: {type: 'string'}},
            required: ['query'],
          },
        }],
        host: {
          readContext: (request) => {
            result.authorityReads += 1;
            result.events.push({phase: 'authority', requestId: request.requestId});
            return {
              ok: true,
              value: {
                principalKey: 'native-principal',
                regionId: 'region-1',
                goalEpoch: 'goal-1',
                grants: ['catalog.read', 'model.egress'],
              },
            };
          },
        },
      });
      if (!endpointResult.ok) throw new Error('The browser could not create the paired tool endpoint.');
      const endpoint = endpointResult.value;
      const detection = detectWebMcp({ document, evidence: 'native' });
      if (detection.supported) {
        const adapterContext = {
          registerTool: (tool, options) => {
            registeredTool = tool;
            return context.registerTool(tool, options);
          },
          getTools: () => context.getTools(),
        };
        adapter = createWebMcpAdapter({endpoint, modelContext: adapterContext, evidence: 'native'});
      } else {
        adapter = createWebMcpAdapter({endpoint, document, evidence: 'native'});
      }
      result.modelContextPresent = detection.supported;
      result.adapterEvidence = adapter.evidence;
      result.adapterSupported = adapter.supported;
      const discovered = await adapter.discover();
      result.discoveryOk = discovered.ok;
      if (!result.modelContextPresent) {
        result.registration = await adapter.register();
        result.status = 'blocked';
        return;
      }
      if (typeof context?.getTools !== 'function' || typeof context?.executeTool !== 'function') {
        throw new Error('Native modelContext lacks getTools or executeTool.');
      }
      const registered = await adapter.register();
      result.registration = registered;
      if (!registered.ok) throw new Error('The native adapter could not register its endpoint tools.');
      result.registered = registered.value.some((entry) => entry.name === '${TOOL_NAME}' && entry.evidence === 'native');
      const before = await context.getTools();
      result.toolsBeforeDispose = summary(before);
      nativeTool = before.find((candidate) => candidate?.name === '${TOOL_NAME}');
      if (nativeTool === undefined) throw new Error('The adapter tool was absent from native getTools().');
      const nativeInvokeResult = await executeNative(context, nativeTool, {query: 'events'});
      result.invokeResult = typeof nativeInvokeResult === 'string' ? JSON.parse(nativeInvokeResult) : nativeInvokeResult;
      result.invoked = result.invokeResult?.ok === true
        && result.invokeResult?.value?.state === 'data-ready'
        && result.invokeResult?.value?.value?.region === 'region-1'
        && result.invokeResult?.value?.value?.transport === 'webmcp';
      const cancelController = new AbortController();
      const pendingCancellation = executeNative(
        context,
        nativeTool,
        {query: 'cancel'},
        {signal: cancelController.signal},
      );
      setTimeout(() => cancelController.abort(), 25);
      try {
        const cancelled = await pendingCancellation;
        result.cancelResult = typeof cancelled === 'string' ? JSON.parse(cancelled) : cancelled;
        result.cancelled = result.cancelResult?.ok === false
          && result.cancelResult?.diagnostics?.some((diagnostic) =>
            diagnostic.code === 'agent.capability.cancelled'
            || diagnostic.code === 'agent.webmcp.cancelled');
      } catch (error) {
        result.cancelError = errorText(error);
        result.cancelled = error?.name === 'AbortError';
      }
      adapter.close();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const after = await context.getTools();
      result.toolsAfterDispose = summary(after);
      result.disposed = !after.some((candidate) => candidate?.name === '${TOOL_NAME}');
      result.lateInvokeResult = await registeredTool?.execute({query: 'late'});
      result.lateDenied = result.lateInvokeResult?.ok === false
        && result.lateInvokeResult?.diagnostics?.some((diagnostic) => diagnostic.code === 'agent.webmcp.closed');
      result.status = result.modelContextPresent && result.adapterEvidence === 'native'
        && result.adapterSupported && result.discoveryOk && result.registered && result.invoked
        && result.cancellationObserved && result.cancelled && result.disposed && result.lateDenied
        && result.endpointInvocations === 2
        ? 'pass' : 'blocked';
    } catch (error) {
      result.error = errorText(error);
    } finally {
      adapter?.close();
      result.done = true;
      document.querySelector('#status').textContent = result.status === 'pass' ? 'Probe passed' : 'Probe ' + result.status;
    }
  })();
})();
</script>`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function runMode(mode, args, url) {
  const profile = await mkdtemp(join(tmpdir(), 'varendo-native-webmcp-'));
  const observation = {
    mode,
    flags: [...args],
    headless: false,
    isolatedProfile: true,
    executablePath,
    status: 'blocked',
  };
  let context;
  const pageErrors = [];
  const consoleMessages = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: false,
      args: [...args],
    });
    observation.browserVersion = context.browser()?.version() ?? 'unknown';
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message }));
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__nativeProbe?.done === true, undefined, { timeout: 10_000 });
    observation.page = await page.evaluate(() => window.__nativeProbe);
    observation.pageErrors = pageErrors;
    observation.console = consoleMessages;
    if (observation.page?.status === 'pass' && pageErrors.length === 0) {
      observation.status = 'pass';
    }
  } catch (error) {
    observation.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
    const page = context?.pages()[0];
    if (page !== undefined) {
      observation.page = await page.evaluate(() => window.__nativeProbe).catch(() => undefined);
    }
  } finally {
    observation.pageErrors = pageErrors;
    observation.console = consoleMessages;
    await context?.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
  return observation;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/packages/') || pathname.startsWith('/dependencies/zod/')) {
      const dependencyRequest = pathname.startsWith('/dependencies/zod/');
      const root = dependencyRequest ? zodRoot : resolve(repositoryRoot, 'packages');
      const prefix = dependencyRequest ? '/dependencies/zod/' : '/packages/';
      const candidate = resolve(root, pathname.slice(prefix.length));
      if (!candidate.startsWith(root + '/')) {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
      const body = await readFile(candidate);
      const contentType =
        extname(candidate) === '.js'
          ? 'text/javascript; charset=utf-8'
          : extname(candidate) === '.map'
            ? 'application/json; charset=utf-8'
            : 'application/octet-stream';
      response.statusCode = 200;
      response.setHeader('content-type', contentType);
      response.end(body);
      return;
    }
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(pageHtml);
  } catch (error) {
    serverErrors.push({ path: request.url, code: error?.code, message: error?.message ?? String(error) });
    response.statusCode = error?.code === 'ENOENT' ? 404 : 500;
    response.end(error?.code === 'ENOENT' ? 'Not found' : 'Probe server error');
  }
});
const address = await listen(server);
const url = `http://127.0.0.1:${address.port}/`;
let runs;
try {
  runs = [await runMode('default', [], url), await runMode('enable-webmcp-testing', [FLAG], url)];
} finally {
  await closeServer(server);
}

const output = {
  schemaVersion: 1,
  measuredAt,
  origin: url,
  browser: {
    requested: 'Playwright-bundled Chrome for Testing 153',
    executablePath,
  },
  officialInstructions: {
    overview: 'https://developer.chrome.com/docs/ai/webmcp',
    imperativeApi: 'https://developer.chrome.com/docs/ai/webmcp/imperative-api',
    localFlag: 'chrome://flags/#enable-webmcp-testing',
    commandLineEquivalent: FLAG,
  },
  serverErrors,
  runs,
};
console.log(JSON.stringify(output, null, 2));
if (
  serverErrors.length > 0 ||
  !runs.some((run) => run.mode === 'enable-webmcp-testing' && run.status === 'pass' && run.pageErrors?.length === 0)
)
  process.exitCode = 1;
