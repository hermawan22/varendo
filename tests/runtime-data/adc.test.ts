import { describe, expect, it } from 'vitest';
import { type Catalog, type MeaningDefinition, type QuerySpec } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import {
  createLocalDataService,
  createDataHttpHandler,
  createHttpDataService,
  type ResultEvent,
  type DataRecord,
  type LocalSnapshot,
  type QueryBudget,
} from '../../packages/runtime/src/data/index.js';

const fields = [
  { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const },
  { id: 'name', label: 'Name', type: { value: 'text' as const, nullable: false }, role: 'attribute' as const },
  { id: 'amount', label: 'Amount', type: { value: 'decimal' as const, nullable: false }, role: 'measure' as const },
  { id: 'active', label: 'Active', type: { value: 'boolean' as const, nullable: true }, role: 'attribute' as const },
];
const catalog: Catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'core-standard-1',
  entities: [
    { id: 'employees', label: 'Employees', identity: ['id'], rowGrain: ['id'], fields },
    { id: 'teams', label: 'Teams', identity: ['id'], rowGrain: ['id'], fields: [fields[0]!] },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const rows: DataRecord[] = [
  { id: 'e-1', name: '😀', amount: { decimal: '10.00' }, active: true },
  { id: 'e-2', name: '𐀀', amount: { decimal: '20.00' }, active: null },
  { id: 'e-3', name: 'a', amount: { decimal: '10.0' }, active: false },
];
const budget: QueryBudget = { maxRows: 10, maxBytes: 100_000, maxMessages: 8, maxMilliseconds: 10_000, maxColumns: 10 };
const query = (overrides: Partial<QuerySpec> = {}): QuerySpec => ({
  entity: 'employees',
  fields: ['id', 'name', 'amount', 'active'],
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
  records: { employees: sourceRows, teams: [{ id: 'team-1' }] },
});
const ok = <T>(value: T) => ({ ok: true as const, value });
const denied = () => ({
  ok: false as const,
  diagnostics: [{ code: 'data.denied', message: 'Denied', retryable: false } as const],
});

describe('in-process ADC data service', () => {
  it('preserves semantic task identity separately from request identity through local and HTTP ADC', async () => {
    const local = createLocalDataService({ snapshot: snapshot() });
    const handler = createDataHttpHandler({ service: local, authenticate: () => ok({ principal: 'fixture-reader' }) });
    const http = createHttpDataService({
      baseUrl: 'https://adc.test',
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    for (const service of [local, http]) {
      const planned = await service.plan({
        version: '1',
        requestId: 'transport-request',
        catalogRevision: catalog.revision,
        target: { taskId: 'semantic-task', outputId: 'rows' },
        query: query(),
        budget,
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
      expect(planned.value.target.taskId).toBe('semantic-task');
      expect(planned.value.requestId).toBe('transport-request');
      const events: ResultEvent[] = [];
      for await (const event of service.execute(planned.value)) events.push(event);
      expect(events.find((event) => event.kind === 'descriptor')).toMatchObject({
        descriptor: { taskId: 'semantic-task' },
      });
      const tampered: ResultEvent[] = [];
      for await (const event of service.execute({
        ...planned.value,
        target: { ...planned.value.target, taskId: 'different-task' },
      }))
        tampered.push(event);
      expect(tampered.some((event) => event.kind === 'descriptor')).toBe(false);
      expect(tampered.some((event) => event.kind === 'error')).toBe(true);
    }
  });
  it('paginates discovery, pins revisions, and rejects client authority fields', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const first = await service.describe({
      version: '1',
      requestId: 'describe-1',
      catalogRevision: null,
      target: { kind: 'catalog' },
      budget,
      pageSize: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.catalogRevision).toBe('catalog-1');
    expect(first.value.catalog.entities).toHaveLength(1);
    expect(first.value.nextCursor).toBeTypeOf('string');
    const second = await service.describe({
      version: '1',
      requestId: 'describe-2',
      catalogRevision: first.value.catalogRevision,
      target: { kind: 'catalog' },
      budget,
      pageSize: 1,
      cursor: first.value.nextCursor!,
    });
    expect(second.ok).toBe(true);
    const stale = await service.describe({
      version: '1',
      requestId: 'describe-3',
      catalogRevision: 'old-catalog',
      target: { kind: 'catalog' },
      budget,
    });
    expect(stale).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-catalog' }] });
    const authority = await service.describe({
      ...({
        version: '1',
        requestId: 'describe-4',
        catalogRevision: null,
        target: { kind: 'catalog' },
        budget,
        principal: 'admin',
      } as unknown as Parameters<typeof service.describe>[0]),
    });
    expect(authority).toMatchObject({ ok: false, diagnostics: [{ code: 'data.catalog-request.shape' }] });
  });

  it('intersects requested budgets with host grants and rejects unsupported query fragments', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      hostBudget: { ...budget, maxRows: 4 },
      authorize: ({ operation }) =>
        operation === 'describe'
          ? ok({ scopeDigest: 'scope-alice' })
          : ok({ scopeDigest: 'scope-alice', maxBudget: { maxRows: 2 } }),
    });
    const accepted = await service.plan({
      version: '1',
      requestId: 'plan-1',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-1', outputId: 'employees-output' },
      query: query(),
      budget,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.effectiveBudget.maxRows).toBe(2);
    expect(accepted.value.supported).toEqual(['projection']);
    const unsupported = await service.plan({
      version: '1',
      requestId: 'plan-2',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-2', outputId: 'employees-output' },
      query: query({ measures: [{ id: 'metric.total', revision: '1' }] }),
      budget,
    });
    expect(unsupported).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.unsupported', remedies: expect.any(Array) }],
    });
    const relationUsage = await service.plan({
      version: '1',
      requestId: 'plan-relations',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-relations', outputId: 'employees-output' },
      query: query({ relationUsage: [{ relation: { id: 'employees.orders', revision: '1' }, kind: 'semi' }] }),
      budget,
    });
    expect(relationUsage).toMatchObject({ ok: false, diagnostics: [{ code: 'data.unsupported' }] });
    const windows = await service.plan({
      version: '1',
      requestId: 'plan-windows',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-windows', outputId: 'employees-output' },
      query: query({
        windows: [
          {
            id: 'rank',
            function: { id: 'core.window.rank', revision: '1' },
            arguments: [],
            partitionBy: [],
            orderBy: [],
            frame: { preceding: 0, following: 0 },
          },
        ],
      }),
      budget,
    });
    expect(windows).toMatchObject({ ok: false, diagnostics: [{ code: 'data.unsupported' }] });
  });

  it('re-authorizes row policies for each principal and keeps principal populations disjoint', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ context }) => {
        const principal = typeof context.principal === 'string' ? context.principal : 'unknown';
        const permitted = principal === 'alice' ? 'e-1' : 'e-2';
        return ok({
          scopeDigest: `scope-${principal}`,
          policyRevision: 'policy-1',
          rowPolicy: ({ row }) => row.id === permitted,
        });
      },
    });
    const planned = await service.plan(
      {
        version: '1',
        requestId: 'plan-alice',
        catalogRevision: 'catalog-1',
        target: { taskId: 'plan-alice', outputId: 'employees-output' },
        query: query(),
        budget,
      },
      { principal: 'alice' },
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const aliceEvents = [];
    for await (const event of service.execute(planned.value, { principal: 'alice' })) aliceEvents.push(event);
    expect(
      aliceEvents.some((event) => event.kind === 'batch' && event.rows.map((row) => row.id).join() === 'e-1'),
    ).toBe(true);
    const replayed = [];
    for await (const event of service.execute(planned.value, { principal: 'bob' })) replayed.push(event);
    expect(replayed[0]).toMatchObject({ kind: 'error', error: { code: 'data.denied' } });
    const bobPlan = await service.plan(
      {
        version: '1',
        requestId: 'plan-bob',
        catalogRevision: 'catalog-1',
        target: { taskId: 'plan-bob', outputId: 'employees-output' },
        query: query(),
        budget,
      },
      { principal: 'bob' },
    );
    expect(bobPlan.ok).toBe(true);
    if (!bobPlan.ok) return;
    const bobEvents = [];
    for await (const event of service.execute(bobPlan.value, { principal: 'bob' })) bobEvents.push(event);
    expect(bobEvents.some((event) => event.kind === 'batch' && event.rows.map((row) => row.id).join() === 'e-2')).toBe(
      true,
    );
  });

  it('evaluates typed projection, decimal predicates, code-point order, partial pages and abort', async () => {
    const service = createLocalDataService({ snapshot: snapshot(), hostBudget: budget });
    const planned = await service.plan({
      version: '1',
      requestId: 'plan-rows',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-rows', outputId: 'employees-output' },
      query: query({
        where: { op: 'compare', field: 'amount', comparison: 'eq', value: { decimal: '10.00' } },
        order: [{ field: 'name', direction: 'asc', nulls: 'last' }],
        page: { size: 1 },
      }),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const events = [];
    for await (const event of service.execute(planned.value)) events.push(event);
    expect(events.map((event) => event.kind)).toEqual(['descriptor', 'batch', 'progress', 'complete']);
    const descriptor = events[0];
    const batch = events[1];
    const complete = events[3];
    expect(descriptor?.kind).toBe('descriptor');
    expect(batch?.kind).toBe('batch');
    expect(complete?.kind).toBe('complete');
    if (descriptor?.kind !== 'descriptor' || batch?.kind !== 'batch' || complete?.kind !== 'complete') return;
    expect(descriptor.descriptor.counts.population).toMatchObject({ kind: 'exact', value: 2 });
    expect(batch.rows).toEqual([{ id: 'e-3', name: 'a', amount: { decimal: '10.0' }, active: false }]);
    expect(complete.finalCoverage).toMatchObject({ kind: 'partial' });
    expect(complete.cursor).toBeTypeOf('string');

    const controller = new AbortController();
    controller.abort();
    const aborted = [];
    for await (const event of service.execute(planned.value, { signal: controller.signal })) aborted.push(event);
    expect(aborted).toHaveLength(1);
    expect(aborted[0]).toMatchObject({ kind: 'error', error: { code: 'data.aborted' } });
  });

  it('pins immutable source revisions and rejects silent same-revision mutation', async () => {
    const callerRows: DataRecord[] = [{ id: 'e-1', name: 'before', amount: { decimal: '1.0' }, active: true }];
    const service = createLocalDataService({ snapshot: snapshot(callerRows) });
    callerRows[0] = { id: 'e-1', name: 'after', amount: { decimal: '2.0' }, active: false };
    const planned = await service.plan({
      version: '1',
      requestId: 'plan-source',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-source', outputId: 'employees-output' },
      query: query(),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const events = [];
    for await (const event of service.execute(planned.value)) events.push(event);
    expect(events.some((event) => event.kind === 'batch' && event.rows[0]?.name === 'before')).toBe(true);
    expect(service.replaceSnapshot(snapshot(callerRows))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.source-revision-conflict' }],
    });
    expect(service.replaceSnapshot(snapshot(callerRows, 'source-2'))).toMatchObject({ ok: true });
    const stale = [];
    for await (const event of service.execute(planned.value)) stale.push(event);
    expect(stale[0]).toMatchObject({ kind: 'error', error: { code: 'data.stale-plan' } });
  });

  it('rejects malformed source rows before exposing a local source', () => {
    expect(() =>
      createLocalDataService({
        snapshot: snapshot([{ id: 'e-1', name: 'missing amount', active: true } as DataRecord]),
      }),
    ).toThrow();
    expect(() =>
      createLocalDataService({
        snapshot: snapshot([
          { id: null, name: 'null identity', amount: { decimal: '1' }, active: true } as unknown as DataRecord,
        ]),
      }),
    ).toThrow();
  });

  it('enforces aggregate host source row and UTF-8 byte limits across replacements', () => {
    const service = createLocalDataService({
      snapshot: snapshot(rows.slice(0, 1)),
      sourceLimits: { rows: 2, bytes: 8 * 1024 },
    });
    expect(service.replaceSnapshot(snapshot(rows.slice(0, 2), 'source-2'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.source-capacity' }],
    });
    expect(service.sourceRevision).toBe('source-1');
    expect(() =>
      createLocalDataService({
        snapshot: snapshot([{ ...rows[0]!, name: '😀'.repeat(100) }]),
        sourceLimits: { rows: 10, bytes: 256 },
      }),
    ).toThrow();
  });

  it('rejects duplicate identity tuples, including decimal scale variants', () => {
    const decimalIdentityCatalog: Catalog = {
      ...catalog,
      revision: 'catalog-decimal-identity',
      entities: catalog.entities.map((entity) =>
        entity.id === 'employees' ? { ...entity, identity: ['amount'], rowGrain: ['amount'] } : entity,
      ),
    };
    expect(() =>
      createLocalDataService({
        snapshot: {
          catalog: decimalIdentityCatalog,
          sourceRevision: 'source-decimal-identity',
          records: {
            employees: [
              { ...rows[0]!, id: 'e-1', amount: { decimal: '1.0' } },
              { ...rows[1]!, id: 'e-2', amount: { decimal: '1.00' } },
            ],
            teams: [{ id: 'team-1' }],
          },
        },
      }),
    ).toThrow();
  });

  it('expires accepted plans and does not let cursors change the normalized query identity', async () => {
    const service = createLocalDataService({ snapshot: snapshot(), planTtlMs: 1, maxPlans: 2 });
    const planned = await service.plan({
      version: '1',
      requestId: 'plan-expire',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-expire', outputId: 'employees-output' },
      query: query({ page: { size: 1 } }),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const expired = [];
    for await (const event of service.execute(planned.value)) expired.push(event);
    expect(expired[0]).toMatchObject({ kind: 'error', error: { code: 'data.expired-plan' } });

    const stable = createLocalDataService({ snapshot: snapshot(), planTtlMs: 5_000 });
    const first = await stable.plan({
      version: '1',
      requestId: 'plan-page-1',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-page-1', outputId: 'employees-output' },
      query: query({ page: { size: 1 } }),
      budget,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstEvents = [];
    for await (const event of stable.execute(first.value)) firstEvents.push(event);
    const complete = firstEvents.find((event) => event.kind === 'complete');
    expect(complete?.kind === 'complete' && complete.cursor).toBeTypeOf('string');
    if (complete?.kind !== 'complete' || complete.cursor === undefined) return;
    const second = await stable.plan({
      version: '1',
      requestId: 'plan-page-2',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-page-1', outputId: 'employees-output' },
      query: query({ page: { size: 1, cursor: complete.cursor } }),
      budget,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.queryDigest).toBe(first.value.queryDigest);
  });

  it('bounds authorization and row-policy waits even without a caller signal', async () => {
    const tinyBudget = { ...budget, maxMilliseconds: 20 };
    const service = createLocalDataService({
      snapshot: snapshot(),
      hostBudget: tinyBudget,
      workNow: () => 0,
      authorize: () =>
        ok({
          scopeDigest: 'scope-timeout',
          policyRevision: 'policy-timeout',
          rowPolicy: () => new Promise<boolean>(() => {}),
        }),
    });
    const planned = await service.plan({
      version: '1',
      requestId: 'plan-timeout',
      catalogRevision: 'catalog-1',
      target: { taskId: 'plan-timeout', outputId: 'employees-output' },
      query: query(),
      budget: tinyBudget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const events = [];
    for await (const event of service.execute(planned.value)) events.push(event);
    expect(events[0]).toMatchObject({ kind: 'error', error: { code: 'data.budget' } });
  });
});

describe('local meaning activation control plane', () => {
  it('registers an allowlisted reviewed bundle idempotently without a client mutation route', () => {
    const registry = createStandardFunctionRegistry('functions-meaning-1');
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const meaningCatalog: Catalog = {
      ...catalog,
      revision: 'catalog-meaning-1',
      functionRegistryDigest: registry.value.digest,
      capabilities: [
        {
          ref: { id: 'absence.metric', revision: '1' },
          entity: 'employees',
          operators: [],
          fields: ['id'],
          relations: [],
          maxOutputRows: 10,
        },
      ],
    };
    const meaning: MeaningDefinition = {
      id: 'meaning.absence',
      revision: '1',
      label: 'Absence',
      explanation: 'Reviewed absence metric',
      output: { value: 'integer', nullable: false },
      implementation: { kind: 'host-capability', capability: { id: 'absence.metric', revision: '1' } },
      dependencies: [],
      functionRegistryDigest: registry.value.digest,
      origin: 'system',
      lifecycle: 'active',
      scope: 'organization',
      authority: 'approved',
      aggregation: 'non-additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    };
    const service = createLocalDataService({
      snapshot: { catalog: meaningCatalog, sourceRevision: 'source-meaning-1', records: { employees: rows } },
      meaningActivation: {
        registry: registry.value,
        policy: {
          policyRevision: 'policy-1',
          allowlistedDefinitions: [meaning],
          allowlistedRefs: [{ id: meaning.id, revision: meaning.revision }],
          minAuthority: 'approved',
        },
      },
    });
    const bundle = {
      catalogRevision: meaningCatalog.revision,
      functionRegistryDigest: registry.value.digest,
      meanings: [meaning],
    };
    const first = service.registerMeaningBundle(bundle);
    expect(first).toMatchObject({ ok: true, value: { idempotent: false, meanings: [meaning] } });
    const second = service.registerMeaningBundle(bundle);
    expect(second).toMatchObject({ ok: true, value: { idempotent: true } });
    expect(service.catalog.meanings).toHaveLength(1);
    expect(service.catalog.revision).not.toBe(meaningCatalog.revision);
  });

  it('reauthorizes a cached bundle after catalog revision changes', () => {
    const registry = createStandardFunctionRegistry('functions-meaning-replay');
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const meaningCatalog: Catalog = {
      ...catalog,
      revision: 'catalog-meaning-replay',
      functionRegistryDigest: registry.value.digest,
      capabilities: [
        {
          ref: { id: 'absence.metric', revision: '1' },
          entity: 'employees',
          operators: [],
          fields: ['id'],
          relations: [],
          maxOutputRows: 10,
        },
      ],
    };
    const meaning: MeaningDefinition = {
      id: 'meaning.absence',
      revision: '1',
      label: 'Absence',
      explanation: 'Reviewed absence metric',
      output: { value: 'integer', nullable: false },
      implementation: { kind: 'host-capability', capability: { id: 'absence.metric', revision: '1' } },
      dependencies: [],
      functionRegistryDigest: registry.value.digest,
      origin: 'system',
      lifecycle: 'active',
      scope: 'organization',
      authority: 'approved',
      aggregation: 'non-additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    };
    const policy = {
      policyRevision: 'policy-replay-1',
      allowlistedDefinitions: [meaning],
      allowlistedRefs: [{ id: meaning.id, revision: meaning.revision }],
      minAuthority: 'approved' as const,
    };
    const service = createLocalDataService({
      snapshot: { catalog: meaningCatalog, sourceRevision: 'source-meaning-replay', records: { employees: rows } },
      meaningActivation: { registry: registry.value, policy },
    });
    const bundle = {
      catalogRevision: meaningCatalog.revision,
      functionRegistryDigest: registry.value.digest,
      meanings: [meaning],
    };
    expect(service.registerMeaningBundle(bundle)).toMatchObject({ ok: true, value: { idempotent: false } });
    policy.allowlistedDefinitions.length = 0;
    expect(service.registerMeaningBundle(bundle)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.activation-denied' }],
    });
  });
});
