import { describe, expect, it, vi } from 'vitest';
import { createDataHttpHandler, createHttpDataService } from '../../packages/runtime/src/data/http.js';
import type {
  AcceptedQuery,
  DataService,
  PlanAcceptance,
  QueryBudget,
  ResultEvent,
} from '../../packages/runtime/src/data/types.js';
import { catalog, query, ref, resultEvents } from '../contracts/fixtures.js';

const budget: QueryBudget = { maxRows: 10, maxBytes: 100_000, maxMessages: 10, maxMilliseconds: 1000, maxColumns: 10 };
const discovery = {
  version: '1',
  requestId: 'request-1',
  catalogRevision: null,
  target: { kind: 'catalog' },
  budget,
} as const;
const planning = {
  version: '1',
  requestId: 'request-1',
  catalogRevision: catalog.revision,
  target: { taskId: 'request-1', outputId: ref.outputId },
  query,
  budget,
} as const;
const accepted: AcceptedQuery = {
  version: '1',
  requestId: 'request-1',
  target: planning.target,
  catalogRevision: catalog.revision,
  sourceRevision: 'source-r1',
  sourceLineage: 'source-r1',
  scopeDigest: ref.scopeDigest,
  queryDigest: ref.queryDigest,
  planDigest: 'plan-1',
  populationDigest: 'population-1',
  lineageDigest: 'lineage-8fc01d2fba0d26c09f33133179d4af54be4f7e2dd5280639a10ae763b8f5b1c6',
  resultShape: 'rows',
  expiresAt: 9_000_000_000_000,
  functionRegistryDigest: catalog.functionRegistryDigest,
  query,
  effectiveBudget: budget,
};
const plan: PlanAcceptance = { ...accepted, kind: 'accepted', supported: ['projection'] };
const page = {
  version: '1',
  requestId: 'request-1',
  catalog,
  catalogRevision: catalog.revision,
  sourceRevision: 'source-r1',
  scopeDigest: ref.scopeDigest,
  target: discovery.target,
  effectiveBudget: budget,
} as const;
const acceptedRef = { ...ref, revision: accepted.sourceRevision, sourceLineage: accepted.sourceLineage };
const valid = [
  { ...resultEvents.descriptor, descriptor: { ...resultEvents.descriptor.descriptor, ref: acceptedRef } },
  { ...resultEvents.batch, result: acceptedRef },
  { ...resultEvents.complete, result: acceptedRef },
];
const content = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const ndjson = (events: readonly unknown[]) =>
  new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', {
    headers: { 'content-type': 'application/x-ndjson' },
  });
function fakeService(overrides: Partial<DataService> = {}): DataService {
  return {
    describe: async () => ({ ok: true, value: page }),
    plan: async () => ({ ok: true, value: plan }),
    async *execute() {
      yield* valid;
    },
    ...overrides,
  };
}
const request = (path: string, body: unknown, signal?: AbortSignal) =>
  new Request('https://app.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
const through =
  (handler: ReturnType<typeof createDataHttpHandler>): typeof fetch =>
  async (input, init) =>
    handler(new Request(input, init));
const collect = async (events: AsyncIterable<ResultEvent>) => {
  const all = [];
  for await (const event of events) all.push(event);
  return all;
};

describe('ADC HTTP boundary', () => {
  it('carries server-owned principal and roundtrips discovery, plans and bounded result events', async () => {
    const contexts: unknown[] = [];
    const service = fakeService({
      describe: async (_request, context) => {
        contexts.push(context?.principal);
        return { ok: true, value: page };
      },
      plan: async (_request, context) => {
        contexts.push(context?.principal);
        return { ok: true, value: plan };
      },
      async *execute(_request, context) {
        contexts.push(context?.principal);
        yield* valid;
      },
    });
    const handler = createDataHttpHandler({
      service,
      authenticate: (req) => ({ ok: true, value: { principal: req.headers.get('authorization') } }),
    });
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      fetch: through(handler),
      headers: { authorization: 'test-principal' },
    });
    expect(await client.describe(discovery, { principal: 'forged-local-context' })).toEqual({ ok: true, value: page });
    expect(await client.plan(planning)).toEqual({ ok: true, value: plan });
    expect(await collect(client.execute(accepted))).toEqual(valid);
    expect(contexts).toEqual(['test-principal', 'test-principal', 'test-principal']);
  });
  it('rejects authority fields, duplicate JSON keys, excessive bodies and incorrect media types before service calls', async () => {
    const describe = vi.fn(fakeService().describe);
    const handler = createDataHttpHandler({ service: fakeService({ describe }), maxRequestBytes: 1000 });
    expect((await handler(request('/adc/describe', { ...discovery, principal: 'admin' }))).status).toBe(400);
    const duplicate = new Request('https://app.test/adc/describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"requestId":"one","requestId":"two"}',
    });
    expect((await handler(duplicate)).status).toBe(400);
    expect((await handler(request('/adc/describe', { large: 'x'.repeat(1001) }))).status).toBe(413);
    expect((await handler(new Request('https://app.test/adc/describe', { method: 'POST', body: '{}' }))).status).toBe(
      415,
    );
    expect(describe).not.toHaveBeenCalled();
  });
  it('uses configured paths and an exact origin, and never exposes an activation route', async () => {
    const handler = createDataHttpHandler({
      service: fakeService(),
      allowedOrigin: 'https://ui.test',
      paths: { describe: '/data/catalog' },
    });
    expect((await handler(request('/adc/describe', discovery))).status).toBe(404);
    expect((await handler(request('/adc/register-meaning', discovery))).status).toBe(404);
    const bad = request('/data/catalog', discovery);
    bad.headers.set('origin', 'https://elsewhere.test');
    expect((await handler(bad)).status).toBe(403);
    const good = request('/data/catalog', discovery);
    good.headers.set('origin', 'https://ui.test');
    const response = await handler(good);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://ui.test');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(() => createDataHttpHandler({ service: fakeService(), allowedOrigin: '*' })).toThrow();
  });
  it('sanitizes thrown authentication and service failures', async () => {
    const authHandler = createDataHttpHandler({
      service: fakeService(),
      authenticate() {
        throw new Error('private auth internals');
      },
    });
    const auth = await authHandler(request('/adc/describe', discovery));
    expect(auth.status).toBe(403);
    expect(await auth.text()).not.toContain('private');
    const serviceHandler = createDataHttpHandler({
      service: fakeService({
        describe() {
          throw new Error('private host internals');
        },
      }),
    });
    expect(await (await serviceHandler(request('/adc/describe', discovery))).text()).not.toContain('private');
  });
  it('times out authentication, propagates its signal and releases concurrency admission', async () => {
    let authSignal: AbortSignal | undefined;
    const handler = createDataHttpHandler({
      service: fakeService(),
      maxRequestMilliseconds: 25,
      maxConcurrentRequests: 1,
      authenticate: (req) => {
        authSignal = req.signal;
        return new Promise(() => {});
      },
    });
    const first = handler(request('/adc/describe', discovery));
    const second = await handler(request('/adc/describe', discovery));
    expect(second.status).toBe(429);
    const timed = await first;
    expect(timed.status).toBe(408);
    expect(authSignal?.aborted).toBe(true);
    expect((await handler(request('/adc/describe', discovery))).status).toBe(408);
  });
  it('bounds request-body reads and releases the underlying reader without awaiting stalled cleanup', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    });
    const handler = createDataHttpHandler({ service: fakeService(), maxRequestMilliseconds: 25 });
    const incoming = new Request('https://app.test/adc/describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect((await handler(incoming)).status).toBe(408);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
  it('cancels a stalled result iterator on the deadline and permits the next request', async () => {
    let returned = false;
    let executionSignal: AbortSignal | undefined;
    const handler = createDataHttpHandler({
      maxRequestMilliseconds: 25,
      maxConcurrentRequests: 1,
      service: fakeService({
        execute(_request, context) {
          executionSignal = context?.signal;
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => new Promise(() => {}),
                return: () => {
                  returned = true;
                  return new Promise(() => {});
                },
              };
            },
          };
        },
      }),
    });
    const client = createHttpDataService({ baseUrl: 'https://app.test', fetch: through(handler) });
    const events = await collect(client.execute(accepted));
    expect(events.at(-1)?.kind).toBe('error');
    expect(events.some((event) => event.kind === 'complete')).toBe(false);
    expect(returned).toBe(true);
    expect(executionSignal?.aborted).toBe(true);
    expect((await handler(request('/adc/describe', discovery))).status).toBe(200);
  });
  it('does not follow redirects or send credentials to a different configured origin', async () => {
    let redirect: RequestRedirect | undefined;
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      fetch: async (_url, init) => {
        redirect = init?.redirect;
        return content(page);
      },
    });
    expect((await client.describe(discovery)).ok).toBe(true);
    expect(redirect).toBe('error');
    expect(() =>
      createHttpDataService({ baseUrl: 'https://app.test', paths: { describe: 'https://other.test/catalog' } }),
    ).toThrow();
    expect(() => createHttpDataService({ baseUrl: 'https://user:secret@app.test' })).toThrow();
    expect(() => createHttpDataService({ baseUrl: 'file:///tmp/data' })).toThrow();
  });
  it.each([
    { ...page, requestId: 'another-request' },
    { ...page, catalogRevision: 'another-catalog' },
    { ...page, target: { kind: 'entity', entity: 'employees' } },
    { ...page, effectiveBudget: { ...budget, maxRows: 11 } },
  ])('rejects a miscorrelated discovery response', async (response) => {
    const client = createHttpDataService({ baseUrl: 'https://app.test', fetch: async () => content(response) });
    expect(await client.describe(discovery)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.http-correlation' }],
    });
  });
  it.each([
    { ...plan, requestId: 'other' },
    { ...plan, catalogRevision: 'other' },
    { ...plan, query: { ...query, fields: [] } },
    { ...plan, effectiveBudget: { ...budget, maxRows: 11 } },
  ])('rejects a miscorrelated accepted plan', async (response) => {
    const client = createHttpDataService({ baseUrl: 'https://app.test', fetch: async () => content(response) });
    expect(await client.plan(planning)).toMatchObject({ ok: false, diagnostics: [{ code: 'data.http-correlation' }] });
  });
  it('rejects errors associated with another request', async () => {
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      fetch: async () =>
        content(
          { version: '1', requestId: 'other', diagnostics: [{ code: 'denied', message: 'Denied', retryable: false }] },
          403,
        ),
    });
    expect(await client.describe(discovery)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.http-correlation' }],
    });
  });
  it('cancels a fetch that ignores its AbortSignal and disposes late response bodies', async () => {
    let finish: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    let cancelled = false;
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      maxRequestMilliseconds: 25,
      fetch: (_url, init) => {
        signal = init?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const outcome = await client.describe(discovery);
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'data.http-timeout' }] });
    expect(signal?.aborted).toBe(true);
    finish!(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });
  it('cancels a response body that never ends', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    });
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      maxRequestMilliseconds: 25,
      fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    });
    expect(await client.describe(discovery)).toMatchObject({ ok: false, diagnostics: [{ code: 'data.http-timeout' }] });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
  it('does not deliver buffered rows after the caller cancels between events', async () => {
    const controller = new AbortController();
    const client = createHttpDataService({ baseUrl: 'https://app.test', fetch: async () => ndjson(valid) });
    const iterator = client.execute(accepted, { signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.kind).toBe('descriptor');
    controller.abort();
    expect((await iterator.next()).value).toMatchObject({ kind: 'error', error: { code: 'data.aborted' } });
    expect((await iterator.next()).done).toBe(true);
  });
  it('reports a stream deadline separately from caller cancellation', async () => {
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      maxRequestMilliseconds: 25,
      fetch: async () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/x-ndjson' } }),
    });
    expect(await collect(client.execute(accepted))).toMatchObject([
      { kind: 'error', error: { code: 'data.http-timeout' } },
    ]);
  });
  it('rejects malformed UTF-8 and byte-budget overflow', async () => {
    for (const bytes of [Uint8Array.of(0xff), new Uint8Array(101)]) {
      const client = createHttpDataService({
        baseUrl: 'https://app.test',
        responseLimits: { bytes: 100, messageBytes: 100, messages: 10, rows: 10 },
        fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/json' } }),
      });
      expect((await client.describe(discovery)).ok).toBe(false);
    }
  });
  it.each([
    [resultEvents.descriptor, resultEvents.batch],
    [resultEvents.descriptor, { ...resultEvents.batch, sequence: 2 }, resultEvents.complete],
    [
      {
        ...resultEvents.descriptor,
        descriptor: {
          ...resultEvents.descriptor.descriptor,
          coverage: { kind: 'complete', populationDigest: 'other' },
        },
      },
      resultEvents.complete,
    ],
    [...valid, resultEvents.batch],
  ])('never marks a dropped or changed result stream complete', async (...events) => {
    const client = createHttpDataService({ baseUrl: 'https://app.test', fetch: async () => ndjson(events) });
    const seen = await collect(client.execute(accepted));
    expect(seen.some((event) => event.kind === 'complete')).toBe(false);
    expect(seen.at(-1)?.kind).toBe('error');
  });
  it('releases successful HTTP streams without aborting their completed fetch', async () => {
    for (const stopAtTerminal of [false, true]) {
      let signal: AbortSignal | null | undefined;
      const client = createHttpDataService({
        baseUrl: 'https://app.test',
        fetch: async (_url, init) => {
          signal = init?.signal;
          return ndjson(valid);
        },
      });
      const seen: ResultEvent[] = [];
      for await (const event of client.execute(accepted)) {
        seen.push(event);
        if (stopAtTerminal && event.kind === 'complete') break;
      }
      expect(seen).toEqual(valid);
      expect(signal?.aborted).toBe(false);
    }
  });

  it('still aborts the fetch when a consumer leaves before its terminal event', async () => {
    let signal: AbortSignal | null | undefined;
    const client = createHttpDataService({
      baseUrl: 'https://app.test',
      fetch: async (_url, init) => {
        signal = init?.signal;
        return ndjson(valid);
      },
    });
    for await (const event of client.execute(accepted)) {
      expect(event.kind).toBe('descriptor');
      break;
    }
    expect(signal?.aborted).toBe(true);
  });
});
