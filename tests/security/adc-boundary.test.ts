import { describe, expect, it } from 'vitest';
import type { Outcome, QuerySpec, ResultRef, SemanticType } from '../../packages/core/src/index.js';
import { createLocalDataService, type ReadGrant, type ResultEvent } from '../../packages/runtime/src/data/index.js';
import type { CohortMembership, CohortResolver } from '../../packages/runtime/src/evaluation/index.js';
import { createResultStore } from '../../packages/runtime/src/results/index.js';
import { assertNoMaterializedRows, rowsFromResultEvents } from '../../packages/testkit/src/index.js';
import { budget, collect, query, resultRef, securityCatalog, snapshot } from './fixtures.js';

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function rows(events: readonly ResultEvent[]): readonly Record<string, unknown>[] {
  return rowsFromResultEvents(events) as readonly Record<string, unknown>[];
}

const sourceRef: ResultRef = resultRef({
  id: 'cohort-source',
  revision: 'cohort-source-1',
  scopeDigest: 'scope-colliding',
});
const fixedPopulation: QuerySpec['population'] = {
  kind: 'fixed',
  source: sourceRef,
  identityKeys: ['id'],
  cohortDigest: 'cohort-fixed',
};

function membershipFor(principalKey: string): CohortMembership {
  const type: SemanticType = { value: 'text', nullable: false };
  return {
    source: sourceRef,
    identityKeys: ['id'],
    types: [type],
    tuples: [[principalKey === 'alice' ? 'row-alice' : 'row-bob']],
    tupleDigest: 'cohort-fixed',
    scopeDigest: 'scope-colliding',
    policyRevision: 'policy-shared',
    catalogRevision: securityCatalog.revision,
    sourceRevision: sourceRef.revision,
    lineage: [sourceRef],
    complete: true,
  };
}

describe('ADC authorization discrimination', () => {
  it('does not let transport metadata replace the authenticated principal in cohort materialization', async () => {
    const seenPrincipalKeys: string[] = [];
    const resolver: CohortResolver = {
      async resolve(_request, context) {
        seenPrincipalKeys.push(context.principalKey);
        return ok(membershipFor(context.principalKey));
      },
    };
    const resultStore = createResultStore();
    const service = createLocalDataService({
      snapshot: snapshot(),
      cohortResolver: resolver,
      cohortContext: () => ({ resultStore, resolveResult: () => undefined }),
      authorize: () => ok({ scopeDigest: 'scope-colliding', policyRevision: 'policy-shared' }),
    });

    const planned = await service.plan(
      {
        version: '1',
        requestId: 'forged-principal',
        catalogRevision: securityCatalog.revision,
        target: { taskId: 'forged-principal', outputId: 'fixed-employees' },
        query: query({ population: fixedPopulation }),
        budget,
      },
      {
        principal: 'bob',
        metadata: { 'aeliqo-principal-key': 'alice' },
      },
    );

    expect(planned.ok).toBe(true);
    expect(seenPrincipalKeys).toEqual(['bob']);
    resultStore.dispose();
  });

  it('rejects a structured principal without a trusted cohort key, while a host cohort capability may supply one', async () => {
    const seenPrincipalKeys: string[] = [];
    const resolver: CohortResolver = {
      async resolve(_request, context) {
        seenPrincipalKeys.push(context.principalKey);
        return ok(membershipFor(context.principalKey));
      },
    };
    const resultStore = createResultStore();
    const service = createLocalDataService({
      snapshot: snapshot(),
      cohortResolver: resolver,
      cohortContext: () => ({ resultStore, resolveResult: () => undefined }),
      authorize: () => ok({ scopeDigest: 'scope-colliding', policyRevision: 'policy-shared' }),
    });
    const request = {
      version: '1' as const,
      requestId: 'structured-principal-plan',
      catalogRevision: securityCatalog.revision,
      target: { taskId: 'structured-principal-plan', outputId: 'fixed-employees' },
      query: query({ population: fixedPopulation }),
      budget,
    };

    // The application-owned principal is deliberately structured. It cannot
    // select a result-store partition by coercion or by a shared fallback.
    // The ADC security boundary requires a trusted
    // authenticated key, while the in-process cohort capability is the only
    // explicit exception for a host-owned partition.
    const untrusted = await service.plan(request, { principal: { id: 'alice' } });
    expect(untrusted.ok).toBe(false);
    expect(seenPrincipalKeys).toEqual([]);

    const trustedStore = createResultStore();
    const trusted = await service.plan(
      { ...request, requestId: 'structured-principal-with-cohort-key' },
      {
        principal: { id: 'alice' },
        cohort: { principalKey: 'alice', resolver, resultStore: trustedStore, resolveResult: () => undefined },
      },
    );
    expect(trusted.ok).toBe(true);
    expect(seenPrincipalKeys).toEqual(['alice']);
    trustedStore.dispose();
    resultStore.dispose();
  });

  it('rechecks a principal-specific row policy even when scope and policy digests collide', async () => {
    const authorizationCalls: string[] = [];
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ operation, context }) => {
        const principal = typeof context.principal === 'string' ? context.principal : 'unknown';
        authorizationCalls.push(`${operation}:${principal}`);
        const grant: ReadGrant = {
          scopeDigest: 'scope-colliding',
          policyRevision: 'policy-shared',
          rowPolicy: ({ row, context: rowContext }) => row.owner === rowContext.principal,
        };
        return ok(grant);
      },
    });
    const request = {
      version: '1' as const,
      requestId: 'colliding-scope-plan',
      catalogRevision: securityCatalog.revision,
      target: { taskId: 'colliding-scope-plan', outputId: 'employees' },
      query: query(),
      budget,
    };
    const planned = await service.plan(request, { principal: 'alice' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    // The accepted handle was created under Alice's request. Bob may only
    // receive Bob's rows after the execution-time policy is resolved again.
    const replayed: ResultEvent[] = [];
    for await (const event of service.execute(planned.value, { principal: 'bob' })) replayed.push(event);
    expect(authorizationCalls).toEqual(['plan:alice', 'execute:bob']);
    expect(rows(replayed)).toEqual([{ id: 'row-bob', owner: 'bob', secret: 'bob-secret' }]);
    expect(rows(replayed).some((row) => row.secret === 'alice-secret')).toBe(false);
  });

  it('emits no result materialization when the host revokes permission and aborts an in-flight scan', async () => {
    let revoke!: () => void;
    const revoked = new Promise<void>((resolve) => {
      revoke = resolve;
    });
    const controller = new AbortController();
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ operation }) =>
        ok({
          scopeDigest: 'scope-alice',
          policyRevision: 'policy-alice',
          rowPolicy: async ({ row, context }) => {
            if (operation === 'execute' && row.id === 'row-alice') {
              revoke();
              controller.abort();
            }
            return true;
          },
        }),
    });
    const planned = await service.plan(
      {
        version: '1',
        requestId: 'revocation-plan',
        catalogRevision: securityCatalog.revision,
        target: { taskId: 'revocation-plan', outputId: 'employees' },
        query: query(),
        budget,
      },
      { principal: 'alice' },
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const eventsPromise = collect(service.execute(planned.value, { principal: 'alice', signal: controller.signal }));
    await revoked;
    const events = await eventsPromise;
    expect(events).toEqual([
      { kind: 'error', requestId: 'revocation-plan', error: expect.objectContaining({ code: 'data.aborted' }) },
    ]);
    assertNoMaterializedRows(events);
    expect(rows(events)).toHaveLength(0);
  });
});
