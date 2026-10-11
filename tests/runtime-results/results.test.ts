import { describe, expect, it } from 'vitest';
import {
  createResultStore,
  type ResultBeginInput,
  type ResultEvent,
} from '../../packages/runtime/src/results/index.js';

const field = { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const };
const ref = {
  id: 'result-1',
  revision: 'source-1',
  sourceLineage: 'source-1',
  outputId: 'rows',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
} as const;
const descriptor = {
  version: '1' as const,
  ref,
  taskId: 'task-1',
  fields: [field],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 2, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
  precision: { kind: 'exact' as const },
  coverage: { kind: 'complete' as const, populationDigest: 'population-1' },
  consistency: { kind: 'snapshot' as const, snapshotId: 'snapshot-1', sourceRevisions: { employees: 'source-1' } },
  evidence: { kind: 'observed' as const, source: { id: 'employees', revision: 'source-1' } },
  filters: [],
  warnings: [],
  lineage: [],
} as const;
const key = (requestId = 'request-1', principalKey = 'principal-a'): ResultBeginInput => ({
  principalKey,
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  queryDigest: 'query-1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  sourceRevision: 'source-1',
  outputId: 'rows',
  taskId: 'task-1',
  requestId,
  populationDigest: 'population-1',
});
const events: ResultEvent[] = [
  { kind: 'descriptor', descriptor },
  { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }] },
  { kind: 'batch', result: ref, sequence: 1, rows: [{ id: 'b' }] },
  { kind: 'complete', result: ref, finalCoverage: descriptor.coverage },
];

async function* from(eventsToRead: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of eventsToRead) yield event;
}

async function collect(
  handle: ReturnType<ReturnType<typeof createResultStore>['begin']>,
  source: AsyncIterable<unknown>,
) {
  const updates = [];
  for await (const update of handle.subscribe(source)) updates.push(update);
  return updates;
}

describe('result store handles', () => {
  it('validates untrusted events and exposes immutable ready data', async () => {
    const store = createResultStore();
    const handle = store.begin(key());
    const updates = await collect(handle, from(events));
    expect(
      updates.map((update) => ('event' in update ? (update as { readonly event: ResultEvent }).event.kind : undefined)),
    ).toEqual(['descriptor', 'batch', 'batch', 'complete']);
    const snapshot = handle.snapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.loadedRows).toBe(2);
    expect(snapshot.descriptor?.evidence.kind).toBe('observed');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.batches[0])).toBe(true);
    expect(() => ((snapshot.batches[0]!.rows[0] as Record<string, unknown>).id = 'forged')).toThrow();
    expect(handle.snapshot().batches[0]!.rows[0]!.id).toBe('a');
  });

  it('pins accepted-plan descriptors to their source revision and lineage', async () => {
    for (const forgedRef of [
      { ...ref, revision: 'other-revision' },
      { ...ref, sourceLineage: 'other-lineage' },
    ]) {
      const handle = createResultStore().begin({
        ...key(`accepted-source-${forgedRef.revision}`),
        sourceLineage: 'source-1',
        planDigest: 'plan-1',
        resultShape: 'rows',
      });
      await collect(handle, from([{ kind: 'descriptor', descriptor: { ...descriptor, ref: forgedRef } }]));
      expect(handle.snapshot().status).toBe('failed');
      expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-lineage');
    }
  });

  it('accepts an advanced live revision only under the accepted immutable lineage', async () => {
    const liveRef = { ...ref, revision: 'source-2' };
    const liveDescriptor = {
      ...descriptor,
      ref: liveRef,
      consistency: {
        kind: 'mixed' as const,
        sourceLineage: 'source-1',
        sourceRevisions: { employees: 'source-2' },
        reason: 'live keyset publication',
      },
      evidence: { kind: 'observed' as const, source: { id: 'employees', revision: 'source-2' } },
    };
    const handle = createResultStore().begin({
      ...key('accepted-live-revision'),
      sourceLineage: 'source-1',
      planDigest: 'plan-1',
      resultShape: 'rows',
    });
    await collect(
      handle,
      from([
        { kind: 'descriptor', descriptor: liveDescriptor },
        { ...events[1], result: liveRef },
        { ...events[2], result: liveRef },
        { ...events[3], result: liveRef },
      ]),
    );
    expect(handle.snapshot().status).toBe('ready');
    expect(handle.snapshot().descriptor?.ref.revision).toBe('source-2');
  });

  it('rejects type, identity, sequence and count inconsistencies', async () => {
    const cases: readonly [string, readonly unknown[]][] = [
      ['unknown field', [events[0], { ...events[1], rows: [{ id: 'a', secret: 'x' }] }]],
      ['wrong value type', [events[0], { ...events[1], rows: [{ id: 1 }] }]],
      ['duplicate identity', [events[0], { ...events[1], rows: [{ id: 'a' }, { id: 'a' }] }]],
      ['sequence gap', [events[0], { ...events[1], sequence: 1, rows: [{ id: 'a' }] }]],
      [
        'count overflow',
        [events[0], { ...events[1], rows: [{ id: 'a' }, { id: 'b' }] }, { ...events[2], rows: [{ id: 'c' }] }],
      ],
    ];
    for (const [_label, input] of cases) {
      const store = createResultStore();
      const handle = store.begin(key());
      await collect(handle, from(input));
      expect(handle.snapshot().status).toBe('failed');
      expect(handle.snapshot().diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('normalizes decimal identity tuples and refuses over-budget descriptors', async () => {
    const decimalField = {
      id: 'amount',
      label: 'Amount',
      type: { value: 'decimal' as const, nullable: false },
      role: 'identity' as const,
    };
    const decimalRef = { ...ref, id: 'decimal-result' };
    const decimalDescriptor = {
      ...descriptor,
      ref: decimalRef,
      fields: [decimalField],
      identity: ['amount'],
      rowGrain: ['amount'],
      counts: { loaded: 2, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
      consistency: { kind: 'snapshot' as const, snapshotId: 'snapshot-1', sourceRevisions: { employees: 'source-1' } },
    };
    const decimalKey = { ...key(), outputId: 'rows', requestId: 'request-decimal' };
    const duplicate = createResultStore().begin(decimalKey);
    await collect(
      duplicate,
      from([
        { kind: 'descriptor', descriptor: decimalDescriptor },
        {
          kind: 'batch',
          result: decimalRef,
          sequence: 0,
          rows: [{ amount: { decimal: '1.0' } }, { amount: { decimal: '1.00' } }],
        },
      ]),
    );
    expect(duplicate.snapshot().status).toBe('failed');
    expect(duplicate.snapshot().diagnostics[0]?.code).toBe('data.result-identity');

    const overBudget = createResultStore({ maxBytes: 128 }).begin(key('request-over-budget'));
    await collect(overBudget, from([events[0]]));
    expect(overBudget.snapshot().status).toBe('failed');
    expect(overBudget.snapshot().descriptor).toBeUndefined();
  });

  it('keeps partial coverage separate from ready completeness and rejects terminal promotion', async () => {
    const partialDescriptor = {
      ...descriptor,
      coverage: { kind: 'partial' as const, populationDigest: 'population-1', reason: 'page budget' },
    };
    const partialEvents: ResultEvent[] = [
      { kind: 'descriptor', descriptor: partialDescriptor },
      { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }, { id: 'b' }] },
      { kind: 'complete', result: ref, finalCoverage: partialDescriptor.coverage },
    ];
    const partialStore = createResultStore();
    const partialHandle = partialStore.begin(key());
    await collect(partialHandle, from(partialEvents));
    expect(partialHandle.snapshot().status).toBe('partial');
    expect(partialHandle.snapshot().descriptor?.coverage.kind).toBe('partial');

    const pagedDescriptor = {
      ...partialDescriptor,
      counts: { loaded: 1, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
    };
    const paged = partialStore.begin(key('request-paged'));
    await collect(
      paged,
      from([
        { kind: 'descriptor', descriptor: pagedDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }] },
        { kind: 'progress', result: ref, completed: 1, total: 2, unit: 'rows' },
        { kind: 'complete', result: ref, finalCoverage: pagedDescriptor.coverage },
      ]),
    );
    expect(paged.snapshot().status).toBe('partial');

    const promoted = partialStore.begin(key('request-promoted'));
    await collect(
      promoted,
      from([
        { kind: 'descriptor', descriptor: partialDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }, { id: 'b' }] },
        { kind: 'complete', result: ref, finalCoverage: descriptor.coverage },
      ]),
    );
    expect(promoted.snapshot().status).toBe('stale');
    expect(promoted.snapshot().diagnostics[0]?.code).toBe('data.result-coverage');
  });

  it('preserves authorized data on refresh failure while newer generations win', async () => {
    const store = createResultStore();
    const first = store.begin(key());
    await collect(first, from(events));
    const refresh = store.begin(key('request-refresh'));
    expect(refresh.snapshot().status).toBe('refreshing');
    expect(refresh.snapshot().loadedRows).toBe(2);
    await collect(
      refresh,
      from([
        {
          kind: 'error',
          requestId: 'request-refresh',
          error: { code: 'SOURCE_UNAVAILABLE', message: 'Unavailable', retryable: true },
        },
      ]),
    );
    expect(refresh.snapshot().status).toBe('stale');
    expect(refresh.snapshot().loadedRows).toBe(2);
    expect(refresh.snapshot().batches[0]!.rows[0]!.id).toBe('a');

    let resolvePending: ((result: IteratorResult<unknown>) => void) | undefined;
    const uncooperative: AsyncIterator<unknown> = {
      next: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          resolvePending = resolve;
        }),
      return: () => new Promise<IteratorResult<unknown>>(() => {}),
    };
    const pendingHandle = store.begin(key('request-pending'));
    const pending = pendingHandle.subscribe(uncooperative).next();
    const newest = store.begin(key('request-newest'));
    await expect(
      Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error('stale pull did not settle')), 100)),
      ]),
    ).resolves.toMatchObject({ done: true });
    resolvePending?.({ done: false, value: events[0] });
    expect(newest.snapshot().status).toBe('refreshing');
    expect(pendingHandle.snapshot().status).toBe('stale');
  });

  it('scopes cache partitions, leases, and revocation without serializing principal keys', async () => {
    const store = createResultStore();
    const alice = store.begin(key('request-alice', 'principal-alice'));
    const bob = store.begin(key('request-bob', 'principal-bob'));
    await collect(alice, from(events));
    await collect(bob, from(events));
    const lease = alice.retain();
    expect(lease.released).toBe(false);
    const revocableLease = alice.retain();
    lease.release();
    lease.release();
    store.revoke({ principalKey: 'principal-alice', scopeDigest: 'scope-1', policyRevision: 'policy-1' });
    expect(revocableLease.released).toBe(true);
    expect(alice.snapshot().status).toBe('denied');
    expect(alice.snapshot().loadedRows).toBe(0);
    expect(alice.snapshot().batches).toHaveLength(0);
    expect(store.get(bob.key)).toBe(bob);
    expect(bob.snapshot().status).toBe('ready');
    expect(JSON.stringify(alice.snapshot())).not.toContain('principal-alice');
  });

  it('pulls one bounded event at a time and wins an abort race without awaiting cleanup', async () => {
    let pulls = 0;
    const source: AsyncIterator<unknown> = {
      next: () => {
        pulls += 1;
        return Promise.resolve({ done: pulls > 1, value: events[pulls - 1] });
      },
    };
    const store = createResultStore();
    const handle = store.begin(key());
    const subscription = handle.subscribe(source);
    expect(pulls).toBe(0);
    await subscription.next();
    expect(pulls).toBe(1);
    await subscription.next();
    expect(pulls).toBe(2);

    let abortCleanupCalled = false;
    let resolvePending: ((result: IteratorResult<unknown>) => void) | undefined;
    const pendingSource: AsyncIterator<unknown> = {
      next: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          resolvePending = resolve;
        }),
      return: () => {
        abortCleanupCalled = true;
        return new Promise<IteratorResult<unknown>>(() => {});
      },
    };
    const abortController = new AbortController();
    const pendingHandle = store.begin(key('request-abort'));
    const pendingSubscription = pendingHandle.subscribe(pendingSource, { signal: abortController.signal });
    const pending = pendingSubscription.next();
    abortController.abort();
    await expect(
      Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error('abort race did not settle')), 100)),
      ]),
    ).resolves.toMatchObject({ value: { snapshot: { status: 'cancelled' } } });
    await pendingSubscription.return?.();
    expect(abortCleanupCalled).toBe(true);
    resolvePending?.({ done: false, value: events[0] });
  });

  it('evicts bounded cache generations and expires idle handles', async () => {
    let now = 0;
    const store = createResultStore({ maxEntries: 1, ttlMs: 10, now: () => now });
    const first = store.begin(key());
    await collect(first, from(events));
    first.release();
    now = 5;
    const second = store.begin(key('request-second'));
    expect(first.snapshot().status).toBe('disposed');
    expect(store.get(second.key)).toBe(second);
    second.release();
    now = 20;
    expect(store.get(second.key)).toBeUndefined();
    expect(second.snapshot().status).toBe('disposed');
  });
});
