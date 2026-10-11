import { describe, expect, it } from 'vitest';
import { createResultStore, type ResultEvent } from '../../packages/runtime/src/results/index.js';
import { lineageDigest as computeLineageDigest } from '../../packages/runtime/src/results/store-utils.js';

const ref = {
  id: 'result-1',
  revision: 'source-1',
  sourceLineage: 'source-1',
  outputId: 'rows',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
} as const;
const field = { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const };
const descriptor = {
  version: '1' as const,
  ref,
  taskId: 'task-1',
  fields: [field],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 1, population: { kind: 'exact' as const, value: 1, populationDigest: 'population-1' } },
  precision: { kind: 'exact' as const },
  coverage: { kind: 'complete' as const, populationDigest: 'population-1' },
  consistency: { kind: 'snapshot' as const, snapshotId: 'snapshot-1', sourceRevisions: { employees: 'source-1' } },
  evidence: { kind: 'observed' as const, source: { id: 'employees', revision: 'source-1' } },
  filters: [],
  warnings: [],
  lineage: [],
} as const;
const completeEvents: readonly ResultEvent[] = [
  { kind: 'descriptor', descriptor },
  { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }] },
  { kind: 'complete', result: ref, finalCoverage: descriptor.coverage },
];
const key = (requestId: string) => ({
  principalKey: 'principal-a',
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

async function* from(events: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of events) yield event;
}

async function emptyLineageDigest(): Promise<string> {
  const digest = await computeLineageDigest('rows', []);
  if (digest === undefined) throw new Error('WebCrypto is required for result lineage tests.');
  return digest;
}

async function drain(
  handle: ReturnType<ReturnType<typeof createResultStore>['begin']>,
  source: AsyncIterable<unknown>,
): Promise<void> {
  for await (const _update of handle.subscribe(source)) {
    /* consume */
  }
}

describe('result lifecycle regressions', () => {
  it('keeps a live lease from max-entry eviction and TTL expiry', () => {
    const bounded = createResultStore({ maxEntries: 2 });
    const pinned = bounded.begin(key('pinned'));
    const lease = pinned.retain();
    pinned.release();
    bounded.begin({ ...key('other'), outputId: 'other' }).release();
    bounded.begin({ ...key('third'), outputId: 'third' });
    expect(lease.released).toBe(false);
    expect(pinned.snapshot().status).not.toBe('disposed');

    let now = 0;
    const expiring = createResultStore({ ttlMs: 10, now: () => now });
    const retained = expiring.begin(key('retained'));
    const retainedLease = retained.retain();
    retained.release();
    now = 20;
    expect(expiring.get(retained.key)).toBe(retained);
    expect(retainedLease.released).toBe(false);
    expect(retained.snapshot().status).not.toBe('disposed');
  });

  it('preserves the same-slot carry when maxEntries is one', async () => {
    const store = createResultStore({ maxEntries: 1 });
    const first = store.begin(key('first'));
    await drain(first, from(completeEvents));
    first.release();

    const refresh = store.begin(key('refresh'));
    expect(refresh.snapshot().status).toBe('refreshing');
    expect(refresh.snapshot().loadedRows).toBe(1);
    await drain(
      refresh,
      from([
        {
          kind: 'error',
          requestId: 'refresh',
          error: { code: 'SOURCE_UNAVAILABLE', message: 'Unavailable', retryable: true },
        },
      ]),
    );
    expect(refresh.snapshot().status).toBe('stale');
    expect(refresh.snapshot().batches[0]?.rows[0]?.id).toBe('a');
  });

  it('does not promote a complete row result when exact population rows are missing', async () => {
    const badDescriptor = {
      ...descriptor,
      counts: { loaded: 1, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
    };
    const handle = createResultStore().begin(key('count-mismatch'));
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: badDescriptor },
        completeEvents[1],
        { kind: 'complete', result: ref, finalCoverage: badDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-count');
  });

  it('accepts one server-proven global aggregate row over an exact source population', async () => {
    const lineageDigest = await emptyLineageDigest();
    const aggregateField = {
      id: 'people.global-count',
      label: 'People count',
      type: { value: 'integer' as const, nullable: false },
      role: 'measure' as const,
      derivation: { id: 'people.global-count', revision: '1' },
    };
    const aggregateDescriptor = {
      ...descriptor,
      fields: [aggregateField],
      identity: [],
      rowGrain: [],
      counts: {
        loaded: 1,
        population: { kind: 'exact' as const, value: 1_000_000, populationDigest: 'population-1' },
      },
      evidence: {
        kind: 'computed' as const,
        queryDigest: 'query-1',
        definitions: [{ id: 'people.global-count', revision: '1' }],
      },
      lineageDigest,
    };
    const handle = createResultStore().begin({
      ...key('global-aggregate'),
      sourceLineage: 'source-1',
      planDigest: 'plan-global-aggregate',
      resultShape: 'global-aggregate',
      lineageDigest,
    });
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: aggregateDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ 'people.global-count': 2 }] },
        { kind: 'complete', result: ref, finalCoverage: aggregateDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('ready');
    expect(handle.snapshot().descriptor?.counts.population).toMatchObject({ kind: 'exact', value: 1_000_000 });
  });

  it('accepts a proven complete global aggregate row when its filtered population is empty', async () => {
    const lineageDigest = await emptyLineageDigest();
    const aggregateField = {
      id: 'people.global-count',
      label: 'People count',
      type: { value: 'integer' as const, nullable: false },
      role: 'measure' as const,
      derivation: { id: 'people.global-count', revision: '1' },
    };
    const aggregateDescriptor = {
      ...descriptor,
      fields: [aggregateField],
      identity: [],
      rowGrain: [],
      counts: {
        loaded: 1,
        population: { kind: 'exact' as const, value: 0, populationDigest: 'population-1' },
      },
      evidence: {
        kind: 'computed' as const,
        queryDigest: 'query-1',
        definitions: [{ id: 'people.global-count', revision: '1' }],
      },
      lineageDigest,
    };
    const handle = createResultStore().begin({
      ...key('empty-global-aggregate'),
      sourceLineage: 'source-1',
      planDigest: 'plan-empty-global-aggregate',
      resultShape: 'global-aggregate',
      lineageDigest,
    });
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: aggregateDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ 'people.global-count': 0 }] },
        { kind: 'complete', result: ref, finalCoverage: aggregateDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('ready');
  });

  it('rejects a global aggregate without the accepted lineage proof', async () => {
    const lineageDigest = await emptyLineageDigest();
    const aggregateField = {
      id: 'people.global-count',
      label: 'People count',
      type: { value: 'integer' as const, nullable: false },
      role: 'measure' as const,
      derivation: { id: 'people.global-count', revision: '1' },
    };
    const aggregateDescriptor = {
      ...descriptor,
      fields: [aggregateField],
      identity: [],
      rowGrain: [],
      counts: { loaded: 1, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
      evidence: {
        kind: 'computed' as const,
        queryDigest: 'query-1',
        definitions: [{ id: 'people.global-count', revision: '1' }],
      },
      lineageDigest,
    };
    const handle = createResultStore().begin({
      ...key('aggregate-without-lineage-proof'),
      sourceLineage: 'source-1',
      planDigest: 'plan-global-aggregate',
      resultShape: 'global-aggregate',
    });
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: aggregateDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ 'people.global-count': 2 }] },
        { kind: 'complete', result: ref, finalCoverage: aggregateDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-count');
  });

  it('rejects observed or mismatched evidence for a claimed global aggregate', async () => {
    const lineageDigest = await emptyLineageDigest();
    const aggregateField = {
      id: 'people.global-count',
      label: 'People count',
      type: { value: 'integer' as const, nullable: false },
      role: 'measure' as const,
      derivation: { id: 'people.global-count', revision: '1' },
    };
    const baseAggregate = {
      ...descriptor,
      fields: [aggregateField],
      identity: [],
      rowGrain: [],
      counts: { loaded: 1, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
      lineageDigest,
    };
    const acceptedKey = {
      ...key('aggregate-evidence'),
      sourceLineage: 'source-1',
      planDigest: 'plan-global-aggregate',
      resultShape: 'global-aggregate' as const,
      lineageDigest,
    };
    for (const [requestId, evidence] of [
      ['observed', descriptor.evidence],
      [
        'wrong-definition',
        {
          kind: 'computed' as const,
          queryDigest: 'query-1',
          definitions: [{ id: 'people.other-count', revision: '1' }],
        },
      ],
    ] as const) {
      const candidate = { ...baseAggregate, evidence };
      const handle = createResultStore().begin({ ...acceptedKey, requestId });
      await drain(
        handle,
        from([
          { kind: 'descriptor', descriptor: candidate },
          { kind: 'batch', result: ref, sequence: 0, rows: [{ 'people.global-count': 2 }] },
          { kind: 'complete', result: ref, finalCoverage: candidate.coverage },
        ]),
      );
      expect(handle.snapshot().status).toBe('failed');
      expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-count');
    }
  });

  it('rejects a forged scalar descriptor when the accepted plan is a row result', async () => {
    const lineageDigest = await emptyLineageDigest();
    const aggregateField = {
      id: 'people.global-count',
      label: 'People count',
      type: { value: 'integer' as const, nullable: false },
      role: 'measure' as const,
      derivation: { id: 'people.global-count', revision: '1' },
    };
    const forgedDescriptor = {
      ...descriptor,
      fields: [aggregateField],
      identity: [],
      rowGrain: [],
      counts: { loaded: 1, population: { kind: 'exact' as const, value: 2, populationDigest: 'population-1' } },
      evidence: {
        kind: 'computed' as const,
        queryDigest: 'query-1',
        definitions: [{ id: 'people.global-count', revision: '1' }],
      },
      lineageDigest,
    };
    const handle = createResultStore().begin({
      ...key('forged-global-aggregate'),
      sourceLineage: 'source-1',
      planDigest: 'plan-row-result',
      resultShape: 'rows',
      lineageDigest,
    });
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: forgedDescriptor },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ 'people.global-count': 2 }] },
        { kind: 'complete', result: ref, finalCoverage: forgedDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-count');
  });

  it('does not accept evidence from a source revision outside the descriptor pins', async () => {
    const badEvidenceDescriptor = {
      ...descriptor,
      evidence: { kind: 'observed' as const, source: { id: 'employees', revision: 'source-other' } },
    };
    const handle = createResultStore().begin(key('evidence-mismatch'));
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: badEvidenceDescriptor },
        completeEvents[1],
        { kind: 'complete', result: ref, finalCoverage: badEvidenceDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-evidence');
  });

  it('rejects a same-scope lineage input from another immutable source', async () => {
    const acceptedInput = {
      id: 'accepted-input',
      revision: 'source-1',
      sourceLineage: 'source-1',
      outputId: 'seed',
      queryDigest: 'seed-query',
      scopeDigest: 'scope-1',
    };
    const acceptedLineage = await computeLineageDigest('rows', [{ output: 'rows', inputs: [acceptedInput] }]);
    if (acceptedLineage === undefined) throw new Error('WebCrypto is required for result lineage tests.');
    const forgedLineage = {
      ...descriptor,
      lineageDigest: acceptedLineage,
      lineage: [
        {
          output: 'rows',
          inputs: [
            {
              id: 'same-scope-replay',
              revision: 'source-1',
              sourceLineage: 'other-source-lineage',
              outputId: 'seed',
              queryDigest: 'seed-query',
              scopeDigest: 'scope-1',
            },
          ],
        },
      ],
    };
    const handle = createResultStore().begin({
      ...key('foreign-lineage'),
      sourceLineage: 'source-1',
      planDigest: 'plan-lineage',
      resultShape: 'rows',
      lineageDigest: acceptedLineage,
    });
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: forgedLineage },
        completeEvents[1],
        { kind: 'complete', result: ref, finalCoverage: forgedLineage.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]?.code).toBe('data.result-lineage');
  });

  it('does not carry an authorized result across population changes', async () => {
    const store = createResultStore();
    const first = store.begin(key('population-first'));
    await drain(first, from(completeEvents));
    first.release();
    const changedPopulation = store.begin({ ...key('population-refresh'), populationDigest: 'population-other' });
    expect(changedPopulation.snapshot().status).toBe('loading');
    expect(changedPopulation.snapshot().loadedRows).toBe(0);
  });

  it('keeps result-reference revision distinct from the source revision', async () => {
    const resultRef = { ...ref, revision: 'result-revision-1' };
    const resultDescriptor = { ...descriptor, ref: resultRef };
    const handle = createResultStore().begin(key('result-revision'));
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: resultDescriptor },
        { kind: 'batch', result: resultRef, sequence: 0, rows: [{ id: 'a' }] },
        { kind: 'complete', result: resultRef, finalCoverage: resultDescriptor.coverage },
      ]),
    );
    expect(handle.snapshot().status).toBe('ready');
    expect(handle.snapshot().descriptor?.ref.revision).toBe('result-revision-1');
  });

  it('cancels an idle subscription when its signal aborts', () => {
    const handle = createResultStore().begin(key('idle-abort'));
    const controller = new AbortController();
    handle.subscribe({ next: () => new Promise<IteratorResult<unknown>>(() => {}) }, { signal: controller.signal });
    controller.abort();
    expect(handle.snapshot().status).toBe('cancelled');
  });

  it('refuses capacity overflow while the initial owner remains retained', () => {
    const store = createResultStore({ maxEntries: 1 });
    const owner = store.begin(key('owner'));
    expect(() => store.begin({ ...key('other'), outputId: 'other' })).toThrow(RangeError);
    expect(owner.snapshot().status).toBe('loading');
    owner.release();
    owner.release();
    expect(store.begin({ ...key('other'), outputId: 'other' }).snapshot().status).toBe('loading');
    expect(owner.snapshot().status).toBe('disposed');
  });

  it('rejects omitted partition pins and accessor inputs without invoking them', () => {
    const store = createResultStore();
    expect(() => store.begin({} as never)).toThrow(TypeError);
    let read = false;
    const input = {
      ...key('accessor'),
      get scopeDigest() {
        read = true;
        return 'scope-1';
      },
    };
    expect(() => store.begin(input)).toThrow(TypeError);
    expect(read).toBe(false);
  });

  it('keeps the final coverage in the descriptor and never changes its population', async () => {
    const handle = createResultStore().begin(key('downgrade'));
    const partial = { kind: 'partial' as const, populationDigest: 'population-1', reason: 'source incomplete' };
    await drain(
      handle,
      from([completeEvents[0], completeEvents[1], { kind: 'complete', result: ref, finalCoverage: partial }]),
    );
    expect(handle.snapshot().status).toBe('partial');
    expect(handle.snapshot().descriptor?.coverage).toEqual(partial);
    const { populationDigest: _population, ...unpinned } = key('population-change');
    const other = createResultStore().begin(unpinned);
    const unknownCount = { ...descriptor, counts: { loaded: 1, population: { kind: 'unknown' as const } } };
    await drain(
      other,
      from([
        { kind: 'descriptor', descriptor: unknownCount },
        completeEvents[1],
        { kind: 'complete', result: ref, finalCoverage: { ...partial, populationDigest: 'another-population' } },
      ]),
    );
    expect(other.snapshot().diagnostics[0]?.code).toBe('data.result-population');
  });

  it('accepts an explicit null group identity while rejecting duplicate null groups', async () => {
    const grouped = {
      ...descriptor,
      fields: [{ ...field, role: 'dimension' as const, type: { ...field.type, nullable: true } }],
    };
    const handle = createResultStore().begin(key('null-group'));
    await drain(
      handle,
      from([
        { kind: 'descriptor', descriptor: grouped },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ id: null }] },
        completeEvents[2],
      ]),
    );
    expect(handle.snapshot().status).toBe('ready');
    expect(handle.snapshot().batches[0]?.rows[0]?.id).toBeNull();
    const duplicated = createResultStore().begin(key('duplicate-null'));
    await drain(
      duplicated,
      from([
        {
          kind: 'descriptor',
          descriptor: {
            ...grouped,
            counts: { loaded: 2, population: { kind: 'exact', value: 2, populationDigest: 'population-1' } },
          },
        },
        { kind: 'batch', result: ref, sequence: 0, rows: [{ id: null }, { id: null }] },
      ]),
    );
    expect(duplicated.snapshot().diagnostics[0]?.code).toBe('data.result-identity');
  });
});
