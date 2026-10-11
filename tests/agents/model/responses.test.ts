import { describe, expect, it } from 'vitest';
import {
  createOpenAICompatibleResponsesToolModel,
  ResponsesTransportError,
  type OpenAICompatibleResponsesToolModelOptions,
} from '../../../packages/agent/src/model/responses.js';
import type { ToolModelRequest } from '../../../packages/agent/src/model/types.js';

const request: ToolModelRequest = {
  messages: [{ role: 'user', text: 'Summarize authorized data.' }],
  tools: [
    {
      name: 'summary',
      description: 'Read summary.',
      capability: { id: 'summary', revision: '1' },
      operation: 'catalog.read',
      inputSchema: { type: 'object', additionalProperties: false },
    },
  ],
  toolChoice: 'required',
  maxOutputTokens: 32,
};
const policy = {
  maxRetries: 0 as const,
  timeoutMilliseconds: 100,
  maxRequestBytes: 10_000,
  maxResponseBytes: 10_000,
  stream: false as const,
};
const signal = new AbortController().signal;
const encoder = new TextEncoder();

function options(
  fetcher: typeof fetch,
  resolve: (reference: string, options: { readonly signal: AbortSignal }) => Promise<string> = async (reference) =>
    `fixture:${reference}`,
): OpenAICompatibleResponsesToolModelOptions {
  return {
    environment: 'trusted-server',
    endpoint: { protocol: 'https', baseUrl: 'https://responses.fixture.test/v1' },
    model: 'fixture-model',
    credentialReference: 'release-fixture',
    credentialResolver: { resolve },
    requestPolicy: policy,
    fetch: fetcher,
  };
}
function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, ...(headers === undefined ? {} : { headers }) });
}

describe('OpenAI-compatible Responses ToolModelPort', () => {
  it('keeps endpoint, model, opaque reference and request policy separate while projecting complete function calls', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const port = createOpenAICompatibleResponsesToolModel(
      options(async (url, init) => {
        calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
        if (String(url).endsWith('/input_tokens')) return response({ input_tokens: 11 });
        return response({
          status: 'completed',
          output_text: 'Unverified draft.',
          usage: { input_tokens: 11, output_tokens: 7 },
          output: [
            {
              type: 'function_call',
              status: 'completed',
              call_id: 'call_summary',
              name: 'summary',
              arguments: '{"scope":"allowed"}',
            },
          ],
        });
      }),
    );
    expect(await port.countInputTokens(request, { signal })).toBe(11);
    await expect(port.complete(request, { signal })).resolves.toEqual({
      text: 'Unverified draft.',
      calls: [{ id: 'call_summary', name: 'summary', input: { scope: 'allowed' } }],
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://responses.fixture.test/v1/responses/input_tokens',
      'https://responses.fixture.test/v1/responses',
    ]);
    expect(calls[1]?.init?.headers).toMatchObject({
      authorization: 'Bearer fixture:release-fixture',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      model: 'fixture-model',
      stream: false,
      store: false,
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
  });

  it('projects application-owned system policy through the Responses instructions field', async () => {
    let body: Record<string, unknown> | undefined;
    const port = createOpenAICompatibleResponsesToolModel(
      options(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({ input_tokens: 11 });
      }),
    );
    await port.countInputTokens(
      { ...request, messages: [{ role: 'system', text: 'Evaluate the canonical task.' }, ...request.messages] },
      { signal },
    );
    expect(body?.instructions).toContain('Evaluate the canonical task.');
    expect(body?.input).toEqual([{ role: 'user', content: 'Summarize authorized data.' }]);
  });

  it('uses no retries and rejects non-HTTPS, credential-derived, and streaming configuration', () => {
    const fetcher = (async () => response({ input_tokens: 1 })) as typeof fetch;
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        ...options(fetcher),
        environment: 'client' as unknown as 'trusted-server',
      }),
    ).toThrow(ResponsesTransportError);
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        ...options(fetcher),
        endpoint: { protocol: 'https', baseUrl: 'http://responses.fixture.test/v1' },
      }),
    ).toThrow(ResponsesTransportError);
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        ...options(fetcher),
        requestPolicy: { ...policy, maxRetries: 1 as 0 },
      }),
    ).toThrow(ResponsesTransportError);
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        ...options(fetcher),
        requestPolicy: { ...policy, stream: true as false },
      }),
    ).toThrow(ResponsesTransportError);
    expect(() =>
      createOpenAICompatibleResponsesToolModel({
        ...options(fetcher),
        model: 'fixture-model',
        credentialReference: '',
      }),
    ).toThrow(ResponsesTransportError);
  });

  it('makes exactly one transport attempt when the endpoint fails', async () => {
    let attempts = 0;
    const port = createOpenAICompatibleResponsesToolModel(
      options(async () => {
        attempts++;
        throw new TypeError('fixture network failure');
      }),
    );
    await expect(port.countInputTokens(request, { signal })).rejects.toMatchObject({ code: 'network' });
    expect(attempts).toBe(1);
  });

  it('normalizes provider failures without exposing fake credentials or response bodies', async () => {
    const fakeCredential = 'fixture-credential-not-for-logging';
    const port = createOpenAICompatibleResponsesToolModel(
      options(
        async () => response({ detail: `bad ${fakeCredential}` }, 401),
        async () => fakeCredential,
      ),
    );
    await expect(port.countInputTokens(request, { signal })).rejects.toMatchObject({
      name: 'ResponsesTransportError',
      code: 'http',
    });
    await port
      .countInputTokens(request, { signal })
      .catch((error) => expect(String(error.message)).not.toContain(fakeCredential));
    const unavailable = createOpenAICompatibleResponsesToolModel(
      options(
        async () => response({}),
        async () => {
          throw new Error(fakeCredential);
        },
      ),
    );
    await expect(unavailable.countInputTokens(request, { signal })).rejects.toMatchObject({
      code: 'credential-unavailable',
    });
  });

  it('propagates caller abort and request-policy timeout without retrying', async () => {
    let aborts = 0;
    const hanging = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborts++;
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    const controller = new AbortController();
    const port = createOpenAICompatibleResponsesToolModel(options(hanging as typeof fetch));
    const pending = port.countInputTokens(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    const timeout = createOpenAICompatibleResponsesToolModel({
      ...options(hanging as typeof fetch),
      requestPolicy: { ...policy, timeoutMilliseconds: 5 },
    });
    await expect(timeout.countInputTokens(request, { signal })).rejects.toMatchObject({ code: 'timeout' });
    expect(aborts).toBe(1);
  });

  it('does not resolve credentials or call fetch when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let resolved = 0,
      fetched = 0;
    const port = createOpenAICompatibleResponsesToolModel(
      options(
        async () => {
          fetched++;
          return response({ input_tokens: 1 });
        },
        async () => {
          resolved++;
          return 'fixture-credential';
        },
      ),
    );
    await expect(port.countInputTokens(request, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect({ resolved, fetched }).toEqual({ resolved: 0, fetched: 0 });
  });

  it('bounds chunked response reading before buffering and cancels the overflow stream', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('x'.repeat(128)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const port = createOpenAICompatibleResponsesToolModel({
      ...options(async () => new Response(body)),
      requestPolicy: { ...policy, maxResponseBytes: 16 },
    });
    await expect(port.countInputTokens(request, { signal })).rejects.toMatchObject({ code: 'response-too-large' });
    expect(cancelled).toBe(true);
  });

  it('does not accept a late noncooperative fetch or body after cancellation', async () => {
    const lateFetch = async (): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return response({ input_tokens: 1 });
    };
    let pulled!: () => void;
    const bodyRead = new Promise<void>((resolve) => {
      pulled = resolve;
    });
    const afterBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled();
        setTimeout(() => {
          try {
            controller.enqueue(encoder.encode('{"input_tokens":1}'));
            controller.close();
          } catch {
            /* Cancellation is expected. */
          }
        }, 15);
      },
    });
    const lateBody = createOpenAICompatibleResponsesToolModel(options(async () => new Response(afterBody)));
    const lateResponse = createOpenAICompatibleResponsesToolModel({
      ...options(lateFetch as typeof fetch),
      requestPolicy: { ...policy, timeoutMilliseconds: 5 },
    });
    await expect(lateResponse.countInputTokens(request, { signal })).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    const pending = lateBody.countInputTokens(request, { signal: controller.signal });
    await bodyRead;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects malformed Responses payloads before they reach the model loop', async () => {
    const port = createOpenAICompatibleResponsesToolModel(
      options(async () =>
        response({
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [{ type: 'function_call', call_id: 'call', name: 'summary', arguments: '{not json' }],
        }),
      ),
    );
    await expect(port.complete(request, { signal })).rejects.toMatchObject({ code: 'protocol' });
  });

  it('supports genuine raw Responses message text without pretending to support streaming', async () => {
    const port = createOpenAICompatibleResponsesToolModel(
      options(async () =>
        response({
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 2 },
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Raw text.' }] }],
        }),
      ),
    );
    await expect(port.complete(request, { signal })).resolves.toEqual({
      text: 'Raw text.',
      calls: [],
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });
});
