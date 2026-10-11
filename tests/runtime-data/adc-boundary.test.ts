import { describe, expect, it } from 'vitest';
import type { Catalog, Outcome, QuerySpec } from '../../packages/core/src/index.js';
import {
  createLocalDataService,
  type AuthorizeRead,
  type DataRecord,
  type LocalSnapshot,
  type ReadGrant,
  type ResultEvent,
  type QueryBudget,
} from '../../packages/runtime/src/data/index.js';

const fields = [
  { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const },
  { id: 'name', label: 'Name', type: { value: 'text' as const, nullable: true }, role: 'attribute' as const },
  { id: 'amount', label: 'Amount', type: { value: 'decimal' as const, nullable: false }, role: 'measure' as const },
  { id: 'teamId', label: 'Team ID', type: { value: 'text' as const, nullable: false }, role: 'attribute' as const },
];
const teamFields = [
  { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const },
  { id: 'name', label: 'Name', type: { value: 'text' as const, nullable: true }, role: 'attribute' as const },
];
const catalog: Catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'core-standard-1',
  entities: [
    { id: 'employees', label: 'Employees', identity: ['id'], rowGrain: ['id'], fields },
    { id: 'teams', label: 'Teams', identity: ['id'], rowGrain: ['id'], fields: teamFields },
  ],
  relationships: [
    {
      id: 'employee-team',
      sourceEntity: 'employees',
      targetEntity: 'teams',
      keys: [{ sourceField: 'teamId', targetField: 'id' }],
      cardinality: 'many-to-one',
      optional: false,
      joinPolicy: 'validated',
      revision: '1',
    },
  ],
  meanings: [],
  capabilities: [
    {
      ref: { id: 'team.lookup', revision: '1' },
      entity: 'teams',
      operators: [],
      fields: ['id'],
      relations: [],
      maxOutputRows: 10,
    },
  ],
};
const rows: DataRecord[] = [
  { id: 'e-1', name: null, amount: { decimal: '1.0' }, teamId: 'team-1' },
  { id: 'e-2', name: 'z', amount: { decimal: '2.0' }, teamId: 'team-2' },
  { id: 'e-3', name: 'a', amount: { decimal: '3.0' }, teamId: 'team-1' },
];
const budget: QueryBudget = {
  maxRows: 20,
  maxBytes: 100_000,
  maxMessages: 8,
  maxMilliseconds: 5_000,
  maxColumns: 10,
};
const makeQuery = (overrides: Partial<QuerySpec> = {}): QuerySpec => ({
  entity: 'employees',
  fields: ['id', 'name', 'amount', 'teamId'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [],
  ...overrides,
});
const snapshot = (sourceRows: readonly DataRecord[] = rows, sourceRevision = 'source-1'): LocalSnapshot => ({
  catalog,
  sourceRevision,
  records: {
    employees: sourceRows,
    teams: [
      { id: 'team-1', name: 'One' },
      { id: 'team-2', name: 'Two' },
    ],
  },
});
const allow = (scopeDigest = 'scope-default', extra: Partial<ReadGrant> = {}): Outcome<ReadGrant> => ({
  ok: true,
  value: { scopeDigest, ...extra },
});
const deny = (): Outcome<ReadGrant> => ({
  ok: false,
  diagnostics: [{ code: 'data.denied', message: 'Denied by test policy.', retryable: false }],
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function collect(iterable: AsyncIterable<ResultEvent>): Promise<ResultEvent[]> {
  const events: ResultEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function accepted(
  service: ReturnType<typeof createLocalDataService>,
  requestId: string,
  query: QuerySpec = makeQuery(),
  context?: { principal?: unknown; signal?: AbortSignal },
) {
  const result = await service.plan(
    {
      version: '1',
      requestId,
      catalogRevision: 'catalog-1',
      target: { taskId: requestId, outputId: 'employees-output' },
      query,
      budget,
    },
    context,
  );
  if (!result.ok) throw new Error(result.diagnostics[0]?.code ?? 'plan failed');
  return result.value;
}

function eventErrorCode(events: readonly ResultEvent[]): string | undefined {
  const first = events[0];
  return first?.kind === 'error' ? first.error.code : undefined;
}

function rowsFrom(events: readonly ResultEvent[]): string[] {
  return events.flatMap((event) => (event.kind === 'batch' ? event.rows.map((row) => String(row.id)) : []));
}

function finalEvent(events: readonly ResultEvent[]) {
  const event = events.at(-1);
  if (event?.kind !== 'complete') throw new Error('Expected a complete result event.');
  return event;
}

function testCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(testCanonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${testCanonical(record[key])}`)
    .join(',')}}`;
}

function recomputeLegacyCursorProof(cursor: Record<string, unknown>, partition: string): string {
  const { proof: _proof, ...unsigned } = cursor;
  let hash = 2_166_136_261;
  const text = `${partition}:${testCanonical(unsigned)}`;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  return `cursor-proof-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

describe('adversarial local ADC authorization and result boundaries', () => {
  it('fails closed for omitted field-scope entities and hides their discovery metadata', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: () => allow('scope-employees', { fields: { employees: ['id', 'name', 'amount', 'teamId'] } }),
    });
    const page = await service.describe({
      version: '1',
      requestId: 'discover-limited',
      catalogRevision: null,
      target: { kind: 'catalog' },
      budget,
      pageSize: 20,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.catalog.entities.map((entity) => entity.id)).toEqual(['employees']);
    expect(page.value.catalog.entities[0]?.fields.map((field) => field.id)).toEqual(['id', 'name', 'amount', 'teamId']);
    expect(page.value.catalog.relationships).toEqual([]);
    expect(page.value.catalog.capabilities).toEqual([]);

    const hiddenTarget = await service.describe({
      version: '1',
      requestId: 'discover-teams',
      catalogRevision: null,
      target: { kind: 'entity', entity: 'teams' },
      budget,
    });
    expect(hiddenTarget).toMatchObject({ ok: false, diagnostics: [{ code: 'data.denied' }] });
  });

  it('keeps authorized populations disjoint for two principals', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ context }) => {
        const principal = context.principal === 'alice' ? 'alice' : 'bob';
        const permitted = principal === 'alice' ? new Set(['e-1', 'e-3']) : new Set(['e-2']);
        return allow(`scope-${principal}`, {
          policyRevision: 'policy-1',
          rowPolicy: ({ row }) => permitted.has(String(row.id)),
        });
      },
    });
    const alice = await accepted(service, 'plan-alice', makeQuery(), { principal: 'alice' });
    const bob = await accepted(service, 'plan-bob', makeQuery(), { principal: 'bob' });
    const aliceRows = rowsFrom(await collect(service.execute(alice, { principal: 'alice' })));
    const bobRows = rowsFrom(await collect(service.execute(bob, { principal: 'bob' })));
    expect(aliceRows).toEqual(['e-1', 'e-3']);
    expect(bobRows).toEqual(['e-2']);
    expect(aliceRows.some((id) => bobRows.includes(id))).toBe(false);
  });

  it('rejects tighter and revoked grants between planning and execution', async () => {
    let phase: 'initial' | 'tight' | 'revoked' = 'initial';
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ operation }) => {
        if (operation === 'execute' && phase === 'revoked') return deny();
        return allow('scope-stable', { maxBudget: phase === 'tight' ? { maxColumns: 2 } : { maxColumns: 10 } });
      },
    });
    const tightPlan = await accepted(service, 'plan-tight');
    phase = 'tight';
    const tightEvents = await collect(service.execute(tightPlan));
    expect(eventErrorCode(tightEvents)).toBe('data.budget');

    phase = 'initial';
    const revokedPlan = await accepted(service, 'plan-revoked');
    phase = 'revoked';
    const revokedEvents = await collect(service.execute(revokedPlan));
    expect(eventErrorCode(revokedEvents)).toBe('data.denied');
  });

  it('turns synchronous and malformed authorization callbacks into structured outcomes with or without a caller signal', async () => {
    const malformed: readonly AuthorizeRead[] = [
      (() => {
        throw new Error('synchronous authorization failure');
      }) as AuthorizeRead,
      (() => null) as unknown as AuthorizeRead,
      (() => ({ ok: true, value: null })) as unknown as AuthorizeRead,
      (() => ({ ok: false, diagnostics: [] })) as unknown as AuthorizeRead,
      (() => Promise.resolve(null)) as unknown as AuthorizeRead,
    ];
    for (const [index, authorize] of malformed.entries()) {
      for (const withSignal of [false, true]) {
        const service = createLocalDataService({ snapshot: snapshot(), authorize });
        const context = withSignal ? { signal: new AbortController().signal } : undefined;
        const result = await service.plan(
          {
            version: '1',
            requestId: `malformed-${index}-${withSignal}`,
            catalogRevision: 'catalog-1',
            target: { taskId: `malformed-${index}-${withSignal}`, outputId: 'employees-output' },
            query: makeQuery(),
            budget,
          },
          context,
        );
        expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'data.authorization' }] });
      }
    }
  });

  it('keeps the final page partial when a page limit covers the last rows of a known population', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const firstPlan = await accepted(
      service,
      'page-first',
      makeQuery({
        order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
        page: { size: 2 },
      }),
    );
    const firstEvents = await collect(service.execute(firstPlan));
    const firstComplete = finalEvent(firstEvents);
    expect(firstComplete.finalCoverage.kind).toBe('partial');
    expect(firstComplete.cursor).toBeTypeOf('string');
    if (firstComplete.cursor === undefined) return;

    const secondPlan = await accepted(
      service,
      'page-first',
      makeQuery({
        order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
        page: { size: 2, cursor: firstComplete.cursor },
      }),
    );
    const secondEvents = await collect(service.execute(secondPlan));
    const secondComplete = finalEvent(secondEvents);
    expect(rowsFrom(secondEvents)).toEqual(['e-3']);
    expect(secondComplete.finalCoverage.kind).toBe('partial');
    expect(secondComplete.cursor).toBeUndefined();
    expect(secondEvents[0]).toMatchObject({
      kind: 'descriptor',
      descriptor: { counts: { population: { kind: 'exact', value: 3 } } },
    });
  });

  it('emits no result data when cancellation arrives during the last async row policy', async () => {
    const lastRowStarted = deferred<void>();
    const never = deferred<boolean>();
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: () =>
        allow('scope-cancel', {
          policyRevision: 'policy-cancel',
          rowPolicy: ({ row }) => {
            if (row.id === 'e-3') {
              lastRowStarted.resolve();
              return never.promise;
            }
            return true;
          },
        }),
    });
    const plan = await accepted(service, 'cancel-last-plan');
    const controller = new AbortController();
    const iterator = service.execute(plan, { signal: controller.signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await lastRowStarted.promise;
    controller.abort();
    const first = await pending;
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ kind: 'error', error: { code: 'data.aborted' } });
    expect((await iterator.next()).done).toBe(true);
  });

  it('rejects an accepted plan when its source is replaced during async execution authorization', async () => {
    const executeStarted = deferred<void>();
    const executeGrant = deferred<Outcome<ReadGrant>>();
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ operation }) =>
        operation === 'execute'
          ? (executeStarted.resolve(), executeGrant.promise)
          : allow('scope-source', { policyRevision: 'policy-source' }),
    });
    const plan = await accepted(service, 'source-race-plan');
    const iterator = service.execute(plan)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await executeStarted.promise;
    expect(
      service.replaceSnapshot(snapshot([{ ...rows[0]!, name: 'new-source' }, ...rows.slice(1)], 'source-2')),
    ).toMatchObject({ ok: true });
    executeGrant.resolve(allow('scope-source', { policyRevision: 'policy-source' }));
    const first = await pending;
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ kind: 'error', error: { code: 'data.stale-plan' } });
    expect((await iterator.next()).done).toBe(true);
  });

  it('places nulls independently of descending value direction', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const run = async (nulls: 'first' | 'last') => {
      const plan = await accepted(
        service,
        `descending-${nulls}`,
        makeQuery({
          fields: ['id', 'name'],
          order: [{ field: 'name', direction: 'desc', nulls }],
        }),
      );
      return rowsFrom(await collect(service.execute(plan)));
    };
    expect(await run('first')).toEqual(['e-1', 'e-2', 'e-3']);
    expect(await run('last')).toEqual(['e-2', 'e-3', 'e-1']);
  });

  it('invalidates cursors when either the filter or authorization scope changes', async () => {
    const filterService = createLocalDataService({ snapshot: snapshot() });
    const filtered = makeQuery({
      where: { op: 'compare', field: 'amount', comparison: 'gt', value: { decimal: '1.0' } },
      order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
      page: { size: 1 },
    });
    const filteredPlan = await accepted(filterService, 'cursor-filter-first', filtered);
    const filteredComplete = finalEvent(await collect(filterService.execute(filteredPlan)));
    expect(filteredComplete.cursor).toBeTypeOf('string');
    if (filteredComplete.cursor === undefined) return;
    const changedFilter = await filterService.plan({
      version: '1',
      requestId: 'cursor-filter-changed',
      catalogRevision: 'catalog-1',
      target: { taskId: 'cursor-filter-first', outputId: 'employees-output' },
      query: {
        ...filtered,
        where: { op: 'compare', field: 'amount', comparison: 'gt', value: { decimal: '2.0' } },
        page: { size: 1, cursor: filteredComplete.cursor },
      },
      budget,
    });
    expect(changedFilter).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });

    let scope = 'scope-a';
    const scopeService = createLocalDataService({ snapshot: snapshot(), authorize: () => allow(scope) });
    const scopedPlan = await accepted(scopeService, 'cursor-scope-first', filtered);
    const scopedComplete = finalEvent(await collect(scopeService.execute(scopedPlan)));
    expect(scopedComplete.cursor).toBeTypeOf('string');
    if (scopedComplete.cursor === undefined) return;
    scope = 'scope-b';
    const changedScope = await scopeService.plan({
      version: '1',
      requestId: 'cursor-scope-changed',
      catalogRevision: 'catalog-1',
      target: { taskId: 'cursor-scope-first', outputId: 'employees-output' },
      query: { ...filtered, page: { size: 1, cursor: scopedComplete.cursor } },
      budget,
    });
    expect(changedScope).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
  });

  it('binds local cursors to the trusted principal partition and expires them', async () => {
    let now = Date.now();
    const service = createLocalDataService({
      snapshot: snapshot(),
      cursorTtlMs: 10,
      now: () => now,
      authorize: ({ context }) =>
        allow('scope-shared', {
          policyRevision: 'policy-shared',
          ...(context.principal === 'alice'
            ? { cursorPartition: 'partition-alice' }
            : { cursorPartition: 'partition-bob' }),
        }),
    });
    const query = makeQuery({ order: [{ field: 'id', direction: 'asc', nulls: 'last' }], page: { size: 1 } });
    const first = await accepted(service, 'partition-first', query, { principal: 'alice' });
    const firstComplete = finalEvent(await collect(service.execute(first, { principal: 'alice' })));
    expect(firstComplete.cursor).toBeTypeOf('string');
    if (firstComplete.cursor === undefined) return;
    expect(firstComplete.cursor).toMatch(/^cursor-/u);
    const forgedCursor = 'cursor-forged-visible-payload';
    const forgedOutcome = await service.plan(
      {
        version: '1',
        requestId: 'partition-first',
        catalogRevision: 'catalog-1',
        target: { taskId: 'partition-first', outputId: 'employees-output' },
        query: { ...query, page: { size: 1, cursor: forgedCursor } },
        budget,
      },
      { principal: 'alice' },
    );
    expect(forgedOutcome).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });

    const crossPrincipal = await service.plan(
      {
        version: '1',
        requestId: 'partition-first',
        catalogRevision: 'catalog-1',
        target: { taskId: 'partition-first', outputId: 'employees-output' },
        query: { ...query, page: { size: 1, cursor: firstComplete.cursor } },
        budget,
      },
      { principal: 'bob' },
    );
    expect(crossPrincipal).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });

    now += 11;
    const expired = await service.plan(
      {
        version: '1',
        requestId: 'partition-first',
        catalogRevision: 'catalog-1',
        target: { taskId: 'partition-first', outputId: 'employees-output' },
        query: { ...query, page: { size: 1, cursor: firstComplete.cursor } },
        budget,
      },
      { principal: 'alice' },
    );
    expect(expired).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
  });

  it('rejects a cursor whose visible fields and legacy proof are recomputed by a client', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: () => allow('scope-shared', { policyRevision: 'policy-shared', cursorPartition: 'partition-alice' }),
    });
    const query = makeQuery({ order: [{ field: 'id', direction: 'asc', nulls: 'last' }], page: { size: 1 } });
    const first = await accepted(service, 'recomputed-cursor', query, { principal: 'alice' });
    const complete = finalEvent(await collect(service.execute(first, { principal: 'alice' })));
    expect(complete.cursor).toBeTypeOf('string');
    if (complete.cursor === undefined) return;
    const forged: Record<string, unknown> = {
      version: 1,
      mode: 'snapshot',
      kind: 'data',
      queryDigest: first.queryDigest,
      scopeDigest: 'scope-shared',
      policyRevision: 'policy-shared',
      sourceRevision: 'source-1',
      snapshotId: 'source-1',
      orderDigest: testCanonical(query.order),
      catalogRevision: 'catalog-1',
      target: testCanonical({ taskId: 'recomputed-cursor', outputId: 'employees-output' }),
      offset: 2,
      expiresAt: Date.now() + 10_000,
    };
    forged.proof = recomputeLegacyCursorProof(forged, 'partition-alice');
    const outcome = await service.plan(
      {
        version: '1',
        requestId: 'recomputed-cursor',
        catalogRevision: 'catalog-1',
        target: { taskId: 'recomputed-cursor', outputId: 'employees-output' },
        query: { ...query, page: { size: 1, cursor: Buffer.from(JSON.stringify(forged)).toString('base64url') } },
        budget,
      },
      { principal: 'alice' },
    );
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
  });

  it('binds accepted plans to the trusted cursor partition at execute time', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      now: () => 1_000,
      authorize: ({ context }) =>
        allow('scope-shared', {
          policyRevision: 'policy-shared',
          cursorPartition: context.principal === 'alice' ? 'partition-alice' : 'partition-bob',
        }),
    });
    const planned = await accepted(service, 'plan-principal-binding', makeQuery(), { principal: 'alice' });
    const events = await collect(service.execute(planned, { principal: 'bob' }));
    expect(events[0]).toMatchObject({ kind: 'error', error: { code: 'data.denied' } });
  });

  it('retains overlapping equivalent plans for distinct trusted cursor partitions', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      now: () => 1_000,
      authorize: ({ context }) =>
        allow('scope-shared', {
          policyRevision: 'policy-shared',
          cursorPartition: context.principal === 'alice' ? 'partition-alice' : 'partition-bob',
        }),
    });
    const query = makeQuery({ order: [{ field: 'id', direction: 'asc', nulls: 'last' }] });
    const request = {
      version: '1' as const,
      requestId: 'equivalent-plan',
      catalogRevision: 'catalog-1',
      target: { taskId: 'equivalent-plan', outputId: 'employees-output' },
      query,
      budget,
    };
    const planAlice = await service.plan(request, { principal: 'alice' });
    const planBob = await service.plan(request, { principal: 'bob' });
    expect(planAlice.ok).toBe(true);
    expect(planBob.ok).toBe(true);
    if (!planAlice.ok || !planBob.ok) return;
    expect(planAlice.value.planDigest).not.toBe(planBob.value.planDigest);
    const aliceEvents = await collect(service.execute(planAlice.value, { principal: 'alice' }));
    const bobEvents = await collect(service.execute(planBob.value, { principal: 'bob' }));
    expect(aliceEvents[0]).toMatchObject({ kind: 'descriptor' });
    expect(bobEvents[0]).toMatchObject({ kind: 'descriptor' });
  });

  it('retains a validated continuation offset when the host cursor registry evicts its token', async () => {
    const service = createLocalDataService({ snapshot: snapshot(), maxCursors: 1 });
    const query = makeQuery({ order: [{ field: 'id', direction: 'asc', nulls: 'last' }], page: { size: 1 } });
    const first = await accepted(service, 'eviction-first', query);
    const firstComplete = finalEvent(await collect(service.execute(first)));
    expect(firstComplete.cursor).toBeTypeOf('string');
    if (firstComplete.cursor === undefined) return;
    const continuation = await accepted(service, 'eviction-first', {
      ...query,
      page: { size: 1, cursor: firstComplete.cursor },
    });
    const other = await accepted(service, 'eviction-other', query);
    await collect(service.execute(other));
    const second = await collect(service.execute(continuation));
    expect(rowsFrom(second)).toEqual(['e-2']);
  });

  it('applies the same partition and expiry binding to discovery cursors', async () => {
    let now = Date.now();
    const service = createLocalDataService({
      snapshot: snapshot(),
      cursorTtlMs: 10,
      now: () => now,
      authorize: ({ context }) =>
        allow('catalog-shared', {
          policyRevision: 'catalog-policy',
          cursorPartition: context.principal === 'alice' ? 'catalog-alice' : 'catalog-bob',
        }),
    });
    const request = {
      version: '1' as const,
      requestId: 'catalog-first',
      catalogRevision: null,
      target: { kind: 'catalog' as const },
      budget,
      pageSize: 1,
    };
    const first = await service.describe(request, { principal: 'alice' });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.nextCursor === undefined) return;
    expect(first.value.nextCursor).toMatch(/^cursor-/u);
    const continuation = {
      ...request,
      requestId: 'catalog-continuation',
      catalogRevision: first.value.catalogRevision,
      cursor: first.value.nextCursor,
    };
    const crossPrincipal = await service.describe(continuation, { principal: 'bob' });
    expect(crossPrincipal).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
    now += 11;
    const expired = await service.describe(continuation, { principal: 'alice' });
    expect(expired).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
  });

  it('keeps elapsed budgets live when the expiry clock is held constant', async () => {
    const wallNow = Date.now();
    let planning = true;
    let workReads = 0;
    const workNow = () => {
      if (planning) return 0;
      workReads += 1;
      return workReads === 1 ? 0 : 10_000;
    };
    const service = createLocalDataService({
      snapshot: snapshot(),
      planTtlMs: 10_000,
      now: () => wallNow,
      workNow,
    });
    const planned = await accepted(service, 'constant-expiry-clock', makeQuery(), undefined);
    expect(planned).toBeDefined();
    planning = false;
    const events = await collect(service.execute(planned));
    expect(events[0]).toMatchObject({ kind: 'error', error: { code: 'data.budget' } });
  });
});
