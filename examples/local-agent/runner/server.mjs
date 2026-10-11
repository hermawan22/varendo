import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createMcpHttpHandler } from '@varendo/agent/mcp';
import { runToolModel } from '@varendo/agent/model';
import manifest from '../package.json' with { type: 'json' };
import { BrowserSessionBroker } from './broker.mjs';
import { createModelAdapter } from './model-adapter.mjs';
import { readModelConfiguration } from './model-config.mjs';
import { publicPromptReceipt } from './prompt-receipt.mjs';

const runnerRoot = fileURLToPath(new URL('..', import.meta.url));
const siteRoot = resolve(runnerRoot, 'dist');
const host = '127.0.0.1';
const port = Number(process.env.AELIQO_LOCAL_PORT ?? '4174');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535)
  throw new Error('AELIQO_LOCAL_PORT must be an unprivileged TCP port.');
const origin = `http://${host}:${port}`;
const mcpToken = process.env.AELIQO_MCP_TOKEN ?? randomBytes(24).toString('base64url');
const sessionCookie = 'aeliqo_local_session';
const sessionLifetime = 15 * 60_000;
let session;
let activePrompt;

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function tokenMatches(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = createHash('sha256').update(mcpToken).digest();
  const received = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(expected, received);
}

function requestToken(request) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

function cookieValue(request, name) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function allowedRequest(request) {
  const hostHeader = request.headers.host;
  if (hostHeader !== `${host}:${port}` && hostHeader !== `localhost:${port}`) return false;
  const requestOrigin = request.headers.origin;
  return requestOrigin === undefined || requestOrigin === origin || requestOrigin === `http://localhost:${port}`;
}

function currentSession(request, create = false) {
  const now = Date.now();
  if (session !== undefined && session.broker.expiresAt <= now) {
    session.broker.dispose();
    session = undefined;
  }
  const supplied = cookieValue(request, sessionCookie);
  if (session !== undefined && supplied === session.id) return session;
  if (!create) return undefined;
  session?.broker.dispose();
  const id = randomBytes(24).toString('base64url');
  session = { id, broker: new BrowserSessionBroker({ expiresAt: now + sessionLifetime }) };
  return session;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 32_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('payload-too-large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-json');
  return value;
}

function modelConfiguration() {
  const settings = readModelConfiguration(process.env);
  if (settings === undefined) return undefined;
  return createModelAdapter(settings);
}

const model = modelConfiguration();

async function runPrompt(prompt, broker, signal) {
  const result = await runToolModel({
    requestId: randomBytes(12).toString('hex'),
    goal: 'experience',
    prompt,
    instructions:
      'Use aeliqo_context first. Choose the authorized resource whose label, fields, meanings, and views match the user request; the active resource is context, not a restriction. Call aeliqo_render only when the request can be satisfied faithfully with that metadata. If a requested field, meaning, action, or resource is absent or ambiguous, do not substitute unrelated data; explain briefly that no validated UI change can be made. Use analyze only with exact meaning IDs and revisions returned by context. When a trend view exists but no matching meaning is registered, use browse with the raw time and value fields plus preferredView trend; never invent a meaning. For a weekly time grain, explicitly set weekStartsOn to 1 (Monday); otherwise choose a day grain. Never invent HTML, code, permissions, endpoints, or data. Do not claim success without the renderer receipt.',
    policy: {
      // The host enforces this sequence, so the provider can keep tool_choice on auto.
      requiredOperationSequence: [{ operation: 'catalog.read', acceptedStates: ['accepted'] }],
    },
    endpoint: broker.endpoint('byok'),
    model,
    budget: {
      maxTurns: 4,
      maxModelRequests: 4,
      maxToolCalls: 4,
      maxMilliseconds: 45_000,
      maxInputTokens: 32_000,
      maxOutputTokens: 2_000,
      maxTotalTokens: 36_000,
      maxInputBytes: 128_000,
      maxOutputBytes: 128_000,
      maxRepeatedCalls: 2,
    },
    signal,
  });
  if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? 'The model loop failed.');
  return publicPromptReceipt(result.value);
}

const mcpResource = new URL('/mcp', origin);
const mcpHandler = createMcpHttpHandler({
  name: 'aeliqo-local-agent',
  version: manifest.version,
  allowedHostnames: [host, 'localhost'],
  allowedOriginHostnames: [host, 'localhost'],
  resourceServerUrl: mcpResource,
  issuer: origin,
  authenticate(request) {
    const token = request.headers.get('authorization')?.replace(/^Bearer /u, '');
    if (!tokenMatches(token) || session === undefined || !session.broker.connected)
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    return {
      token,
      clientId: 'aeliqo-local-agent',
      scopes: ['mcp'],
      expiresAt: Math.floor(session.broker.expiresAt / 1000),
      resource: mcpResource,
      extra: { issuer: origin },
    };
  },
  createEndpoint() {
    if (session === undefined) throw new Error('No browser Region is paired.');
    return session.broker.endpoint('mcp');
  },
});

async function readBytes(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('payload-too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

async function nodeRequest(request) {
  const body = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : await readBytes(request, 256_000);
  return new Request(new URL(request.url ?? '/', origin), {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function writeFetchResponse(result, response) {
  response.statusCode = result.status;
  for (const [name, value] of result.headers) response.setHeader(name, value);
  if (result.body === null) {
    response.end();
    return;
  }
  Readable.fromWeb(result.body).pipe(response);
}

function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relative = decoded.replace(/^\/+/, '');
  let path = resolve(siteRoot, relative);
  if (path !== siteRoot && !path.startsWith(`${siteRoot}${sep}`)) return false;
  if (existsSync(path) && statSync(path).isDirectory()) path = resolve(path, 'index.html');
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  response.writeHead(200, {
    'content-type': contentTypes.get(extname(path)) ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(path).pipe(response);
  return true;
}

function matchesRoute(request, url, pathname, method) {
  return url.pathname === pathname && request.method === method;
}

function acceptsJson(request) {
  return (request.headers.accept ?? '').split(',').some((value) => value.trim().startsWith('application/json'));
}

async function handleSessionRoute(request, response) {
  if (!acceptsJson(request)) {
    sendJson(response, 406, { error: 'json-accept-required' });
    return;
  }
  if (request.headers['x-aeliqo-session-bootstrap'] !== '1') {
    sendJson(response, 403, { error: 'session-bootstrap-required' });
    return;
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    sendJson(response, 403, { error: 'forbidden-origin' });
    return;
  }
  const current = currentSession(request, true);
  sendJson(
    response,
    200,
    { status: 'ready', modelConfigured: model !== undefined, expiresAt: current.broker.expiresAt },
    { 'set-cookie': `${sessionCookie}=${current.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900` },
  );
}

function detachEventStream(current, attachment, heartbeat) {
  clearInterval(heartbeat);
  if (session !== current) return;
  current.broker.detach(attachment);
}

async function handleEventsRoute(request, response) {
  const current = currentSession(request);
  if (current === undefined) {
    sendJson(response, 401, { error: 'session-required' });
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.write(': connected\n\n');
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 20_000);
  const attachment = current.broker.attach(
    (event, value) => response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`),
    () => {
      activePrompt?.abort();
      response.end();
    },
  );
  if (attachment === undefined) {
    clearInterval(heartbeat);
    response.end();
    return;
  }
  request.once('close', () => detachEventStream(current, attachment, heartbeat));
}

async function handleAcknowledgmentRoute(request, response) {
  const current = currentSession(request);
  if (current === undefined) {
    sendJson(response, 401, { error: 'session-required' });
    return;
  }
  const body = await readJson(request, 70_000);
  sendJson(response, current.broker.acknowledge(body.id, body.outcome) ? 204 : 400, {});
}

function validPrompt(body) {
  return typeof body.prompt === 'string' && body.prompt.trim().length > 0 && body.prompt.length <= 4_000;
}

function clearActivePrompt(controller) {
  if (activePrompt !== controller) return;
  activePrompt = undefined;
}

async function executePrompt(request, response, current, controller) {
  const body = await readJson(request, 8_000);
  if (!validPrompt(body)) {
    sendJson(response, 400, { error: 'invalid-prompt' });
    return;
  }
  try {
    sendJson(response, 200, await runPrompt(body.prompt.trim(), current.broker, controller.signal));
  } catch (error) {
    sendJson(response, 502, {
      error: 'model-run-failed',
      message: error instanceof Error ? error.message : 'The model run failed.',
    });
  }
}

async function handlePromptRoute(request, response) {
  const current = currentSession(request);
  if (current === undefined || !current.broker.connected) {
    sendJson(response, 409, { error: 'browser-region-not-connected' });
    return;
  }
  if (model === undefined) {
    sendJson(response, 503, { error: 'model-not-configured' });
    return;
  }
  if (activePrompt !== undefined) {
    sendJson(response, 429, { error: 'prompt-already-running' });
    return;
  }
  const controller = new AbortController();
  activePrompt = controller;
  const cancel = () => controller.abort();
  response.once('close', cancel);
  try {
    await executePrompt(request, response, current, controller);
  } finally {
    response.off('close', cancel);
    clearActivePrompt(controller);
  }
}

function disposeSession(current) {
  if (current === undefined) return;
  current.broker.dispose();
  if (session !== current) return;
  session = undefined;
}

async function handleDisconnectRoute(request, response) {
  const current = currentSession(request);
  if (current !== undefined) activePrompt?.abort();
  disposeSession(current);
  sendJson(response, 204, {}, { 'set-cookie': `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
}

function invalidBridgeOutcome() {
  return {
    ok: false,
    diagnostics: [{ code: 'playground.local-bridge', message: 'The bridge operation is invalid.', retryable: false }],
  };
}

async function bridgeOutcome(endpoint, body, signal) {
  if (body.operation === 'discover') return endpoint.discover({ signal });
  if (body.operation !== 'invoke' || typeof body.name !== 'string' || typeof body.requestId !== 'string')
    return invalidBridgeOutcome();
  return endpoint.invoke(body.name, body.input, { requestId: body.requestId, signal });
}

async function handleBridgeRoute(request, response) {
  if (!tokenMatches(requestToken(request)) || session === undefined) {
    sendJson(response, 401, { error: 'invalid-token' });
    return;
  }
  const body = await readJson(request);
  const endpoint = session.broker.endpoint('mcp');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  response.once('close', cancel);
  try {
    sendJson(response, 200, await bridgeOutcome(endpoint, body, controller.signal));
  } finally {
    response.off('close', cancel);
  }
}

async function handleMcpRoute(request, response) {
  const nodeCompatibleRequest = await nodeRequest(request);
  const result = await mcpHandler.fetch(nodeCompatibleRequest);
  await writeFetchResponse(result, response);
}

async function handleStaticRoute(request, response, url) {
  if (serveStatic(url.pathname, response)) return;
  sendJson(response, 404, { error: 'not-found' });
}

const routeHandlers = [
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/session', 'GET'),
    handle: handleSessionRoute,
  },
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/events', 'GET'),
    handle: handleEventsRoute,
  },
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/ack', 'POST'),
    handle: handleAcknowledgmentRoute,
  },
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/prompt', 'POST'),
    handle: handlePromptRoute,
  },
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/disconnect', 'POST'),
    handle: handleDisconnectRoute,
  },
  {
    matches: (request, url) => matchesRoute(request, url, '/api/aeliqo/bridge', 'POST'),
    handle: handleBridgeRoute,
  },
  { matches: (_request, url) => url.pathname === '/mcp', handle: handleMcpRoute },
  {
    matches: (request) => request.method === 'GET' || request.method === 'HEAD',
    handle: handleStaticRoute,
  },
];

async function dispatchRequest(request, response) {
  if (!allowedRequest(request)) {
    sendJson(response, 403, { error: 'forbidden-origin' });
    return;
  }
  const url = new URL(request.url ?? '/', origin);
  const route = routeHandlers.find(({ matches }) => matches(request, url));
  if (route === undefined) {
    sendJson(response, 404, { error: 'not-found' });
    return;
  }
  await route.handle(request, response, url);
}

function requestErrorStatus(error) {
  return error instanceof Error && error.message === 'payload-too-large' ? 413 : 400;
}

async function handleRequest(request, response) {
  try {
    await dispatchRequest(request, response);
  } catch (error) {
    sendJson(response, requestErrorStatus(error), { error: 'invalid-request' });
  }
}

const server = createServer(handleRequest);

if (!existsSync(resolve(siteRoot, 'index.html'))) throw new Error('Run pnpm build before starting the local agent.');
server.listen(port, host, () => {
  process.stderr.write(`Varendo local agent: ${origin}/\n`);
  process.stderr.write(`MCP HTTP: ${origin}/mcp (Bearer ${mcpToken})\n`);
  process.stderr.write(`MCP stdio: AELIQO_LOCAL_URL=${origin} AELIQO_MCP_TOKEN=${mcpToken} pnpm mcp:stdio\n`);
});

function shutdown() {
  activePrompt?.abort();
  session?.broker.dispose();
  mcpHandler.close();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
