import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOpaqueModelSecret,
  createOpenAICompatibleToolModel,
  isToolModelProviderError,
  ToolModelProviderError,
} from '../../packages/agent/src/model/index.js';
import type { ToolModelRequest } from '../../packages/agent/src/model/types.js';

const createServerSecret = (value: string) => createOpaqueModelSecret(value, 'trusted-server');
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

const request: ToolModelRequest = {
  messages: [
    { role: 'system', text: 'Evaluate the canonical task.' },
    { role: 'user', text: 'Summarize' },
    { role: 'assistant', calls: [{ id: 'call_previous', name: 'summary', input: { entity: 'orders' } }] },
    { role: 'tool', callId: 'call_previous', output: { count: 2 } },
  ],
  tools: [
    {
      name: 'summary',
      description: 'Read summary',
      capability: { id: 'summary', revision: '1' },
      operation: 'catalog.read',
      inputSchema: { type: 'object' },
    },
  ],
  toolChoice: 'required',
  maxOutputTokens: 100,
};

async function fixtureServer(
  handler: (
    body: Record<string, unknown>,
    request: Request,
  ) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
) {
  const server = createServer(async (incoming, outgoing) => {
    let raw = '';
    for await (const chunk of incoming) raw += String(chunk);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const result = await handler(
      body,
      new Request(`http://${incoming.headers.host}${incoming.url}`, {
        ...(incoming.method === undefined ? {} : { method: incoming.method }),
        headers: incoming.headers as Record<string, string>,
        body: raw,
      }),
    );
    outgoing.statusCode = result.status ?? 200;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.end(JSON.stringify(result.body));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { baseURL: `http://127.0.0.1:${address.port}/v1/`, origin: `http://127.0.0.1:${address.port}` };
}

function successBody() {
  return {
    id: 'chatcmpl_fixture',
    model: 'returned-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'done',
          tool_calls: [
            {
              id: 'call_next',
              type: 'function',
              function: { name: 'summary', arguments: '{"entity":"orders"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50, prompt_tokens_details: { cached_tokens: 3 } },
  };
}

describe('generic OpenAI-compatible model connection', () => {
  it('keeps auth separate from protocol/base URL/model and maps chat-completions tool calls', async () => {
    const seen: Array<{ body: Record<string, unknown>; request: Request }> = [];
    const fixture = await fixtureServer((body, incoming) => {
      seen.push({ body, request: incoming });
      return { body: successBody() };
    });
    const secret = 'fixture-secret-never-in-wire';
    const observations: unknown[] = [];
    const port = createOpenAICompatibleToolModel({
      baseURL: fixture.baseURL,
      model: 'fixture-model',
      secret: createServerSecret(secret),
      capabilities: ['tool-calls', 'usage', 'request-cancellation'],
      headers: { 'x-fixture': 'protocol-test' },
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [fixture.origin] },
      cost: { currency: 'USD', inputUSDPerMillion: 0.27, outputUSDPerMillion: 1.1, source: 'fixture-rate' },
      onResponse: (observation) => observations.push(observation),
    });
    const signal = new AbortController().signal;
    expect(port.countInputTokens).toBeUndefined();
    expect(port.estimateInputTokens?.(request)).toBeGreaterThan(0);
    expect(seen).toHaveLength(0);
    const response = await port.complete(request, { signal });
    expect(response).toMatchObject({
      text: 'done',
      calls: [{ id: 'call_next', name: 'summary', input: { entity: 'orders' } }],
      usage: {
        inputTokens: 42,
        outputTokens: 8,
        totalTokens: 50,
        inputTokenSource: 'provider',
        outputTokenSource: 'provider',
        cachedInputTokens: 3,
        cost: { currency: 'USD', estimatedUSD: (42 * 0.27 + 8 * 1.1) / 1_000_000, source: 'fixture-rate' },
      },
      provider: { protocol: 'openai-compatible-chat', model: 'returned-model', responseId: 'chatcmpl_fixture' },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.request.url).toBe(`${fixture.origin}/v1/chat/completions`);
    expect(seen[0]?.request.headers.get('authorization')).toBe(`Bearer ${secret}`);
    expect(seen[0]?.request.headers.get('x-fixture')).toBe('protocol-test');
    expect(seen[0]?.body).toMatchObject({
      model: 'fixture-model',
      max_tokens: 100,
      stream: false,
      tool_choice: 'required',
      parallel_tool_calls: false,
      messages: [
        { role: 'system', content: 'Evaluate the canonical task.' },
        { role: 'user', content: 'Summarize' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_previous', type: 'function' }] },
        { role: 'tool', tool_call_id: 'call_previous', content: '{"count":2}' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'summary', description: 'Read summary', parameters: { type: 'object' } },
        },
      ],
    });
    expect(JSON.stringify(seen[0]?.body)).not.toContain(secret);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(observations)).not.toContain(secret);
  });

  it('accepts an empty assistant content field when a compatible endpoint returns a tool call', async () => {
    const fixture = await fixtureServer(() => ({
      body: {
        ...successBody(),
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_next',
                  type: 'function',
                  function: { name: 'summary', arguments: '{"entity":"orders"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    }));
    const port = createOpenAICompatibleToolModel({
      baseURL: fixture.baseURL,
      model: 'fixture-model',
      secret: createServerSecret('empty-content-secret'),
      capabilities: ['tool-calls', 'usage'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [fixture.origin] },
    });
    await expect(port.complete(request, { signal: new AbortController().signal })).resolves.toMatchObject({
      calls: [{ id: 'call_next', name: 'summary', input: { entity: 'orders' } }],
    });
  });

  it('round-trips bounded reasoning continuation without serializing its provider value', async () => {
    const seen: Record<string, unknown>[] = [];
    const fixture = await fixtureServer((body) => {
      seen.push(body);
      return {
        body: {
          ...successBody(),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
                reasoning_content: 'private reasoning fixture',
                tool_calls: [
                  {
                    id: 'call_next',
                    type: 'function',
                    function: { name: 'summary', arguments: '{"entity":"orders"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      };
    });
    const port = createOpenAICompatibleToolModel({
      baseURL: fixture.baseURL,
      model: 'fixture-model',
      secret: createServerSecret('continuation-secret'),
      capabilities: ['tool-calls', 'usage'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [fixture.origin] },
    });
    const first = await port.complete(request, { signal: new AbortController().signal });
    expect(JSON.stringify(first)).not.toContain('private reasoning fixture');
    await port.complete(
      {
        ...request,
        messages: [
          { role: 'user', text: 'Summarize' },
          {
            role: 'assistant',
            calls: first.calls,
            ...(first.continuation === undefined ? {} : { continuation: first.continuation }),
          },
          { role: 'tool', callId: 'call_next', output: { count: 2 } },
        ],
      },
      { signal: new AbortController().signal },
    );
    expect((seen[1]?.messages as Record<string, unknown>[])[1]).toMatchObject({
      reasoning_content: 'private reasoning fixture',
    });
  });

  it('classifies protocol decode failures as malformed responses instead of network failures', async () => {
    const fixture = await fixtureServer(() => ({ body: { choices: [] } }));
    const port = createOpenAICompatibleToolModel({
      baseURL: fixture.baseURL,
      model: 'fixture-model',
      secret: createServerSecret('malformed-response-secret'),
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [fixture.origin] },
    });
    await expect(port.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'malformed-response',
      retryable: false,
    });
  });

  it('normalizes provider errors without retaining the secret and retries only when configured', async () => {
    let calls = 0;
    const fixture = await fixtureServer(() => {
      calls += 1;
      return calls === 1
        ? { status: 503, body: { error: { code: 'temporary', message: 'temporary provider failure' } } }
        : { body: successBody() };
    });
    const port = createOpenAICompatibleToolModel({
      baseURL: fixture.baseURL,
      model: 'fixture-model',
      secret: createServerSecret('retry-secret'),
      capabilities: ['tool-calls', 'usage'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [fixture.origin] },
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await expect(port.complete(request, { signal: new AbortController().signal })).resolves.toMatchObject({
      provider: { responseId: 'chatcmpl_fixture' },
    });
    expect(calls).toBe(2);

    const failing = await fixtureServer(() => ({
      status: 401,
      body: { error: { code: 'invalid_api_key', message: 'bad retry-secret' } },
    }));
    const unauthorized = createOpenAICompatibleToolModel({
      baseURL: failing.baseURL,
      model: 'fixture-model',
      secret: createServerSecret('retry-secret'),
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [failing.origin] },
    });
    await expect(unauthorized.complete(request, { signal: new AbortController().signal })).rejects.toSatisfy(
      (error) => {
        expect(error).toBeInstanceOf(ToolModelProviderError);
        expect(isToolModelProviderError(error)).toBe(true);
        expect(error).toMatchObject({
          kind: 'authentication',
          status: 401,
          retryable: false,
          providerCode: 'invalid_api_key',
        });
        expect(error.message).not.toContain('retry-secret');
        return true;
      },
    );
  });

  it('refuses HTTP redirects before credentials or model input can reach another origin', async () => {
    let redirectedRequests = 0;
    const target = createServer((_incoming, outgoing) => {
      redirectedRequests += 1;
      outgoing.statusCode = 200;
      outgoing.end(JSON.stringify(successBody()));
    });
    servers.push(target);
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    const targetAddress = target.address() as AddressInfo;

    const redirect = createServer((_incoming, outgoing) => {
      outgoing.statusCode = 307;
      outgoing.setHeader('location', `http://127.0.0.1:${targetAddress.port}/capture`);
      outgoing.end();
    });
    servers.push(redirect);
    redirect.listen(0, '127.0.0.1');
    await once(redirect, 'listening');
    const redirectAddress = redirect.address() as AddressInfo;
    const origin = `http://127.0.0.1:${redirectAddress.port}`;

    const port = createOpenAICompatibleToolModel({
      baseURL: `${origin}/v1`,
      model: 'fixture-model',
      secret: createServerSecret('redirect-secret'),
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowInsecureHttp: true, allowedOrigins: [origin] },
    });
    await expect(port.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'network',
    });
    expect(redirectedRequests).toBe(0);
  });

  it('rejects unsafe client-side construction and unapproved transport policy', () => {
    expect(() =>
      createOpenAICompatibleToolModel({
        baseURL: 'http://example.test/v1',
        model: 'fixture-model',
        secret: createServerSecret('secret'),
        capabilities: ['tool-calls'],
        policy: { allowExternalEgress: false },
      }),
    ).toThrow('explicit egress grant');
    expect(() =>
      createOpenAICompatibleToolModel({
        baseURL: 'https://example.test/v1?token=secret',
        model: 'fixture-model',
        secret: createServerSecret('secret'),
        capabilities: ['tool-calls'],
        policy: { allowExternalEgress: true },
      }),
    ).toThrow('query parameters');
    expect(() =>
      createOpenAICompatibleToolModel({
        baseURL: 'https://example.test/v1',
        model: 'fixture-model',
        secret: createServerSecret('secret'),
        capabilities: [] as const,
        policy: { allowExternalEgress: true },
      }),
    ).toThrow('explicit tool-calls capability');
  });

  it('supports explicit non-Bearer authentication and propagates host cancellation without a provider retry', async () => {
    let observedAbort = false;
    let authorization: string | null = null;
    let apiKey: string | null = null;
    const port = createOpenAICompatibleToolModel({
      baseURL: 'https://model.example.test/v1',
      model: 'configured-model',
      secret: createServerSecret('header-only-secret'),
      auth: { scheme: 'header', headerName: 'x-api-key' },
      capabilities: ['tool-calls', 'request-cancellation'],
      policy: { allowExternalEgress: true, allowedOrigins: ['https://model.example.test'] },
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const headers = new Headers(init?.headers);
          authorization = headers.get('authorization');
          apiKey = headers.get('x-api-key');
          init?.signal?.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        }),
    });
    const controller = new AbortController();
    const pending = port.complete(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
    expect(observedAbort).toBe(true);
    expect(authorization).toBeNull();
    expect(apiKey).toBe('header-only-secret');
  });

  it('enforces timeout and response bounds without exposing provider bodies', async () => {
    const timeout = createOpenAICompatibleToolModel({
      baseURL: 'https://model.example.test/v1',
      model: 'configured-model',
      secret: createServerSecret('timeout-secret'),
      capabilities: ['tool-calls', 'request-cancellation'],
      policy: { allowExternalEgress: true, allowedOrigins: ['https://model.example.test'] },
      timeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          }),
        ),
    });
    await expect(timeout.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'timeout',
    });

    const oversized = createOpenAICompatibleToolModel({
      baseURL: 'https://model.example.test/v1',
      model: 'configured-model',
      secret: createServerSecret('size-secret'),
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowedOrigins: ['https://model.example.test'] },
      budget: { maxResponseBytes: 8 },
      fetch: async () =>
        new Response(JSON.stringify(successBody()), { headers: { 'content-type': 'application/json' } }),
    });
    await expect(oversized.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'response-too-large',
    });

    const oversizedRequest = createOpenAICompatibleToolModel({
      baseURL: 'https://model.example.test/v1',
      model: 'configured-model',
      secret: createServerSecret('request-size-secret'),
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowedOrigins: ['https://model.example.test'] },
      budget: { maxRequestBytes: 8 },
      fetch: async () => {
        throw new Error('A bounded request must not reach the network.');
      },
    });
    await expect(oversizedRequest.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'request-too-large',
    });
  });
});
