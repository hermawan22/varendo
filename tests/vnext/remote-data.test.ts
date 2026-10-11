import type { QuerySpec } from '@varendo/core';
import type { DataRecord } from '@varendo/runtime/data';
import { createResultStore } from '@varendo/runtime/results';
import { expect, it, vi } from 'vitest';
import { createRemotePeopleFixture } from './fixtures/remote.js';
import { createPeopleFixture } from './fixtures/people.js';

const budget = {
  maxRows: 10_000,
  maxBytes: 8_000_000,
  maxMessages: 64,
  maxMilliseconds: 30_000,
  maxColumns: 128,
} as const;

function remoteQuery(patch: Partial<QuerySpec> = {}): QuerySpec {
  return {
    entity: 'people',
    fields: ['id'],
    measures: [],
    relations: [],
    groupBy: [],
    population: { kind: 'all-authorized' },
    order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
    page: { size: 25 },
    ...patch,
  };
}

function rowId(row: DataRecord | undefined): string {
  if (typeof row?.id !== 'string') throw new Error('Expected the remote projection to include a string id.');
  return row.id;
}

async function* from(events: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of events) yield event;
}

it('does not treat a remote page as the full population', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 1_000_000, pageSize: 25, aggregate: false });
  const result = await f.surface.request(f.globalCountIntent);
  expect(result.status).toBe('unsupported');
  expect(f.server.observedRequests.some((request) => request.kind === 'execute')).toBe(false);
  expect(f.server.observedRequests.some((r) => r.kind === 'fetch-all')).toBe(false);
  await f.dispose();
});

it('keeps remote pages bounded, ordered, partial, and cursor-repeatable', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 1_000_000, pageSize: 25, aggregate: false });
  const described = await f.client.describe({
    version: '1',
    requestId: 'remote-capabilities',
    catalogRevision: null,
    target: { kind: 'entity', entity: 'people' },
    budget,
    pageSize: 25,
  });
  expect(described.ok).toBe(true);
  if (described.ok) {
    expect(described.value.catalog.capabilities[0]?.pagination).toMatchObject({ mode: 'snapshot', identity: ['id'] });
    expect(described.value.catalog.capabilities[0]?.metrics).toEqual([]);
  }
  const first = await f.requestPage();
  expect(f.server.observedRequests.filter((request) => request.kind === 'plan').at(-1)?.query).toMatchObject({
    entity: 'people',
    fields: ['id', 'name', 'team'],
    measures: [],
    page: { size: 25 },
    order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
  });
  expect(first.rows).toHaveLength(25);
  expect(first.loaded).toBe(25);
  expect(rowId(first.rows[0])).toBe('tenant-a-person-0000001');
  expect(rowId(first.rows.at(-1))).toBe('tenant-a-person-0000025');
  expect(first.population?.kind).toBe('unknown');
  expect(first.coverage?.kind).toBe('partial');
  const cursor = first.cursor;
  expect(cursor).toBeDefined();
  if (cursor === undefined) throw new Error('The first page must provide a continuation cursor.');

  const second = await f.requestPage({ cursor });
  expect(second.rows).toHaveLength(25);
  expect(second.loaded).toBe(25);
  expect(rowId(second.rows[0])).toBe('tenant-a-person-0000026');
  expect(second.rows.every((row) => !first.rows.some((firstRow) => rowId(firstRow) === rowId(row)))).toBe(true);

  const repeat = await f.requestPage({ cursor });
  expect(repeat.rows).toEqual(second.rows);
  await expect(f.requestPage({ cursor, fields: ['id', 'name'] })).rejects.toThrow('cursor does not belong');
  await expect(f.requestPage({ cursor, order: [{ field: 'id', direction: 'desc', nulls: 'last' }] })).rejects.toThrow(
    'ordering is not a declared stable order',
  );
  await expect(f.requestPage({ cursor, target: { taskId: 'different-task', outputId: 'primary' } })).rejects.toThrow(
    'cursor does not belong',
  );
  const tampered = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  tampered.sourceRevision = 'remote-people-source-2';
  await expect(f.requestPage({ cursor: Buffer.from(JSON.stringify(tampered)).toString('base64url') })).rejects.toThrow(
    /malformed|does not belong/,
  );
  const forgedOffset = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  forgedOffset.offset = 75;
  await expect(
    f.requestPage({ cursor: Buffer.from(JSON.stringify(forgedOffset)).toString('base64url') }),
  ).rejects.toThrow('malformed or uses an unsupported version');
  const forgedOrder = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  forgedOrder.orderDigest = 'remote-forged-order';
  await expect(
    f.requestPage({ cursor: Buffer.from(JSON.stringify(forgedOrder)).toString('base64url') }),
  ).rejects.toThrow(/malformed|does not belong/);
  await f.dispose();
});

it('applies supported predicates and projections on the remote server', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: false });
  const page = await f.requestPage({
    fields: ['id'],
    where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  });
  expect(page.rows).toHaveLength(4);
  expect(page.rows.every((row) => rowId(row).startsWith('tenant-a-person-'))).toBe(true);
  expect(page.rows.every((row) => Number(rowId(row).slice(-7)) % 2 === 0)).toBe(true);
  expect(
    page.rows.every((row) => {
      const keys = Object.keys(row);
      return keys.length === 1 && keys[0] === 'id';
    }),
  ).toBe(true);
  await f.dispose();
});

it('applies supported predicates before proving a remote aggregate', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: true });
  const planned = await f.client.plan({
    version: '1',
    requestId: 'remote-filtered-aggregate',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-filtered-aggregate', outputId: 'primary' },
    query: remoteQuery({
      fields: [],
      page: { size: 4 },
      where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
      measures: [{ id: 'people.global-count', revision: '1' }],
    }),
    budget,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) return;
  const events = [];
  for await (const event of f.client.execute(planned.value)) events.push(event);
  const batch = events.find((event) => event.kind === 'batch');
  expect(batch?.kind === 'batch' && batch.rows).toEqual([{ 'people.global-count': 10 }]);
  const descriptor = events.find((event) => event.kind === 'descriptor');
  expect(descriptor?.kind === 'descriptor' && descriptor.descriptor.counts.population).toMatchObject({ value: 10 });
  await f.dispose();
});

it('publishes a filtered-to-zero remote aggregate through ResultStore validation', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: true });
  const planned = await f.client.plan({
    version: '1',
    requestId: 'remote-empty-aggregate',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-empty-aggregate', outputId: 'primary' },
    query: remoteQuery({
      fields: [],
      page: { size: 4 },
      where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Legal' },
      measures: [{ id: 'people.global-count', revision: '1' }],
    }),
    budget,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) return;
  const events = [];
  for await (const event of f.client.execute(planned.value)) events.push(event);
  const handle = createResultStore().begin({
    principalKey: 'tenant-a',
    scopeDigest: planned.value.scopeDigest,
    ...(planned.value.policyRevision === undefined ? {} : { policyRevision: planned.value.policyRevision }),
    populationDigest: planned.value.populationDigest,
    queryDigest: planned.value.queryDigest,
    catalogRevision: planned.value.catalogRevision,
    functionRegistryDigest: planned.value.functionRegistryDigest,
    sourceRevision: planned.value.sourceRevision,
    sourceLineage: planned.value.sourceLineage,
    planDigest: planned.value.planDigest,
    resultShape: planned.value.resultShape,
    lineageDigest: planned.value.lineageDigest,
    outputId: planned.value.target.outputId,
    taskId: planned.value.target.taskId,
    requestId: planned.value.requestId,
  });
  for await (const _update of handle.subscribe(from(events))) {
    // Consume the fixture's server events through the runtime validation boundary.
  }
  expect(handle.snapshot().status).toBe('ready');
  expect(handle.snapshot().descriptor?.counts.population).toMatchObject({ kind: 'exact', value: 0 });
  await f.dispose();
});

it('derives distinct remote population digests for distinct predicate populations', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: false });
  const request = {
    version: '1' as const,
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-population-digest', outputId: 'primary' },
    budget,
  };
  const design = await f.client.plan({
    ...request,
    requestId: 'remote-population-design',
    query: remoteQuery({
      page: { size: 4 },
      where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Design' },
    }),
  });
  const engineering = await f.client.plan({
    ...request,
    requestId: 'remote-population-engineering',
    query: remoteQuery({
      page: { size: 4 },
      where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
    }),
  });
  expect(design.ok).toBe(true);
  expect(engineering.ok).toBe(true);
  if (design.ok && engineering.ok) expect(design.value.populationDigest).not.toBe(engineering.value.populationDigest);
  await f.dispose();
});

it('rejects forged remote plan acceptance fields and expired acceptance', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: false });
  const planned = await f.client.plan({
    version: '1',
    requestId: 'remote-plan-envelope',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-plan-envelope', outputId: 'primary' },
    query: remoteQuery({ page: { size: 4 } }),
    budget,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) return;
  const variants = [
    { queryDigest: 'remote-forged-query' },
    { populationDigest: 'remote-forged-population' },
    { functionRegistryDigest: 'remote-forged-functions' },
    { effectiveBudget: { ...planned.value.effectiveBudget, maxRows: 1 } },
    { expiresAt: 1 },
  ] as const;
  for (const variant of variants) {
    const events = [];
    for await (const event of f.client.execute({ ...planned.value, ...variant })) events.push(event);
    expect(events[0]).toMatchObject({ kind: 'error', error: { code: 'data.denied' } });
  }
  await f.dispose();

  const expiring = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: false, cursorTtlMs: 1 });
  const expiringPlan = await expiring.client.plan({
    version: '1',
    requestId: 'remote-plan-expiry',
    catalogRevision: expiring.feature.catalog.revision,
    target: { taskId: 'remote-plan-expiry', outputId: 'primary' },
    query: remoteQuery({ page: { size: 4 } }),
    budget,
  });
  expect(expiringPlan.ok).toBe(true);
  if (expiringPlan.ok) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const events = [];
    for await (const event of expiring.client.execute(expiringPlan.value)) events.push(event);
    expect(events[0]).toMatchObject({ kind: 'error', error: { code: 'data.expired-plan' } });
  }
  await expiring.dispose();
});

it('retains overlapping equivalent remote plan handles', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 4, aggregate: false });
  const request = {
    version: '1' as const,
    requestId: 'remote-equivalent-a',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-equivalent', outputId: 'primary' },
    query: remoteQuery({ page: { size: 4 } }),
    budget,
  };
  const planA = await f.client.plan(request);
  const planB = await f.client.plan({ ...request, requestId: 'remote-equivalent-b' });
  expect(planA.ok).toBe(true);
  expect(planB.ok).toBe(true);
  if (!planA.ok || !planB.ok) return;
  expect(planA.value.planDigest).not.toBe(planB.value.planDigest);
  const eventsA = [];
  for await (const event of f.client.execute(planA.value)) eventsA.push(event);
  const eventsB = [];
  for await (const event of f.client.execute(planB.value)) eventsB.push(event);
  expect(eventsA[0]).toMatchObject({ kind: 'descriptor' });
  expect(eventsB[0]).toMatchObject({ kind: 'descriptor' });
  await f.dispose();
});

it('preserves estimated population metadata without upgrading partial coverage', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 1_000,
    pageSize: 25,
    aggregate: false,
    estimatedPopulation: true,
  });
  const page = await f.requestPage();
  expect(page.rows).toHaveLength(25);
  expect(page.coverage).toMatchObject({ kind: 'partial' });
  expect(page.population).toMatchObject({
    kind: 'estimated',
    value: 1_000,
    method: 'synthetic bounded estimate',
    uncertainty: { kind: 'quantified', lower: 990, upper: 1_010 },
  });
  await f.dispose();
});

it('binds opaque cursor proofs to the authenticated principal even when labels collide', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    sameAuthorityLabels: true,
  });
  const tenantA = await f.requestPage({ principal: 'tenant-a' });
  const tenantB = await f.requestPage({ principal: 'tenant-b' });
  expect(tenantA.cursor).toBeDefined();
  expect(rowId(tenantB.rows[0])).toMatch(/^tenant-b-/u);
  if (tenantA.cursor === undefined) throw new Error('Tenant A must receive a continuation cursor.');
  const payload = JSON.parse(Buffer.from(tenantA.cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  expect(payload).not.toHaveProperty('principal');
  expect(payload).not.toHaveProperty('tenant');
  expect(payload).not.toHaveProperty('partition');
  await expect(f.requestPage({ principal: 'tenant-b', cursor: tenantA.cursor })).rejects.toThrow(
    /malformed|does not belong/,
  );
  await f.dispose();
});

it('rejects cursor reuse across source, schema, meaning, policy, catalog, and expiry revisions', async () => {
  const base = await createRemotePeopleFixture({ logicalRows: 100, pageSize: 10, aggregate: false });
  const first = await base.requestPage();
  if (first.cursor === undefined) throw new Error('The base page must receive a continuation cursor.');
  const variants = [
    { sourceRevision: 'remote-people-source-2' },
    { schemaRevision: '2' },
    { policyRevision: 'remote-policy-2' },
  ] as const;
  try {
    for (const variant of variants) {
      const candidate = await createRemotePeopleFixture({
        logicalRows: 100,
        pageSize: 10,
        aggregate: false,
        ...variant,
      });
      try {
        await expect(candidate.requestPage({ cursor: first.cursor })).rejects.toThrow(/cursor|stale/i);
      } finally {
        await candidate.dispose();
      }
    }
  } finally {
    await base.dispose();
  }

  const aggregate = await createRemotePeopleFixture({ logicalRows: 100, pageSize: 10, aggregate: true });
  const aggregatePage = await aggregate.requestPage();
  if (aggregatePage.cursor === undefined) throw new Error('The aggregate fixture page must receive a cursor.');
  const changedMeaning = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: true,
    meaningRevision: '2',
  });
  try {
    await expect(changedMeaning.requestPage({ cursor: aggregatePage.cursor })).rejects.toThrow(/cursor|stale/i);
  } finally {
    await changedMeaning.dispose();
    await aggregate.dispose();
  }

  const expiring = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    cursorTtlMs: 250,
  });
  const expiringPage = await expiring.requestPage();
  if (expiringPage.cursor === undefined) throw new Error('The expiring page must receive a cursor.');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await expect(expiring.requestPage({ cursor: expiringPage.cursor })).rejects.toThrow(/cursor|stale/i);
  await expiring.dispose();
});

it('declares snapshot pagination and rejects a live keyset cursor explicitly', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 100, pageSize: 10, aggregate: false });
  const described = await f.client.describe({
    version: '1',
    requestId: 'snapshot-capability',
    catalogRevision: null,
    target: { kind: 'entity', entity: 'people' },
    budget,
    pageSize: 10,
  });
  expect(described.ok).toBe(true);
  if (described.ok)
    expect(described.value.catalog.capabilities[0]?.pagination).toMatchObject({ mode: 'snapshot', identity: ['id'] });
  const page = await f.requestPage();
  if (page.cursor === undefined) throw new Error('The snapshot page must receive a cursor.');
  const keyset = JSON.parse(Buffer.from(page.cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  keyset.mode = 'keyset';
  await expect(f.requestPage({ cursor: Buffer.from(JSON.stringify(keyset)).toString('base64url') })).rejects.toThrow(
    'Live keyset pagination is not declared',
  );
  await f.dispose();
});

it('uses an authenticated live keyset anchor across a leading insertion', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    pagination: 'keyset',
    leadingInsertOnContinuation: true,
  });
  const described = await f.client.describe({
    version: '1',
    requestId: 'keyset-capability',
    catalogRevision: null,
    target: { kind: 'entity', entity: 'people' },
    budget,
    pageSize: 10,
  });
  expect(described.ok).toBe(true);
  if (described.ok)
    expect(described.value.catalog.capabilities[0]?.pagination).toMatchObject({ mode: 'keyset', identity: ['id'] });
  const first = await f.requestPage();
  if (first.cursor === undefined) throw new Error('The keyset page must receive a continuation cursor.');
  const cursor = JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  expect(cursor.mode).toBe('keyset');
  expect(cursor.anchor).toEqual(['tenant-a-person-0000010']);
  const second = await f.requestPage({ cursor: first.cursor });
  expect(rowId(second.rows[0])).toBe('tenant-a-person-0000011');
  expect(second.rows.every((row) => !first.rows.some((firstRow) => rowId(firstRow) === rowId(row)))).toBe(true);
  await f.dispose();
});

it('derives a live keyset anchor before projection removes the identity field', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 100, pageSize: 10, aggregate: false, pagination: 'keyset' });
  const first = await f.requestPage({ fields: ['name'] });
  if (first.cursor === undefined) throw new Error('The projected keyset page must receive a continuation cursor.');
  expect(first.identity).toEqual([]);
  expect(first.rowGrain).toEqual([]);
  const second = await f.requestPage({ fields: ['name'], cursor: first.cursor });
  expect(second.rows[0]).toEqual({ name: 'Person 11' });
  expect(second.identity).toEqual([]);
  expect(second.rowGrain).toEqual([]);
  await f.dispose();
});

it('rejects a snapshot cursor after a concurrent source mutation', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    leadingInsertOnContinuation: true,
  });
  const first = await f.requestPage();
  if (first.cursor === undefined) throw new Error('The snapshot page must receive a continuation cursor.');
  await expect(f.requestPage({ cursor: first.cursor })).rejects.toThrow(/cursor|stale/i);
  await f.dispose();
});

it('advances live keyset source revisions without invalidating the anchor', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    pagination: 'keyset',
    leadingInsertOnContinuation: true,
  });
  const first = await f.requestPage();
  if (first.cursor === undefined) throw new Error('The live keyset page must receive a continuation cursor.');
  const second = await f.requestPage({ cursor: first.cursor });
  expect(rowId(second.rows[0])).toBe('tenant-a-person-0000011');
  expect(first.sourceRevision).toBe('remote-people-source-1');
  expect(second.sourceRevision).toBe('remote-people-source-1-mutation-1');
  expect(second.sourceRevision).not.toBe(first.sourceRevision);
  expect(first.consistency?.kind).toBe('mixed');
  expect(second.consistency?.kind).toBe('mixed');
  await f.dispose();
});

it('binds live keyset cursors to their immutable source lineage while revisions advance', async () => {
  const sourceA = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    pagination: 'keyset',
    sourceRevision: 'remote-people-source',
    sourceLineage: 'remote-people-stream-a',
    leadingInsertOnContinuation: true,
  });
  const sourceB = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    pagination: 'keyset',
    sourceRevision: 'remote-people-source',
    sourceLineage: 'remote-people-stream-b',
  });
  try {
    const first = await sourceA.requestPage();
    if (first.cursor === undefined) throw new Error('The live keyset page must receive a continuation cursor.');
    const cursor = JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(cursor.sourceLineage).toBe('remote-people-stream-a');
    await expect(sourceB.requestPage({ cursor: first.cursor })).rejects.toThrow(/cursor|stale/i);
    const continued = await sourceA.requestPage({ cursor: first.cursor });
    expect(continued.sourceRevision).toBe('remote-people-source-mutation-1');
  } finally {
    await sourceA.dispose();
    await sourceB.dispose();
  }
});

it('rejects snapshot publication when the source changes during remote materialization', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    mutateDuringExecution: true,
  });
  await expect(f.requestPage()).rejects.toThrow(/stale|source/i);
  await f.dispose();
});

it('labels live keyset publication with the current in-flight source revision', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    pagination: 'keyset',
    mutateDuringExecution: true,
  });
  const page = await f.requestPage();
  expect(page.sourceRevision).toBe('remote-people-source-1-mutation-1');
  expect(page.consistency?.kind).toBe('mixed');
  expect(rowId(page.rows[0])).toBe('tenant-a-person-0000000');
  await f.dispose();
});

it('publishes a complete aggregate only when the remote server proves it', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 1_000_000, pageSize: 25, aggregate: true });
  const result = await f.surface.request(f.globalCountIntent);
  expect(result.status).toBe('committed');
  const aggregatePlan = f.server.observedRequests.filter((request) => request.kind === 'plan').at(-1);
  expect(aggregatePlan?.query).toMatchObject({
    entity: 'people',
    measures: [{ id: 'people.global-count', revision: '1' }],
  });
  expect(f.server.observedRequests.filter((request) => request.kind === 'execute').at(-1)?.query).toEqual(
    aggregatePlan?.query,
  );
  const state = f.surface.getSnapshot().state;
  expect(state.loaded).toBe(1);
  expect(state.count).toBe(1_000_000);
  expect(state.population).toMatchObject({ kind: 'exact', value: 1_000_000 });
  expect(state.coverage).toMatchObject({ kind: 'complete' });
  const page = await f.surface.request({ kind: 'browse', resource: 'people', page: { size: 25 } });
  expect(page.status).toBe('committed');
  expect(f.server.observedRequests.filter((request) => request.kind === 'plan').at(-1)?.query).toMatchObject({
    entity: 'people',
    measures: [],
    page: { size: 25 },
  });
  expect(f.surface.getSnapshot().state.population?.kind).toBe('unknown');
  expect(f.surface.getSnapshot().state.coverage?.kind).toBe('partial');
  await f.dispose();
});

it('returns structured capability gaps instead of emulating unsupported remote queries', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 10_000, pageSize: 25, aggregate: true });
  const cases: readonly [string, QuerySpec, string][] = [
    ['field', remoteQuery({ fields: ['not-a-field'] }), 'data.unsupported.field'],
    [
      'operator',
      remoteQuery({ where: { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' } }),
      'data.unsupported.operator',
    ],
    ['relation', remoteQuery({ relations: [{ id: 'other', revision: '1' }] }), 'data.unsupported.relation'],
    ['metric', remoteQuery({ measures: [{ id: 'people.other-metric', revision: '1' }] }), 'data.unsupported.metric'],
    [
      'aggregation',
      remoteQuery({ measures: [{ id: 'people.global-count', revision: '1' }], groupBy: ['team'] }),
      'data.unsupported.aggregation',
    ],
    [
      'grouped-aggregation',
      remoteQuery({ measures: [{ id: 'people.global-count', revision: '1' }], groupBy: ['id'] }),
      'data.unsupported.aggregation',
    ],
    [
      'ordering',
      remoteQuery({ order: [{ field: 'name', direction: 'asc', nulls: 'last' }] }),
      'data.unsupported.ordering',
    ],
    [
      'ordering-direction',
      remoteQuery({ order: [{ field: 'id', direction: 'desc', nulls: 'last' }] }),
      'data.unsupported.ordering',
    ],
    [
      'ordering-nulls',
      remoteQuery({ order: [{ field: 'id', direction: 'asc', nulls: 'first' }] }),
      'data.unsupported.ordering',
    ],
    ['pagination', remoteQuery({ page: { size: 26 } }), 'data.unsupported.pagination'],
  ];
  for (const [name, query, code] of cases) {
    const outcome = await f.client.plan({
      version: '1',
      requestId: `remote-unsupported-${name}`,
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'remote-unsupported', outputId: name },
      query,
      budget,
    });
    expect(outcome.ok, name).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostics[0]?.code).toBe(code);
    expect(f.server.observedRequests.filter((request) => request.kind === 'plan').at(-1)?.query, name).toEqual(query);
  }
  expect(f.server.observedRequests.some((request) => request.kind === 'execute')).toBe(false);
  expect(f.server.observedRequests.some((request) => request.kind === 'fetch-all')).toBe(false);
  await f.dispose();
});

it('fences a remote surface request while a source adapter ignores cancellation', async () => {
  let signalStarted!: () => void;
  let releaseExecution!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  const controller = new AbortController();
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    executionGate: { started: signalStarted, release, wasCancelled: () => controller.signal.aborted },
  });
  const before = f.surface.getSnapshot();
  const pending = f.surface.request(
    { kind: 'browse', resource: 'people', page: { size: 10 } },
    { signal: controller.signal },
  );
  try {
    await started;
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    releaseExecution();
    await vi.waitFor(() => expect(f.server.lateDescriptors).toHaveLength(1));
    expect(f.server.lateDescriptors[0]).toMatchObject({
      counts: { loaded: 10 },
      coverage: { kind: 'partial' },
    });
    await vi.waitFor(() => expect(f.server.cancelledRequests).toHaveLength(1));
    expect(f.surface.getSnapshot().revision).toBe(before.revision);
    expect(f.surface.getSnapshot().state.rows).toEqual([]);
  } finally {
    releaseExecution();
    await f.dispose();
  }
});

it('keeps local and HTTP surfaces on the same committed ResultStore path', async () => {
  const local = createPeopleFixture();
  const localSurface = local.runtime.createSurface({
    scope: local.scope,
    id: 'people-parity',
    feature: local.feature,
    bindings: local.bindings,
  });
  const remote = await createRemotePeopleFixture({ logicalRows: 2, pageSize: 25, aggregate: false });
  const localResult = await localSurface.request({ kind: 'browse', resource: 'people' });
  const remoteResult = await remote.surface.request({ kind: 'browse', resource: 'people', page: { size: 25 } });
  expect(localResult.status).toBe('committed');
  expect(remoteResult.status).toBe('committed');
  const localState = localSurface.getSnapshot().state;
  const remoteState = remote.surface.getSnapshot().state;
  expect(localState.rows).toHaveLength(2);
  expect(remoteState.loaded).toBe(2);
  expect(remoteState.population).toMatchObject({ kind: 'unknown' });
  expect(remoteState.coverage).toMatchObject({ kind: 'partial' });
  local.dispose();
  await remote.dispose();
});

it('revokes remote surface state and requires a fresh authorized generation', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 10, aggregate: false });
  expect((await f.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } })).status).toBe(
    'committed',
  );
  const before = f.surface.getSnapshot();
  f.scope.setFeaturePermission('people', false);
  expect(f.surface.getSnapshot().phase).toBe('denied');
  expect(f.surface.getSnapshot().state.rows).toEqual([]);
  f.scope.setFeaturePermission('people', true);
  const renewed = await f.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } });
  expect(renewed.status).toBe('committed');
  expect(f.surface.getSnapshot().revision).not.toBe(before.revision);
  await f.dispose();
});

it('creates fresh A-B-A surface scopes and fences the old handle', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 20, pageSize: 10, aggregate: false });
  const factory = (f as unknown as { readonly createPrincipalSurface?: unknown }).createPrincipalSurface;
  expect(factory).toBeTypeOf('function');
  if (typeof factory !== 'function') {
    await f.dispose();
    return;
  }
  type PrincipalSurface = {
    readonly runtime: typeof f.runtime;
    readonly scope: typeof f.scope;
    readonly surface: typeof f.surface;
    readonly dispose: () => void;
  };
  const first = (
    f as unknown as {
      createPrincipalSurface: (principal: 'tenant-a' | 'tenant-b') => PrincipalSurface;
    }
  ).createPrincipalSurface;
  const firstA = first('tenant-a');
  const b = first('tenant-b');
  const secondA = first('tenant-a');
  const firstResult = await firstA.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } });
  firstA.scope.dispose();
  const stale = await firstA.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } });
  const bResult = await b.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } });
  const secondResult = await secondA.surface.request({ kind: 'browse', resource: 'people', page: { size: 10 } });
  expect(firstResult.status).toBe('committed');
  expect(stale.status).toBe('stale');
  expect(bResult.status).toBe('committed');
  expect(secondResult.status).toBe('committed');
  expect(firstA.surface.address.scopeInstanceId).not.toBe(secondA.surface.address.scopeInstanceId);
  expect(firstA.surface.address.runtimeId).not.toBe(secondA.surface.address.runtimeId);
  expect(firstA.surface.address).not.toEqual(secondA.surface.address);
  expect(secondA.surface.getSnapshot().state.rows[0]?.id).toMatch(/^tenant-a-/u);
  const begins = f.resultStoreBegins;
  expect(begins.slice(-3).map((entry) => entry.principalKey)).toEqual(['tenant-a', 'tenant-b', 'tenant-a']);
  expect(begins.slice(-3).map((entry) => entry.generation)).toEqual(
    begins
      .slice(-3)
      .map((entry) => entry.generation)
      .sort((left, right) => left - right),
  );
  expect(begins.at(-1)?.generation).not.toBe(begins.at(-3)?.generation);
  expect(
    f.server.observedRequests.filter((request) => request.kind === 'plan').map((request) => request.principal),
  ).toEqual(['tenant-a', 'tenant-b', 'tenant-a']);
  const authorityReads = (f as unknown as { readonly authorityReads: readonly string[] }).authorityReads;
  const firstBRead = authorityReads.indexOf('tenant-b');
  const lastBRead = authorityReads.lastIndexOf('tenant-b');
  expect(firstBRead).toBeGreaterThan(0);
  expect(lastBRead).toBeGreaterThanOrEqual(firstBRead);
  expect(authorityReads.slice(0, firstBRead).every((principal) => principal === 'tenant-a')).toBe(true);
  expect(authorityReads.slice(lastBRead + 1).every((principal) => principal === 'tenant-a')).toBe(true);
  const beforeChurn = f.resultStoreBegins.length;
  const beforeRequests = f.server.observedRequests.length;
  for (let render = 0; render < 256; render += 1) {
    const unsubscribe = secondA.surface.subscribe(() => undefined);
    expect(secondA.surface.getSnapshot().address).toEqual(secondA.surface.address);
    unsubscribe();
  }
  expect(f.resultStoreBegins).toHaveLength(beforeChurn);
  expect(f.server.observedRequests).toHaveLength(beforeRequests);
  firstA.dispose();
  b.dispose();
  secondA.dispose();
  await f.dispose();
});
