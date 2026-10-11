import { describe, expect, it } from 'vitest';
import { type Catalog, type MeaningDefinition, type QuerySpec } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import {
  createLocalDataService,
  type DataRecord,
  type DataService,
  type LocalDataService,
  type LocalSnapshot,
  type QueryBudget,
  type ReadGrant,
  type ResultEvent,
} from '../../packages/runtime/src/data/index.js';
import { createDataHttpHandler, createHttpDataService } from '../../packages/runtime/src/data/http.js';

const registryOutcome = createStandardFunctionRegistry();
if (!registryOutcome.ok) throw new Error('The standard query registry is required for the commerce fixture.');
const registry = registryOutcome.value;

const totalMeaning: MeaningDefinition = {
  id: 'order.total',
  revision: '1',
  label: 'Order total',
  explanation: 'Sum order amounts over the selected order grain.',
  output: { value: 'decimal', nullable: false },
  implementation: {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: { id: 'core.aggregate.sum', revision: '1' },
      arguments: [{ kind: 'field', entity: 'orders', ref: 'amount' }],
    },
  },
  dependencies: [],
  functionRegistryDigest: registry.digest,
  origin: 'system',
  lifecycle: 'active',
  scope: 'organization',
  authority: 'approved',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'reject',
};

const fields = {
  orderId: {
    id: 'id',
    label: 'Order ID',
    type: { value: 'text' as const, nullable: false },
    role: 'identity' as const,
  },
  customerId: {
    id: 'customerId',
    label: 'Customer ID',
    type: { value: 'text' as const, nullable: false },
    role: 'attribute' as const,
  },
  region: {
    id: 'region',
    label: 'Region',
    type: { value: 'text' as const, nullable: false },
    role: 'dimension' as const,
  },
  amount: {
    id: 'amount',
    label: 'Amount',
    type: { value: 'decimal' as const, nullable: false },
    role: 'measure' as const,
  },
  tenant: {
    id: 'tenant',
    label: 'Tenant',
    type: { value: 'text' as const, nullable: false },
    role: 'attribute' as const,
  },
  customerActive: {
    id: 'active',
    label: 'Active',
    type: { value: 'boolean' as const, nullable: false },
    role: 'attribute' as const,
  },
};

const customerEntity = {
  id: 'customers',
  label: 'Customers',
  identity: ['id'] as const,
  rowGrain: ['id'] as const,
  fields: [fields.orderId, fields.customerActive, fields.tenant],
};
const orderEntity = {
  id: 'orders',
  label: 'Orders',
  identity: ['id'] as const,
  rowGrain: ['id'] as const,
  fields: [fields.orderId, fields.customerId, fields.region, fields.amount, fields.tenant],
};
const customerRelationship = {
  id: 'orders.customer',
  revision: '1',
  sourceEntity: 'orders',
  targetEntity: 'customers',
  keys: [{ sourceField: 'customerId', targetField: 'id' }] as const,
  cardinality: 'many-to-one' as const,
  optional: false,
  joinPolicy: 'validated' as const,
};
const catalog: Catalog = {
  version: '1',
  revision: 'commerce-catalog-1',
  functionRegistryDigest: registry.digest,
  entities: [orderEntity, customerEntity],
  relationships: [customerRelationship],
  meanings: [totalMeaning],
  capabilities: [],
};

const records: Readonly<Record<string, readonly DataRecord[]>> = {
  orders: [
    { id: 'o-1', customerId: 'c-1', region: 'north', amount: { decimal: '10.25' }, tenant: 'acme' },
    { id: 'o-2', customerId: 'c-1', region: 'north', amount: { decimal: '15.00' }, tenant: 'acme' },
    { id: 'o-3', customerId: 'c-2', region: 'south', amount: { decimal: '20.50' }, tenant: 'acme' },
    { id: 'o-4', customerId: 'c-3', region: 'west', amount: { decimal: '5.25' }, tenant: 'acme' },
    { id: 'o-5', customerId: 'c-4', region: 'east', amount: { decimal: '99.99' }, tenant: 'other' },
  ],
  customers: [
    { id: 'c-1', active: true, tenant: 'acme' },
    { id: 'c-2', active: true, tenant: 'acme' },
    { id: 'c-3', active: false, tenant: 'acme' },
    { id: 'c-4', active: true, tenant: 'other' },
  ],
};

const budget: QueryBudget = {
  maxRows: 20,
  maxBytes: 100_000,
  maxMessages: 10,
  maxMilliseconds: 5_000,
  maxColumns: 20,
};
const allOrderFields = ['id', 'customerId', 'region', 'amount', 'tenant'];
const allCustomerFields = ['id', 'active', 'tenant'];
const customerRelation = { id: customerRelationship.id, revision: customerRelationship.revision };

function snapshot(sourceRevision = 'commerce-source-1'): LocalSnapshot {
  return { catalog, sourceRevision, records };
}

function grant(
  fieldsByEntity: Readonly<Record<string, readonly string[]>> = {
    orders: allOrderFields,
    customers: allCustomerFields,
  },
  scopeDigest = 'scope-acme',
): ReadGrant {
  return {
    scopeDigest,
    policyRevision: 'policy-1',
    entities: ['orders', 'customers'],
    fields: fieldsByEntity,
    rowPolicy: ({ row }) => row.tenant === 'acme',
  };
}

function makeLocal(readGrant: ReadGrant = grant(), sourceRevision = 'commerce-source-1'): LocalDataService {
  return createLocalDataService({
    snapshot: snapshot(sourceRevision),
    functionRegistry: registry,
    authorize: () => ({ ok: true, value: readGrant }),
  });
}

const requestFor = (query: QuerySpec, requestId = 'commerce-request-1') => ({
  version: '1' as const,
  requestId,
  catalogRevision: catalog.revision,
  target: { taskId: requestId, outputId: 'orders-output' },
  query,
  budget,
});

function through(handler: ReturnType<typeof createDataHttpHandler>): typeof fetch {
  return async (input, init) => handler(new Request(input, init));
}

async function collect(events: AsyncIterable<ResultEvent>): Promise<ResultEvent[]> {
  const values: ResultEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}

async function planAndCollect(service: DataService, query: QuerySpec, requestId = 'commerce-request-1') {
  const planned = await service.plan(requestFor(query, requestId));
  if (!planned.ok) throw new Error(planned.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  return { accepted: planned.value, events: await collect(service.execute(planned.value)) };
}

function httpFor(local: LocalDataService): ReturnType<typeof createHttpDataService> {
  const handler = createDataHttpHandler({
    service: local,
    authenticate: () => ({ ok: true, value: { principal: 'commerce-test' } }),
  });
  return createHttpDataService({ baseUrl: 'https://commerce.test', fetch: through(handler) });
}

const groupedTopK: QuerySpec = {
  entity: 'orders',
  fields: ['region'],
  measures: [{ id: totalMeaning.id, revision: totalMeaning.revision }],
  relations: [],
  groupBy: ['region'],
  population: { kind: 'all-authorized' },
  order: [{ field: totalMeaning.id, direction: 'desc', nulls: 'last' }],
  page: { size: 1 },
};

const activeCustomerOrders: QuerySpec = {
  entity: 'orders',
  fields: ['id', 'region'],
  measures: [],
  relations: [customerRelation],
  relationUsage: [
    {
      relation: customerRelation,
      kind: 'semi',
      where: { op: 'compare', field: 'active', comparison: 'eq', value: true },
    },
  ],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
};

describe('commerce analytical local/HTTP parity', () => {
  it('executes decimal grouped totals and bounded top-K with exact independent expected values', async () => {
    const local = makeLocal();
    const http = httpFor(local);
    const direct = await planAndCollect(local, groupedTopK);
    const remote = await planAndCollect(http, groupedTopK);

    // Separately accepted leases may have different expiry and content identities.
    const { expiresAt: directExpiry, planDigest: directDigest, ...directPlan } = direct.accepted;
    const { expiresAt: remoteExpiry, planDigest: remoteDigest, ...remotePlan } = remote.accepted;
    expect(remotePlan).toEqual(directPlan);
    expect(directExpiry).toBeGreaterThan(Date.now());
    expect(remoteExpiry).toBeGreaterThan(Date.now());
    expect(directDigest).toMatch(/^plan-/);
    expect(remoteDigest).toMatch(/^plan-/);
    // The same accepted handle must retain its complete event lineage over HTTP.
    expect(await collect(http.execute(direct.accepted))).toEqual(direct.events);
    expect(await collect(local.execute(remote.accepted))).toEqual(remote.events);
    const batch = direct.events.find((event) => event.kind === 'batch');
    if (batch?.kind !== 'batch') throw new Error('The grouped query did not emit a batch.');
    expect(batch.rows).toEqual([{ region: 'north', 'order.total': { decimal: '25.25' } }]);

    const descriptor = direct.events.find((event) => event.kind === 'descriptor');
    if (descriptor?.kind !== 'descriptor') throw new Error('The grouped query did not emit a descriptor.');
    expect(descriptor.descriptor.ref.scopeDigest).toBe('scope-acme');
    expect(descriptor.descriptor.rowGrain).toEqual(['region']);
    expect(descriptor.descriptor.precision).toEqual({ kind: 'exact' });
    expect(descriptor.descriptor.coverage.kind).toBe('partial');
    expect(descriptor.descriptor.evidence.kind).toBe('computed');
    expect(descriptor.descriptor.consistency).toMatchObject({
      kind: 'snapshot',
      sourceRevisions: { orders: 'commerce-source-1' },
    });
  });

  it('preserves semijoin meaning and per-entity row policy through the HTTP adapter', async () => {
    const local = makeLocal();
    const http = httpFor(local);
    const direct = await planAndCollect(local, activeCustomerOrders, 'commerce-relation-1');
    const remote = await planAndCollect(http, activeCustomerOrders, 'commerce-relation-1');

    expect(await collect(http.execute(direct.accepted))).toEqual(direct.events);
    expect(await collect(local.execute(remote.accepted))).toEqual(remote.events);
    const batch = direct.events.find((event) => event.kind === 'batch');
    if (batch?.kind !== 'batch') throw new Error('The relation query did not emit a batch.');
    expect(batch.rows).toEqual([
      { id: 'o-1', region: 'north' },
      { id: 'o-2', region: 'north' },
      { id: 'o-3', region: 'south' },
    ]);
    expect(batch.rows).not.toContainEqual({ id: 'o-4', region: 'west' });
    expect(batch.rows).not.toContainEqual({ id: 'o-5', region: 'east' });
  });

  it('denies a plan when a hidden relationship dependency field is outside the grant', async () => {
    const restricted = grant({
      orders: ['id', 'region', 'amount', 'tenant'],
      customers: ['id', 'active', 'tenant'],
    });
    const local = makeLocal(restricted);
    const http = httpFor(local);
    const direct = await local.plan(requestFor(activeCustomerOrders, 'commerce-hidden-1'));
    const remote = await http.plan(requestFor(activeCustomerOrders, 'commerce-hidden-1'));

    expect(direct).toMatchObject({ ok: false, diagnostics: [{ code: 'data.denied' }] });
    expect(remote).toMatchObject({ ok: false, diagnostics: [{ code: 'data.denied' }] });
  });

  it('rejects stale source and revoked-scope accepted plans before any rows are emitted', async () => {
    const local = makeLocal();
    const planned = await local.plan(requestFor(activeCustomerOrders, 'commerce-stale-1'));
    if (!planned.ok) throw new Error(planned.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    const replaced = local.replaceSnapshot(snapshot('commerce-source-2'));
    expect(replaced.ok).toBe(true);
    const stale = await collect(local.execute(planned.value));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ kind: 'error', error: { code: 'data.stale-plan' } });

    let scope = 'scope-acme';
    const revoked = createLocalDataService({
      snapshot: snapshot(),
      functionRegistry: registry,
      authorize: () => ({ ok: true, value: grant(undefined, scope) }),
    });
    const accepted = await revoked.plan(requestFor(activeCustomerOrders, 'commerce-revoked-1'));
    if (!accepted.ok) throw new Error(accepted.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    scope = 'scope-revoked';
    const denied = await collect(revoked.execute(accepted.value));
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ kind: 'error', error: { code: 'data.denied' } });
  });
});
