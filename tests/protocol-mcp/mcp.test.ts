import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach } from 'vitest';
import { OAuthError, OAuthErrorCode, requireBearerAuth } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike, type NodeServerResponseLike } from '@modelcontextprotocol/node';
import { parseWireValue, type Outcome } from '../../packages/core/src/index.js';
import type { OperationGrant } from '../../packages/core/src/contracts/agent/index.js';
import { createAgentCapabilityRegistry } from '../../packages/agent/src/capabilities/registry.js';
import type { AgentCapabilityManifest, AgentCapabilityReceipt } from '../../packages/agent/src/capabilities/types.js';
import { createAgentToolEndpoint } from '../../packages/agent/src/protocol/endpoint.js';
import type { AgentToolEndpoint, AgentToolEndpointOptions } from '../../packages/agent/src/protocol/types.js';
import {
  AELIQO_MCP_PROTOCOL_REVISION,
  connectMcpHttpClient,
  connectMcpStdioClient,
  createMcpHttpHandler,
  createMcpServerFactory,
  createMcpClientEndpoint,
} from '../../packages/agent/src/mcp/index.js';

const servers: Server[] = [];
const insecureLoopbackPolicy = { allowInsecureLoopback: true } as const;

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      if (server.listening) server.close();
      else await once(server, 'close').catch(() => undefined);
    }),
  );
});

function endpointOptions(
  invoke: AgentCapabilityManifest['invoke'] = () => ({ state: 'data-ready', value: { count: 2 } }),
): AgentToolEndpointOptions {
  const operation: OperationGrant = 'catalog.read';
  const registry = createAgentCapabilityRegistry([
    {
      ref: { id: 'summary', revision: '1' },
      operation,
      label: 'Summary',
      description: 'Return a bounded summary.',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke,
    },
  ]);
  if (!registry.ok) throw new Error('registry fixture failed');
  return {
    transport: 'mcp',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    principalKey: 'owner',
    expiresAt: Date.now() + 60_000,
    registry: registry.value,
    tools: [
      {
        name: 'summary',
        capability: { id: 'summary', revision: '1' },
        operation,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
      },
    ],
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: 'owner',
          regionId: 'region',
          goalEpoch: 'goal',
          grants: ['catalog.read', 'model.egress'],
        },
      }),
    },
  };
}

function newEndpoint(invoke?: AgentCapabilityManifest['invoke']): AgentToolEndpoint {
  const outcome = createAgentToolEndpoint(endpointOptions(invoke));
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome.value;
}

function receiptFor(requestId: string, overrides: Partial<AgentCapabilityReceipt> = {}): AgentCapabilityReceipt {
  return {
    version: '1',
    requestId,
    targetRegionId: 'region',
    goalEpoch: 'goal',
    capability: { id: 'summary', revision: '1' },
    operation: 'catalog.read',
    transport: 'mcp',
    state: 'data-ready',
    status: 'data-ready',
    stage: 'data-ready',
    diagnostics: [],
    ...overrides,
  };
}

function authGate(overrides: Partial<{ resource: URL; issuer: string; expiresAt: number }> = {}) {
  const verifier = {
    verifyAccessToken: async (token: string) => {
      if (token !== 'fixture-token') throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
      return {
        token,
        clientId: 'fixture-client',
        scopes: ['mcp'],
        expiresAt: overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 60,
        resource: overrides.resource ?? new URL('http://127.0.0.1/'),
        extra: { issuer: overrides.issuer ?? 'https://issuer.example' },
      };
    },
  };
  return requireBearerAuth({ verifier, requiredScopes: ['mcp'] });
}

async function startHttp(options: Parameters<typeof createMcpHttpHandler>[0]) {
  const handler = createMcpHttpHandler(options);
  const nodeHandler = toNodeHandler(handler);
  const server = createServer((request, response) => {
    void nodeHandler(request as unknown as NodeIncomingMessageLike, response as unknown as NodeServerResponseLike);
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server address unavailable');
  return { handler, server, url: new URL(`http://127.0.0.1:${address.port}/mcp`) };
}

describe('MCP adapter', () => {
  it('uses the supported MCP revision with the official stdio server and client', async () => {
    const child = fileURLToPath(new URL('./stdio-child.mjs', import.meta.url));
    const modern = await connectMcpStdioClient({
      server: { command: process.execPath, args: [child], stderr: 'pipe' },
      targetRegionId: 'region',
      goalEpoch: 'goal',
    });
    expect(await modern.discover()).toMatchObject({
      ok: true,
      value: [{ name: 'summary', capability: { id: 'summary', revision: '1' } }],
    });
    expect(await modern.invoke('summary', { query: 'stdio' }, { requestId: 'stdio-modern' })).toMatchObject({
      ok: true,
      value: { requestId: 'stdio-modern', value: { name: 'summary', query: 'stdio' } },
    });
    modern.close();
  });

  it('serves authenticated HTTP with fresh discovery/call endpoint instances and no token in URLs', async () => {
    let created = 0;
    const fixture = await startHttp({
      createEndpoint: () => {
        created += 1;
        return newEndpoint();
      },
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      allowedOriginHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    const requests: Request[] = [];
    const client = await connectMcpHttpClient({
      url: fixture.url,
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: insecureLoopbackPolicy,
      authProvider: { token: async () => 'fixture-token' },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return fetch(request);
      },
    });
    expect(await client.discover()).toMatchObject({ ok: true, value: [{ name: 'summary' }] });
    expect(await client.invoke('summary', { query: 'http' }, { requestId: 'http-call' })).toMatchObject({
      ok: true,
      value: { requestId: 'http-call', value: { count: 2 } },
    });
    expect(created).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.url).not.toContain('fixture-token');
      expect(await request.clone().text()).not.toContain('fixture-token');
    }
    client.close();
    await fixture.handler.close();
  });

  it('pins HTTP clients to the supported MCP protocol revision', async () => {
    const fixture = await startHttp({
      createEndpoint: () => newEndpoint(() => ({ state: 'data-ready', value: { count: 2 } })),
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      allowedOriginHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    try {
      const client = await connectMcpHttpClient({
        url: fixture.url,
        targetRegionId: 'region',
        goalEpoch: 'goal',
        policy: insecureLoopbackPolicy,
        authProvider: { token: async () => 'fixture-token' },
      });
      try {
        expect((await client.discover()).ok).toBe(true);
        expect(await client.invoke('summary', {}, { requestId: 'http-supported' })).toMatchObject({
          ok: true,
          value: { value: { count: 2 } },
        });
      } finally {
        client.close();
      }
    } finally {
      await fixture.handler.close();
    }
  });

  it('rejects origin, audience, issuer and expired authentication before endpoint discovery', async () => {
    const base = {
      createEndpoint: () => {
        throw new Error('endpoint must not be reached');
      },
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      allowedOriginHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    } satisfies Parameters<typeof createMcpHttpHandler>[0];
    const handler = createMcpHttpHandler(base);
    const request = (headers: Record<string, string>) =>
      new Request('http://127.0.0.1/mcp', { method: 'POST', headers: { host: '127.0.0.1', ...headers }, body: '{}' });
    expect((await handler.fetch(request({ origin: 'https://evil.example' }))).status).toBe(403);
    expect(
      (
        await createMcpHttpHandler({
          ...base,
          authenticate: authGate({ resource: new URL('https://attacker.example/') }),
        }).fetch(request({ authorization: 'Bearer fixture-token' }))
      ).status,
    ).toBe(401);
    expect(
      (
        await createMcpHttpHandler({ ...base, authenticate: authGate({ issuer: 'https://other.example' }) }).fetch(
          request({ authorization: 'Bearer fixture-token' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createMcpHttpHandler({
          ...base,
          authenticate: authGate({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        }).fetch(request({ authorization: 'Bearer fixture-token' }))
      ).status,
    ).toBe(401);
    expect(
      (
        await createMcpHttpHandler({ ...base, authenticate: () => null as never }).fetch(
          request({ authorization: 'Bearer fixture-token' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createMcpHttpHandler({ ...base, now: () => Number.NaN, authenticate: authGate() }).fetch(
          request({ authorization: 'Bearer fixture-token' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createMcpHttpHandler({
          ...base,
          authenticate: () =>
            ({
              token: 'fixture-token',
              clientId: 'fixture-client',
              scopes: ['mcp'],
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              resource: { href: '%%%' },
            }) as never,
        }).fetch(request({ authorization: 'Bearer fixture-token' }))
      ).status,
    ).toBe(401);
  });

  it('rejects uncorrelated, incomplete and malformed receipts from the actual SDK path', async () => {
    const variants: readonly Partial<AgentCapabilityReceipt>[] = [
      { capability: { id: 'other', revision: '1' } },
      { operation: 'action.execute' },
      { affectedResults: [{ id: 'only-id' }] as never },
      { regionRevision: 42 as never },
      { reason: { private: true } as never },
      { state: 'renderer-ready', status: 'renderer-ready', stage: 'renderer-ready' },
      { diagnostics: [{ code: 'bad', message: 'bad', retryable: false, path: { not: 'an-array' } }] as never },
      { diagnostics: Array.from({ length: 17 }, () => ({ code: 'too-many', message: 'bad', retryable: false })) },
    ];
    for (const variant of variants) {
      const fixture = await startHttp({
        createEndpoint: () => ({
          ...newEndpoint(),
          invoke: (async (_name: string, _input: unknown, options: { readonly requestId: string }) => ({
            ok: true,
            value: receiptFor(options.requestId, variant),
          })) as AgentToolEndpoint['invoke'],
        }),
        authenticate: authGate(),
        allowedHostnames: ['127.0.0.1'],
        resourceServerUrl: new URL('http://127.0.0.1/'),
        issuer: 'https://issuer.example',
      });
      const client = await connectMcpHttpClient({
        url: fixture.url,
        targetRegionId: 'region',
        goalEpoch: 'goal',
        policy: insecureLoopbackPolicy,
        authProvider: { token: async () => 'fixture-token' },
      });
      expect((await client.discover()).ok).toBe(true);
      expect(await client.invoke('summary', {}, { requestId: 'malformed-receipt' })).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'agent.mcp.receipt' }],
      });
      client.close();
      await fixture.handler.close();
    }
  });

  it('rejects late results after the client closes during an actual SDK invocation', async () => {
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await startHttp({
      createEndpoint: () =>
        newEndpoint(async (_input, context) => {
          entered();
          await pending;
          return { state: 'data-ready', value: { count: 2 } };
        }),
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    const client = await connectMcpHttpClient({
      url: fixture.url,
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: insecureLoopbackPolicy,
      authProvider: { token: async () => 'fixture-token' },
    });
    expect((await client.discover()).ok).toBe(true);
    const call = client.invoke('summary', {}, { requestId: 'close-during-call' });
    await enteredPromise;
    client.close();
    release();
    expect(await call).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.mcp.closed' }] });
    await fixture.handler.close();
  });

  it('rejects a late discovery result after the client closes', async () => {
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await startHttp({
      createEndpoint: () => newEndpoint(),
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    const client = await connectMcpHttpClient({
      url: fixture.url,
      targetRegionId: 'region',
      goalEpoch: 'goal',
      authProvider: { token: async () => 'fixture-token' },
      policy: insecureLoopbackPolicy,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if ((await request.clone().text()).includes('tools/list')) {
          entered();
          await pending;
        }
        return fetch(request);
      },
    });
    const discovery = client.discover();
    await enteredPromise;
    client.close();
    release();
    expect(await discovery).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.mcp.closed' }] });
    await fixture.handler.close();
  });

  it('pins client region and goal despite mutation of the caller options', async () => {
    const fixture = await startHttp({ createEndpoint: () => newEndpoint(), authenticate: authGate() });
    const sdk = new Client({ name: 'snapshot-test', version: '1' });
    await sdk.connect(
      new StreamableHTTPClientTransport(fixture.url, {
        requestInit: { headers: { authorization: 'Bearer fixture-token' } },
      }),
    );
    const options = { client: sdk, targetRegionId: 'region', goalEpoch: 'goal' };
    const endpoint = createMcpClientEndpoint(options);
    expect((await endpoint.discover()).ok).toBe(true);
    options.targetRegionId = 'other';
    options.goalEpoch = 'other';
    expect(await endpoint.invoke('summary', {}, { requestId: 'snapshot' })).toMatchObject({
      ok: true,
      value: { targetRegionId: 'region', goalEpoch: 'goal' },
    });
    expect(Object.isFrozen(endpoint)).toBe(true);
    expect(await endpoint.invoke('summary', {}, undefined as never)).toMatchObject({ ok: false });
    endpoint.close();
    await fixture.handler.close();
  });

  it('closes the HTTP transport when SDK connection setup fails', async () => {
    let signal: AbortSignal | undefined;
    let redirect: RequestRedirect | undefined;
    await expect(
      connectMcpHttpClient({
        url: 'http://127.0.0.1:1/mcp',
        targetRegionId: 'region',
        goalEpoch: 'goal',
        policy: insecureLoopbackPolicy,
        fetch: async (_input, init) => {
          signal = init?.signal ?? undefined;
          redirect = init?.redirect;
          throw new Error('fixture connection failure');
        },
      }),
    ).rejects.toThrow('fixture connection failure');
    expect(signal?.aborted).toBe(true);
    expect(redirect).toBe('error');
  });

  it('requires HTTPS unless a loopback-only policy is explicit and enforces the origin allowlist', async () => {
    const common = { targetRegionId: 'region', goalEpoch: 'goal' } as const;
    await expect(connectMcpHttpClient({ url: 'http://127.0.0.1:1/mcp', ...common })).rejects.toThrow('requires HTTPS');
    await expect(
      connectMcpHttpClient({
        url: 'http://example.test/mcp',
        ...common,
        policy: insecureLoopbackPolicy,
      }),
    ).rejects.toThrow('requires HTTPS');
    await expect(
      connectMcpHttpClient({
        url: 'https://mcp.example.test/mcp',
        ...common,
        policy: { allowedOrigins: ['https://other.example.test'] },
      }),
    ).rejects.toThrow('not allowlisted');
    await expect(
      connectMcpHttpClient({
        url: 'https://user:secret@mcp.example.test/mcp',
        ...common,
      }),
    ).rejects.toThrow('must not contain credentials');
  });

  it('maps cancellation and malformed remote receipts to bounded outcomes', async () => {
    const fixture = await startHttp({
      createEndpoint: () =>
        newEndpoint(async (_input, context) => {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { state: 'data-ready', value: { never: 'delivered' } };
        }),
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    const client = await connectMcpHttpClient({
      url: fixture.url,
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: insecureLoopbackPolicy,
      authProvider: { token: async () => 'fixture-token' },
    });
    expect((await client.discover()).ok).toBe(true);
    const signal = new AbortController();
    const pending = client.invoke('summary', {}, { requestId: 'cancel-me', signal: signal.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    signal.abort();
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.mcp.cancelled' }] });
    client.close();
    await fixture.handler.close();

    const malformed = await startHttp({
      createEndpoint: () => ({
        ...newEndpoint(),
        invoke: (async () => ({ ok: true, value: { bad: true } })) as unknown as AgentToolEndpoint['invoke'],
      }),
      authenticate: authGate(),
      allowedHostnames: ['127.0.0.1'],
      resourceServerUrl: new URL('http://127.0.0.1/'),
      issuer: 'https://issuer.example',
    });
    const malformedClient = await connectMcpHttpClient({
      url: malformed.url,
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: insecureLoopbackPolicy,
      authProvider: { token: async () => 'fixture-token' },
    });
    expect((await malformedClient.discover()).ok).toBe(true);
    expect(await malformedClient.invoke('summary', {}, { requestId: 'bad-receipt' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'agent.mcp.receipt' }],
    });
    malformedClient.close();
    await malformed.handler.close();
  });

  it('does not print secrets in the stdio child and supports transport buffer limits', async () => {
    const child = fileURLToPath(new URL('./stdio-child.mjs', import.meta.url));
    const processHandle = (await import('node:child_process')).spawn(process.execPath, [child], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AELIQO_MCP_MAX_BUFFER: '256' },
    });
    let stdout = '';
    processHandle.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    processHandle.stdin.write(`${'x'.repeat(1024)}\n`);
    setTimeout(() => processHandle.kill(), 100);
    await new Promise<void>((resolve) => processHandle.once('close', () => resolve()));
    expect(stdout).not.toContain('fixture-token');
  });

  it('uses the current protocol revision in documentation', async () => {
    const documentation = await readFile(new URL('../../docs/agent-protocols/mcp.md', import.meta.url), 'utf8');
    expect(documentation).toContain(AELIQO_MCP_PROTOCOL_REVISION);
  });
});
