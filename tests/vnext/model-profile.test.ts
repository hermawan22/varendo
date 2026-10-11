import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createOpaqueModelSecret,
  createOpenAICompatibleResponsesToolModel,
  createOpenAICompatibleToolModel,
  createToolModelConnection,
  isToolModelProviderError,
  openAICompatibleChatAdapter,
  ResponsesTransportError,
  ToolModelProviderError,
} from '../../packages/agent/src/model/index.js';
import type { ToolModelRequest } from '../../packages/agent/src/model/types.js';
import { createModelProtocolFixture } from './fixtures/model.js';

const request: ToolModelRequest = {
  messages: [{ role: 'user', text: 'Read the authorized fixture summary.' }],
  tools: [
    {
      name: 'summary',
      description: 'Read the bounded fixture summary.',
      capability: { id: 'fixture.summary', revision: '1' },
      operation: 'catalog.read',
      inputSchema: { type: 'object' },
    },
  ],
  toolChoice: 'required',
  maxOutputTokens: 64,
};

const successfulBody = {
  id: 'fixture-response',
  model: 'configured-fixture-model',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_fixture',
            type: 'function',
            function: { name: 'summary', arguments: '{"subject":"authorized-fixture"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  });
}

function connection(
  fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>,
  options: {
    readonly auth?: 'none' | 'bearer';
    readonly budget?: { readonly maxRequestBytes?: number; readonly maxResponseBytes?: number };
    readonly retry?: { readonly maxAttempts?: number; readonly baseDelayMs?: number; readonly maxDelayMs?: number };
    readonly timeoutMs?: number;
  } = {},
) {
  const auth = options.auth ?? 'bearer';
  return createToolModelConnection({
    adapter: openAICompatibleChatAdapter,
    baseURL: 'https://models.fixture.test/v1',
    model: 'configured-fixture-model',
    auth:
      auth === 'none'
        ? { scheme: 'none' }
        : { scheme: 'bearer', secret: createOpaqueModelSecret('fixture-server-secret', 'trusted-server') },
    policy: { allowExternalEgress: true, allowedOrigins: ['https://models.fixture.test'] },
    capabilities: ['tool-calls', 'input-token-estimate', 'request-cancellation', 'request-retry'],
    fetch: fetcher,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

describe('vNext model protocol conformance profiles', () => {
  it('supports explicitly allowed local no-auth without a dummy secret', async () => {
    const fixture = await createModelProtocolFixture({ auth: 'none', endpoint: 'local-allowlisted' });
    try {
      const outcome = await fixture.runToolTurn();
      expect(outcome).toMatchObject({ ok: true, value: { stop: 'text-ready', toolCalls: 1 } });
      expect(fixture.receivedHeaders.authorization).toBeUndefined();
      expect(fixture.receivedToolCalls).toHaveLength(1);
      expect(fixture.receivedToolResults).toHaveLength(1);
      expect(fixture.receivedToolResults[0]?.callId).toBe(fixture.receivedToolCalls[0]?.id);
      expect(JSON.parse(String(fixture.receivedToolResults[0]?.output))).toMatchObject({
        ok: true,
        value: { state: 'data-ready', value: { count: 1, source: 'fixture' } },
      });
      expect(outcome.ok && outcome.value.receipts[0]).toMatchObject({
        operation: 'catalog.read',
        state: 'data-ready',
      });
    } finally {
      await fixture.dispose();
    }
  });

  it('keeps no-auth and hosted credential policy explicit', () => {
    expect(() =>
      createToolModelConnection({
        adapter: openAICompatibleChatAdapter,
        baseURL: 'https://models.fixture.test/v1',
        model: 'hosted-model',
        auth: { scheme: 'none' },
        policy: { allowExternalEgress: true, allowedOrigins: ['https://models.fixture.test'] },
        capabilities: ['tool-calls'],
      }),
    ).toThrow('local endpoint');
    expect(() =>
      createToolModelConnection({
        adapter: openAICompatibleChatAdapter,
        baseURL: 'http://127.0.0.1:4321/v1',
        model: 'local-model',
        auth: { scheme: 'none' },
        policy: { allowExternalEgress: true, allowInsecureHttp: true },
        capabilities: ['tool-calls'],
      }),
    ).toThrow('explicitly allowlisted endpoint origin');
    expect(() =>
      createOpenAICompatibleToolModel({
        baseURL: 'https://models.fixture.test/v1',
        model: 'hosted-model',
        capabilities: ['tool-calls'],
        policy: { allowExternalEgress: true, allowedOrigins: ['https://models.fixture.test'] },
      }),
    ).toThrow('explicit server-owned credential');
    expect(() =>
      createOpenAICompatibleToolModel({
        baseURL: 'https://models.fixture.test/v1',
        model: 'hosted-model',
        secret: createOpaqueModelSecret('fixture-server-secret', 'trusted-server'),
        auth: { scheme: 'none' },
        capabilities: ['tool-calls'],
        policy: { allowExternalEgress: true, allowedOrigins: ['https://models.fixture.test'] },
      }),
    ).toThrow('cannot include a credential');
  });

  it('distinguishes a protocol fixture from provider quality and preserves absent usage/counting', async () => {
    const fixture = await createModelProtocolFixture({ auth: 'none', endpoint: 'local-allowlisted' });
    try {
      const outcome = await fixture.runToolTurn();
      expect(outcome).toMatchObject({ ok: true, value: { stop: 'text-ready' } });
      expect(fixture.receivedToolCalls[0]).toEqual({
        id: 'call_fixture_summary',
        name: 'summary',
        input: { subject: 'authorized-fixture' },
      });
      expect(outcome.ok && outcome.value.inputTokens).toBeGreaterThan(0);
      expect(outcome.ok && outcome.value.outputTokens).toBeGreaterThan(0);
    } finally {
      await fixture.dispose();
    }
    const noUsage = connection(async () => response(successfulBody));
    const decoded = await noUsage.complete(request, { signal: new AbortController().signal });
    expect(decoded.usage).toMatchObject({
      inputTokenSource: 'estimated',
      outputTokenSource: 'estimated',
    });
  });

  it('supports multiple correlated tool calls without guessing provider identity', async () => {
    const port = connection(async () =>
      response({
        ...successfulBody,
        choices: [
          {
            ...successfulBody.choices[0]!,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-one',
                  type: 'function',
                  function: { name: 'summary', arguments: '{"subject":"one"}' },
                },
                {
                  id: 'call-two',
                  type: 'function',
                  function: { name: 'summary', arguments: '{"subject":"two"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    const result = await port.complete(request, { signal: new AbortController().signal });
    expect(result.calls).toEqual([
      { id: 'call-one', name: 'summary', input: { subject: 'one' } },
      { id: 'call-two', name: 'summary', input: { subject: 'two' } },
    ]);
    expect(result.provider).toMatchObject({ protocol: 'openai-compatible-chat', model: 'configured-fixture-model' });
  });

  it('accepts a custom auth header and the chat-completions token parameter', async () => {
    let headers: Headers | undefined;
    let body: Record<string, unknown> | undefined;
    const secret = createOpaqueModelSecret('fixture-header-secret', 'trusted-server');
    const port = createOpenAICompatibleToolModel({
      baseURL: 'https://models.fixture.test/v1',
      model: 'configured-fixture-model',
      secret,
      auth: { scheme: 'header', headerName: 'x-api-key' },
      capabilities: ['tool-calls'],
      policy: { allowExternalEgress: true, allowedOrigins: ['https://models.fixture.test'] },
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response(successfulBody);
      },
    });
    await port.complete(request, { signal: new AbortController().signal });
    expect(headers?.get('authorization')).toBeNull();
    expect(headers?.get('x-api-key')).toBe('fixture-header-secret');
    expect(body).toMatchObject({ max_tokens: 64, stream: false, tool_choice: 'required' });
  });

  it('classifies malformed, oversized, timeout, and retry outcomes at the connection boundary', async () => {
    const malformed = connection(async () => new Response('{', { headers: { 'content-type': 'application/json' } }));
    await expect(malformed.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'malformed-response',
      retryable: false,
    });

    const oversized = connection(async () => response(successfulBody), {
      budget: { maxResponseBytes: 8 },
    });
    await expect(oversized.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'response-too-large',
    });

    const timeout = connection(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          }),
        ),
      { timeoutMs: 5 },
    );
    await expect(timeout.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'timeout',
    });

    let attempts = 0;
    const retried = connection(
      async () => {
        attempts++;
        return attempts === 1 ? response({ error: { code: 'temporary' } }, 503) : response(successfulBody);
      },
      { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 } },
    );
    await expect(retried.complete(request, { signal: new AbortController().signal })).resolves.toMatchObject({
      calls: [{ id: 'call_fixture' }],
    });
    expect(attempts).toBe(2);

    let rateAttempts = 0;
    const rateLimited = connection(async () => {
      rateAttempts++;
      return response({ error: { code: 'rate_limited' } }, 429);
    });
    await expect(rateLimited.complete(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      retryable: true,
    });
    expect(rateAttempts).toBe(1);

    let observedCancellation = false;
    const cancellable = connection(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => {
              observedCancellation = true;
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          ),
        ),
    );
    const controller = new AbortController();
    const pending = cancellable.complete(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', retryable: false });
    expect(observedCancellation).toBe(true);
  });

  it('rejects streaming and keeps server-only credential helpers out of browser source', async () => {
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        environment: 'trusted-server',
        endpoint: { protocol: 'https', baseUrl: 'https://responses.fixture.test/v1' },
        model: 'fixture-model',
        credentialReference: 'fixture-reference',
        credentialResolver: { resolve: async () => 'fixture-secret' },
        requestPolicy: {
          maxRetries: 0,
          timeoutMilliseconds: 100,
          maxRequestBytes: 10_000,
          maxResponseBytes: 10_000,
          stream: true as false,
        },
      }),
    ).toThrow(ResponsesTransportError);

    const browserFiles = await Promise.all(
      ['types.ts', 'bridge.ts', 'index.ts'].map((name) =>
        readFile(new URL(`../../packages/agent/src/browser/${name}`, import.meta.url), 'utf8'),
      ),
    );
    expect(browserFiles.join('\n')).not.toMatch(
      /model\/(?:connection|connection-config|auth-handle|responses|openai)/u,
    );
    expect(isToolModelProviderError(new ToolModelProviderError('network', 'fixture'))).toBe(true);
  });
});
