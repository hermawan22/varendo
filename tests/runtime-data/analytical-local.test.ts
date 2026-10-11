import { describe, expect, it } from 'vitest';
import { type Catalog, type MeaningDefinition, type QuerySpec } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import {
  createLocalDataService,
  type DataRecord,
  type LocalSnapshot,
  type QueryBudget,
  type ResultEvent,
} from '../../packages/runtime/src/data/index.js';

const registry = createStandardFunctionRegistry();
if (!registry.ok) throw new Error('standard registry unavailable');
const functionRegistryDigest = registry.value.digest;
const budget: QueryBudget = {
  maxRows: 100,
  maxBytes: 500_000,
  maxMessages: 8,
  maxMilliseconds: 10_000,
  maxColumns: 20,
};
const fields = [
  { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const },
  {
    id: 'department',
    label: 'Department',
    type: { value: 'text' as const, nullable: false },
    role: 'dimension' as const,
  },
  { id: 'amount', label: 'Amount', type: { value: 'decimal' as const, nullable: false }, role: 'measure' as const },
  { id: 'at', label: 'At', type: { value: 'instant' as const, nullable: false }, role: 'time' as const },
];
const sumMeaning: MeaningDefinition = {
  id: 'metric.amount-total',
  revision: '1',
  label: 'Amount total',
  explanation: 'Sum of amount',
  output: { value: 'decimal', nullable: true },
  implementation: {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: { id: 'core.aggregate.sum', revision: '1' },
      arguments: [{ kind: 'field', ref: 'amount' }],
    },
  },
  dependencies: [],
  functionRegistryDigest,
  origin: 'system',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'approved',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'exclude-pair',
};
const catalog: Catalog = {
  version: '1',
  revision: 'analytical-catalog-1',
  functionRegistryDigest,
  entities: [{ id: 'events', label: 'Events', identity: ['id'], rowGrain: ['id'], fields }],
  relationships: [],
  meanings: [sumMeaning],
  capabilities: [],
};
const rows: DataRecord[] = [
  { id: 'a', department: 'A', amount: { decimal: '2.50' }, at: '2024-01-01T01:00:00Z' },
  { id: 'b', department: 'A', amount: { decimal: '1.50' }, at: '2024-01-02T01:00:00Z' },
  { id: 'c', department: 'B', amount: { decimal: '4' }, at: '2024-02-01T01:00:00Z' },
];
const snapshot = (sourceRows: readonly DataRecord[] = rows, sourceRevision = 'source-1'): LocalSnapshot => ({
  catalog,
  sourceRevision,
  records: { events: sourceRows },
});
const query = (overrides: Partial<QuerySpec> = {}): QuerySpec => ({
  entity: 'events',
  fields: ['id', 'department'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [],
  ...overrides,
});
async function events(
  service: ReturnType<typeof createLocalDataService>,
  planned: Extract<Awaited<ReturnType<typeof service.plan>>, { ok: true }>['value'],
): Promise<ResultEvent[]> {
  const output: ResultEvent[] = [];
  for await (const event of service.execute(planned)) output.push(event);
  return output;
}

describe('local analytical ADC adapter', () => {
  it('evaluates grouped meanings through the core planner and reports computed evidence', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const planned = await service.plan({
      version: '1',
      requestId: 'group-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'group-plan', outputId: 'events-output' },
      query: query({
        fields: ['department'],
        groupBy: ['department'],
        measures: [{ id: sumMeaning.id, revision: sumMeaning.revision }],
      }),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.diagnostics[0]?.message);
    expect(planned.value.supported).toEqual(['projection', 'grouping', 'aggregation']);
    const output = await events(service, planned.value);
    const descriptor = output.find((event) => event.kind === 'descriptor');
    const batch = output.find((event) => event.kind === 'batch');
    expect(descriptor?.kind).toBe('descriptor');
    expect(batch?.kind).toBe('batch');
    if (descriptor?.kind !== 'descriptor' || batch?.kind !== 'batch') return;
    expect(descriptor.descriptor.fields.map((field) => field.id)).toEqual(['department', 'metric.amount-total']);
    expect(descriptor.descriptor.fields.find((field) => field.id === sumMeaning.id)?.derivation).toEqual({
      id: sumMeaning.id,
      revision: sumMeaning.revision,
    });
    expect(descriptor.descriptor.fields.find((field) => field.id === 'department')?.derivation).toBeUndefined();
    expect(descriptor.descriptor.identity).toEqual(['department']);
    expect(descriptor.descriptor.rowGrain).toEqual(['department']);
    expect(descriptor.descriptor.evidence).toMatchObject({ kind: 'computed', queryDigest: planned.value.queryDigest });
    expect(batch.rows).toEqual([
      { department: 'A', 'metric.amount-total': { decimal: '4' } },
      { department: 'B', 'metric.amount-total': { decimal: '4' } },
    ]);
  });

  it('keeps page identity stable while making coverage partial and issuing a bound cursor', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const planned = await service.plan({
      version: '1',
      requestId: 'page-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'page-plan', outputId: 'events-output' },
      query: query({ page: { size: 1 } }),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.diagnostics[0]?.message);
    const output = await events(service, planned.value);
    const descriptor = output.find((event) => event.kind === 'descriptor');
    const complete = output.find((event) => event.kind === 'complete');
    expect(descriptor?.kind).toBe('descriptor');
    expect(complete?.kind).toBe('complete');
    if (descriptor?.kind !== 'descriptor' || complete?.kind !== 'complete') return;
    expect(descriptor.descriptor.coverage.kind).toBe('partial');
    expect(descriptor.descriptor.counts.population).toMatchObject({ kind: 'exact', value: 3 });
    expect(complete.cursor).toBeTypeOf('string');
    if (typeof complete.cursor !== 'string') throw new Error('Expected a continuation cursor.');
    const second = await service.plan({
      version: '1',
      requestId: 'page-plan-2',
      catalogRevision: catalog.revision,
      target: { taskId: 'page-plan', outputId: 'events-output' },
      query: query({ page: { size: 1, cursor: complete.cursor } }),
      budget,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.diagnostics[0]?.message);
    expect(second.value.queryDigest).toBe(planned.value.queryDigest);
    const differentTask = await service.plan({
      version: '1',
      requestId: 'page-plan-different-task',
      catalogRevision: catalog.revision,
      target: { taskId: 'different-task', outputId: 'events-output' },
      query: query({ page: { size: 1, cursor: complete.cursor } }),
      budget,
    });
    expect(differentTask).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-cursor' }] });
  });

  it('denies a predicate field even when the field is not projected', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: () => ({
        ok: true as const,
        value: {
          scopeDigest: 'scope-filter',
          entities: ['events'],
          fields: { events: ['id', 'department'] },
        },
      }),
    });
    const planned = await service.plan({
      version: '1',
      requestId: 'filter-grant-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'filter-grant-plan', outputId: 'events-output' },
      query: query({ where: { op: 'compare', field: 'amount', comparison: 'gt', value: { decimal: '1' } } }),
      budget,
    });
    expect(planned).toMatchObject({ ok: false, diagnostics: [{ code: 'data.denied' }] });
  });

  it('requires every scanned entity and field grant before planning and rechecks it on execute', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      authorize: ({ operation }) => ({
        ok: true as const,
        value: {
          scopeDigest: 'scope-a',
          policyRevision: operation === 'execute' ? 'policy-2' : 'policy-1',
          entities: ['events'],
          fields: { events: ['id', 'department', 'amount', 'at'] },
        },
      }),
    });
    const planned = await service.plan({
      version: '1',
      requestId: 'grant-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'grant-plan', outputId: 'events-output' },
      query: query(),
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const output = await events(service, planned.value);
    expect(output[0]).toMatchObject({ kind: 'error', error: { code: 'data.denied' } });
  });

  it('applies row policy independently to semijoin target relations before evaluation', async () => {
    const relationCatalog: Catalog = {
      version: '1',
      revision: 'relation-catalog-1',
      functionRegistryDigest,
      entities: [
        {
          id: 'customers',
          label: 'Customers',
          identity: ['id'],
          rowGrain: ['id'],
          fields: [
            fields[0]!,
            { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
          ],
        },
        {
          id: 'orders',
          label: 'Orders',
          identity: ['id'],
          rowGrain: ['id'],
          fields: [
            fields[0]!,
            { id: 'customerId', label: 'Customer', type: { value: 'text', nullable: false }, role: 'attribute' },
          ],
        },
      ],
      relationships: [
        {
          id: 'customer-orders',
          revision: '1',
          sourceEntity: 'customers',
          targetEntity: 'orders',
          keys: [{ sourceField: 'id', targetField: 'customerId' }],
          cardinality: 'one-to-many',
          optional: true,
          joinPolicy: 'validated',
        },
      ],
      meanings: [],
      capabilities: [],
    };
    const relationSnapshot: LocalSnapshot = {
      catalog: relationCatalog,
      sourceRevision: 'relation-source-1',
      records: {
        customers: [
          { id: 'c1', name: 'Allowed' },
          { id: 'c2', name: 'Filtered' },
        ],
        orders: [
          { id: 'o1', customerId: 'c1' },
          { id: 'o2', customerId: 'c2' },
        ],
      },
    };
    const service = createLocalDataService({
      snapshot: relationSnapshot,
      authorize: () => ({
        ok: true as const,
        value: {
          scopeDigest: 'scope-rel',
          policyRevision: 'policy-rel',
          rowPolicy: ({ entityId, row }) => entityId !== 'orders' || row.customerId === 'c1',
        },
      }),
    });
    const relation = { id: 'customer-orders', revision: '1' } as const;
    const planned = await service.plan({
      version: '1',
      requestId: 'semi-plan',
      catalogRevision: relationCatalog.revision,
      target: { taskId: 'semi-plan', outputId: 'customers-output' },
      query: {
        entity: 'customers',
        fields: ['id'],
        measures: [],
        relations: [relation],
        relationUsage: [{ relation, kind: 'semi' }],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
      },
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.diagnostics[0]?.message);
    const output = await events(service, planned.value);
    const batch = output.find((event) => event.kind === 'batch');
    expect(batch?.kind).toBe('batch');
    if (batch?.kind !== 'batch') return;
    expect(batch.rows).toEqual([{ id: 'c1' }]);
  });
});
