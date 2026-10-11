import { describe, expect, it } from 'vitest';
import { renderSsrPeoplePage } from '../../examples/vnext/src/ssr.js';
import {
  createDataHttpHandler,
  createHttpDataService,
  type DataRecord,
  type ResultEvent,
} from '../../packages/runtime/src/data/index.js';
import { createResultStore, type ResultBeginInput } from '../../packages/runtime/src/results/index.js';
import { createScopedSurfaceEndpoint } from '../../packages/agent/src/browser/bridge.js';
import type { AgentSurfaceTarget } from '../../packages/agent/src/browser/types.js';
import { createAgentFixture } from './fixtures/agent.js';
import { createActionFixture } from './fixtures/actions.js';
import { createPeopleFixture } from './fixtures/people.js';
import {
  createTwoTenantFixture,
  securityBudget,
  securityPrincipal,
  securityQuery,
  securityService,
} from './fixtures/security.js';
import { resultDescriptor, resultRef } from '../security/fixtures.js';
import { safeResolvedHref } from '../../packages/web/src/foundation/base.js';

const describeRequest = {
  version: '1' as const,
  requestId: 'security-describe',
  catalogRevision: null,
  target: { kind: 'catalog' as const },
  budget: securityBudget,
};

function diagnosticCodes(body: unknown): readonly string[] {
  if (body === null || typeof body !== 'object') return [];
  const diagnostics = (body as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((item) => {
    if (item === null || typeof item !== 'object' || typeof (item as { code?: unknown }).code !== 'string') return [];
    return [(item as { code: string }).code];
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

function resultKey(principalKey: string): ResultBeginInput {
  return {
    requestId: `security-result-${principalKey}`,
    principalKey,
    scopeDigest: 'security-result-scope',
    policyRevision: 'security-result-policy',
    populationDigest: 'security-population',
    queryDigest: 'security-query',
    catalogRevision: 'security-catalog-1',
    functionRegistryDigest: 'security-functions-1',
    sourceRevision: 'security-source-1',
    outputId: 'rows',
    taskId: 'security-task',
  };
}

async function materialize(
  store: ReturnType<typeof createResultStore>,
  input: ResultBeginInput,
  owner: string,
): Promise<ReturnType<typeof store.begin>> {
  const ref = resultRef({ scopeDigest: input.scopeDigest });
  const handle = store.begin(input);
  async function* events(): AsyncGenerator<ResultEvent> {
    const descriptor = resultDescriptor(ref);
    const completeDescriptor = {
      ...descriptor,
      counts: {
        loaded: 1,
        population: { kind: 'exact' as const, value: 1, populationDigest: 'security-population' },
      },
      coverage: { kind: 'complete' as const, populationDigest: 'security-population' },
    };
    yield { kind: 'descriptor', descriptor: completeDescriptor };
    yield {
      kind: 'batch',
      result: ref,
      sequence: 0,
      rows: [{ id: owner, owner, secret: `${owner}-secret` }],
    };
    yield {
      kind: 'complete',
      result: ref,
      finalCoverage: completeDescriptor.coverage,
    };
  }
  for await (const _update of handle.subscribe(events())) {
    /* Consume through the production result-store subscription boundary. */
  }
  return handle;
}

describe('vNext security boundaries', () => {
  it('rejects an A-bound serialized request when invoked with B credentials', async () => {
    const fixture = await createTwoTenantFixture();
    try {
      const captured = fixture.tenantA.capturedRequest;
      expect(captured).toBeDefined();
      expect(fixture.tenantA.visibleRows).toEqual([expect.objectContaining({ id: 'tenant-a-private' })]);
      expect(fixture.requests.some((entry) => entry.principal === 'tenant-a' && entry.path === '/adc/execute')).toBe(
        true,
      );
      const before = fixture.tenantB.backend.effects.length;
      const result = await fixture.tenantB.invoke(captured!);
      expect(result.status).toBe('denied');
      expect(result.rows).toEqual([]);
      expect(fixture.tenantB.backend.effects).toHaveLength(before);
      expect(fixture.tenantB.visibleRows).toEqual([]);
      expect(captured?.scopeDigest).toBe(fixture.tenantA.scopeDigest);
    } finally {
      await fixture.dispose();
    }
  });

  it('rejects a cross-tenant cursor before reading the other tenant source', async () => {
    const fixture = await createTwoTenantFixture();
    try {
      const cursor = fixture.tenantA.capturedCursor;
      expect(cursor).toEqual(expect.any(String));
      const before = fixture.tenantB.backend.effects.length;
      const result = await fixture.tenantB.readPage(cursor === undefined ? {} : { cursor });
      expect(result.status).toBe('denied');
      expect(result.diagnostics).toContain('data.stale-cursor');
      expect(fixture.tenantB.backend.effects).toHaveLength(before);
      expect(fixture.tenantB.visibleRows).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it('does not reuse a result cache generation across principals and clears revoked bytes', async () => {
    const store = createResultStore();
    try {
      const alice = await materialize(store, resultKey('alice'), 'alice');
      const bob = await materialize(store, resultKey('bob'), 'bob');
      expect(store.get(resultKey('alice'))).toBe(alice);
      expect(store.get(resultKey('bob'))).toBe(bob);
      expect(store.get({ ...resultKey('bob'), principalKey: 'alice' })).toBe(alice);

      store.revoke({ principalKey: 'alice' });
      expect(alice.snapshot()).toMatchObject({ status: 'denied', batches: [], loadedRows: 0 });
      expect(bob.snapshot()).toMatchObject({ status: 'ready', loadedRows: 1 });
      expect(store.get(resultKey('alice'))).toBeUndefined();
      expect(store.get(resultKey('bob'))).toBe(bob);
    } finally {
      store.dispose();
    }
  });

  it('expires unleased result retention at the configured boundary', async () => {
    let now = 0;
    const store = createResultStore({ ttlMs: 10, now: () => now });
    try {
      const handle = await materialize(store, resultKey('ttl'), 'ttl');
      handle.release();
      now = 9;
      expect(store.get(resultKey('ttl'))).toBe(handle);
      now = 10;
      expect(store.get(resultKey('ttl'))).toBeUndefined();
      expect(handle.snapshot()).toMatchObject({ status: 'disposed', batches: [] });
    } finally {
      store.dispose();
    }
  });

  it('enforces origin allowlists and an application-owned cookie CSRF check', async () => {
    const fixture = await createTwoTenantFixture();
    try {
      const forbidden = await fixture.rawRequest({
        path: '/adc/describe',
        headers: { authorization: 'Bearer tenant-a', origin: 'https://evil.test' },
        body: describeRequest,
      });
      expect(forbidden.status).toBe(403);
      expect(diagnosticCodes(await responseBody(forbidden))).toContain('data.origin');

      const allowed = await fixture.rawRequest({
        path: '/adc/describe',
        headers: { authorization: 'Bearer tenant-a', origin: 'https://app.security.test' },
        body: describeRequest,
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.security.test');

      const service = securityService();
      const cookieHandler = createDataHttpHandler({
        service,
        allowedOrigin: 'https://app.security.test',
        authenticate: (request) =>
          request.headers.get('cookie') === 'session=fixture' && request.headers.get('x-csrf-token') === 'fixture-csrf'
            ? { ok: true, value: { principal: securityPrincipal('tenant-a') } }
            : {
                ok: false,
                diagnostics: [
                  { code: 'data.authorization', message: 'CSRF or session check failed.', retryable: false },
                ],
              },
      });
      const body = JSON.stringify(describeRequest);
      const noCsrf = await cookieHandler(
        new Request('https://security.aeliqo.test/adc/describe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://app.security.test',
            cookie: 'session=fixture',
          },
          body,
        }),
      );
      expect(noCsrf.status).toBe(403);
      const withCsrf = await cookieHandler(
        new Request('https://security.aeliqo.test/adc/describe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://app.security.test',
            cookie: 'session=fixture',
            'x-csrf-token': 'fixture-csrf',
          },
          body,
        }),
      );
      expect(withCsrf.status).toBe(200);
    } finally {
      await fixture.dispose();
    }
  });

  it('rejects cross-origin endpoint configuration and unexpected redirects', async () => {
    expect(() =>
      createHttpDataService({
        baseUrl: 'https://security.aeliqo.test',
        paths: { describe: 'https://evil.test/adc/describe' },
      }),
    ).toThrow('configured origin');

    const redirected = {
      ok: true,
      status: 200,
      redirected: true,
      url: 'https://evil.test/adc/describe',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: null,
    } as unknown as Response;
    const client = createHttpDataService({
      baseUrl: 'https://security.aeliqo.test',
      fetch: async () => redirected,
    });
    const result = await client.describe(describeRequest);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'data.http-origin' }] });
  });

  it('contains untrusted SSR selectors and unsafe rich-text destinations', async () => {
    const page = await renderSsrPeoplePage({
      principal: '</script><script>window.pwned=1</script>',
      direction: 'javascript:alert(1)',
      theme: '<img src=x onerror=alert(1)>',
    });
    expect(page).toContain('people-alpha-v1');
    expect(page).toContain('dir="ltr"');
    expect(page).toContain('data-theme="light"');
    expect(page).not.toContain('window.pwned');
    expect(page).not.toContain('onerror=');
    expect(safeResolvedHref('https://trusted.test/path')).toBe('https://trusted.test/path');
    expect(safeResolvedHref('javascript:alert(1)')).toBeUndefined();
    expect(safeResolvedHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('does not expose prompt-injected rows or accept forged target authority', async () => {
    const fixture = createAgentFixture();
    try {
      const context = await fixture.connection.invoke('aeliqo_surface_context', {});
      expect(context).toMatchObject({ ok: true, value: { value: { targets: [{ id: 'people-main' }] } } });
      expect(JSON.stringify(context)).not.toContain('Ada Chen');
      const forged = await fixture.connection.invoke('aeliqo_surface_render', {
        targetId: 'people-main',
        intent: { kind: 'browse', principalKey: 'tenant-b', html: '<script>steal()</script>', module: './evil.js' },
      });
      expect(forged).toMatchObject({
        ok: false,
        diagnostics: [{ code: expect.stringMatching(/^agent\./u) }],
      });
      const getterPayload = {} as Record<string, unknown>;
      Object.defineProperty(getterPayload, 'targetId', { enumerable: true, get: () => 'people-main' });
      Object.defineProperty(getterPayload, 'intent', { enumerable: true, get: () => ({ kind: 'browse' }) });
      await expect(fixture.connection.invoke('aeliqo_surface_render', getterPayload)).resolves.toMatchObject({
        ok: false,
      });
    } finally {
      await fixture.dispose();
    }
  });

  it('retains ambiguity after a side effect and rejects stale confirmation', async () => {
    const fixture = createActionFixture();
    const preview = await fixture.previewRefund();
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    fixture.host.revokeExecution();
    const denied = await fixture.confirmAndExecute(preview.value);
    expect(denied).toMatchObject({
      ok: false,
      diagnostics: [{ code: expect.stringMatching(/^action\.(denied|stale)$/u) }],
    });
    expect(fixture.backend.effects).toHaveLength(0);
    fixture.dispose();
  });

  it('bounds pending agent work and rejects oversized hostile input', async () => {
    const people = createPeopleFixture();
    const surface = people.runtime.createSurface({
      scope: people.scope,
      id: 'quota-surface',
      feature: people.feature,
      bindings: people.bindings,
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const target: AgentSurfaceTarget = {
      id: 'quota-surface',
      surface,
      render: async ({ signal }) => {
        started();
        await Promise.race([
          gate,
          new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
        ]);
        if (signal.aborted) return { status: 'cancelled', diagnosticCode: 'quota.cancelled' };
        const result = await surface.request({ kind: 'browse' }, { signal, expectedAddress: surface.address });
        return result.status === 'committed'
          ? { status: 'renderer-ready', revision: result.revision }
          : { status: 'failed', diagnosticCode: result.status };
      },
    };
    const endpointScope = Object.freeze({
      ...people.scope,
      subscribe: (_listener: () => void) => () => undefined,
    }) as unknown as import('../../packages/runtime/src/scopes/types.js').ScopeController;
    const endpoint = createScopedSurfaceEndpoint({
      scope: endpointScope,
      sessionId: 'quota-session',
      goalEpoch: 'quota-goal',
      targets: [target],
      transport: 'manual',
      expiresAt: Date.now() + 5_000,
      maxPending: 1,
      maxInputBytes: 128,
      maxMilliseconds: 500,
    });
    expect(endpoint.ok).toBe(true);
    if (!endpoint.ok) return;
    try {
      const first = endpoint.value.invoke(
        'aeliqo_surface_render',
        { targetId: 'quota-surface', intent: { kind: 'browse' } },
        { requestId: 'quota-first' },
      );
      await startedPromise;
      const saturated = await endpoint.value.invoke(
        'aeliqo_surface_render',
        { targetId: 'quota-surface', intent: { kind: 'browse' } },
        { requestId: 'quota-second' },
      );
      expect(saturated).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.budget' }] });
      release();
      await expect(first).resolves.toMatchObject({ ok: true, value: { state: 'renderer-ready' } });
      const oversized = await endpoint.value.invoke(
        'aeliqo_surface_render',
        { targetId: 'quota-surface', intent: { kind: 'browse', text: 'x'.repeat(256) } },
        { requestId: 'quota-large' },
      );
      expect(oversized).toMatchObject({
        ok: true,
        value: { state: 'invalid', diagnostics: [{ code: expect.stringMatching(/bytes/u) }] },
      });
    } finally {
      endpoint.value.close();
      surface.dispose();
      people.dispose();
    }
  });

  it('expires a scoped endpoint and clears its pending work', async () => {
    const people = createPeopleFixture();
    const surface = people.runtime.createSurface({
      scope: people.scope,
      id: 'expiry-surface',
      feature: people.feature,
      bindings: people.bindings,
    });
    let now = 0;
    const endpoint = createScopedSurfaceEndpoint({
      scope: Object.freeze({
        ...people.scope,
        subscribe: (_listener: () => void) => () => undefined,
      }) as unknown as import('../../packages/runtime/src/scopes/types.js').ScopeController,
      sessionId: 'expiry-session',
      goalEpoch: 'expiry-goal',
      targets: [{ id: 'expiry-surface', surface }],
      transport: 'manual',
      expiresAt: 10,
      now: () => now,
    });
    expect(endpoint.ok).toBe(true);
    if (!endpoint.ok) return;
    try {
      await expect(endpoint.value.discover()).resolves.toMatchObject({ ok: true });
      now = 10;
      await expect(endpoint.value.discover()).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: 'agent.protocol.stale' }],
      });
    } finally {
      endpoint.value.close();
      surface.dispose();
      people.dispose();
    }
  });
});
