import { expect, it } from 'vitest';
import { z } from 'zod';
import { defineDataFeature, inferLocalDataShape } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import type { MeaningDefinition } from '@varendo/core';
import { createVarendoRuntime, createLocalDataBinding } from '@varendo/runtime';
import type { DataRecord, LocalDataService, LocalSnapshot } from '@varendo/runtime/data';
import { DEFAULT_BUDGET, createLocalDataService } from '@varendo/runtime/data';
import { createPeopleFixture } from './fixtures/people.js';
import { createScopeFixture } from './fixtures/scope.js';

it('updates source data without replacing the controller', async () => {
  const f = createPeopleFixture();
  expect(Object.isFrozen(f.bindings)).toBe(true);
  expect(f.bindings.service).toBe(f.bindings.source.service);
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'people',
    feature: f.feature,
    bindings: f.bindings,
  });
  const controller = surface;
  const addressBefore = surface.address;
  const initialRequest = await surface.request({ kind: 'browse' });
  expect(initialRequest).toMatchObject({ status: 'committed', revision: '1' });
  expect(f.runtime.snapshot('surface-1')?.phase).toBe('committed');
  const before = await f.observeRows(surface);
  expect(f.observeEvidence().sourceRevision).toBe('people-source-1');
  const resultRevisionBefore = f.observeEvidence().resultRevision;

  expect(f.source.replaceSnapshot(f.updatedSnapshot).ok).toBe(true);
  expect(await f.observeRows(surface)).toEqual(before);
  expect(f.observeEvidence().sourceRevision).toBe('people-source-1');
  expect((await surface.request({ kind: 'browse' })).status).toBe('committed');

  const after = await f.observeRows(surface);
  expect(f.observeEvidence().sourceRevision).toBe('people-source-2');
  expect(f.observeEvidence().resultRevision).not.toBe(resultRevisionBefore);
  expect(before.find((row) => row.id === 'sam')?.team).toBe('Engineering');
  expect(after.find((row) => row.id === 'sam')?.team).toBe('Design');
  expect(surface.address).toEqual(addressBefore);
  expect(surface).toBe(controller);
  expect(surface.address.activationEpoch).toBe(f.scope.getSnapshot().activationEpoch);
  expect(after).not.toEqual(before);
  f.dispose();
});

it('treats an equivalent same-revision snapshot as a no-op and retains accepted plans', async () => {
  const f = createPeopleFixture();
  const planned = await f.source.plan(
    {
      version: '1',
      requestId: 'same-revision-plan',
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'same-revision-task', outputId: 'rows' },
      query: {
        entity: 'people',
        fields: ['id', 'name', 'team'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
      },
      budget: DEFAULT_BUDGET,
    },
    { principal: 'local-user' },
  );
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].message);
  expect(f.source.replaceSnapshot(f.initialSnapshot)).toMatchObject({ ok: true });
  const events = [];
  for await (const event of f.source.execute(planned.value, { principal: 'local-user' })) events.push(event);
  expect(events[0]).toMatchObject({
    kind: 'descriptor',
    descriptor: { consistency: { snapshotId: 'people-source-1' } },
  });
  f.dispose();
});

it('retains registered meanings across an equivalent same-revision replacement', () => {
  const f = createPeopleFixture();
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const meaning: MeaningDefinition = {
    id: 'people.constant',
    revision: '1',
    label: 'People constant',
    explanation: 'A reviewed local test meaning.',
    output: { value: 'integer', nullable: false },
    implementation: {
      kind: 'expression',
      expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
    },
    dependencies: [],
    functionRegistryDigest: functions.value.digest,
    origin: 'manual',
    lifecycle: 'active',
    scope: 'workspace',
    authority: 'reviewed',
    aggregation: 'none',
    aggregationDimensions: [],
    missingPolicy: 'propagate',
  };
  const service = createLocalDataService({
    snapshot: f.initialSnapshot,
    functionRegistry: functions.value,
    meaningActivation: {
      registry: functions.value,
      policy: {
        policyRevision: 'local-policy',
        allowlistedDefinitions: [meaning],
        allowlistedRefs: [{ id: meaning.id, revision: meaning.revision }],
        minAuthority: 'reviewed',
      },
    },
  });
  const bundle = {
    catalogRevision: f.initialSnapshot.catalog.revision,
    functionRegistryDigest: functions.value.digest,
    meanings: [meaning],
  };
  expect(service.registerMeaningBundle(bundle)).toMatchObject({ ok: true, value: { idempotent: false } });
  expect(service.catalog.meanings).toHaveLength(1);
  expect(service.replaceSnapshot(f.initialSnapshot)).toMatchObject({ ok: true });
  expect(service.catalog.meanings).toHaveLength(1);
  expect(service.registerMeaningBundle(bundle)).toMatchObject({ ok: true, value: { idempotent: true } });
  f.dispose();
});

it('fences an executing result stream when the source revision changes', async () => {
  const f = createPeopleFixture();
  const planned = await f.source.plan(
    {
      version: '1',
      requestId: 'stream-race-plan',
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'stream-race-task', outputId: 'rows' },
      query: {
        entity: 'people',
        fields: ['id', 'name', 'team'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
      },
      budget: DEFAULT_BUDGET,
    },
    { principal: 'local-user' },
  );
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].message);
  const iterator = f.source.execute(planned.value, { principal: 'local-user' })[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.value).toMatchObject({
    kind: 'descriptor',
    descriptor: { consistency: { snapshotId: 'people-source-1' } },
  });
  expect(f.source.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  const stale = await iterator.next();
  expect(stale.value).toMatchObject({ kind: 'error', error: { code: 'data.stale-plan' } });
  expect(await iterator.next()).toMatchObject({ done: true });
  f.dispose();
});

it('rejects a same-revision catalog change as an atomic source conflict', () => {
  const f = createPeopleFixture();
  const changedCatalog = {
    ...f.initialSnapshot.catalog,
    entities: f.initialSnapshot.catalog.entities.map((entity) =>
      entity.id === 'people' ? { ...entity, label: 'Changed People' } : entity,
    ),
  };
  expect(f.source.replaceSnapshot({ ...f.initialSnapshot, catalog: changedCatalog })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-revision-conflict' }],
  });
  expect(f.source.catalog.entities.find((entity) => entity.id === 'people')?.label).toBe('people');
  f.dispose();
});

it('revalidates the mounted feature schema on every source replacement', async () => {
  const feature = defineDataFeature({
    id: 'nullable-people',
    schema: z.object({ id: z.string(), note: z.string().nullable() }),
    identity: ['id'],
  });
  const snapshot: LocalSnapshot = {
    catalog: feature.catalog,
    sourceRevision: 'nullable-source-1',
    records: { 'nullable-people': [{ id: '1', note: null }] },
  };
  const functionRegistry = createQueryFunctionRegistry({ version: '2' });
  if (!functionRegistry.ok) throw new Error(functionRegistry.diagnostics[0].message);
  const binding = createLocalDataBinding({
    feature,
    snapshot,
    initialState: { rows: [] as readonly { id: string; note: string | null }[] },
    coverage: {
      fields: ['id', 'note'],
      operators: ['eq'],
      pagination: 'snapshot',
      stableOrder: ['id'],
      sorting: 'stable-fields-only',
      aggregation: 'unsupported',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['aggregation', 'streaming', 'live-updates'],
    },
    normalize: async (events) => {
      const rows: { id: string; note: string | null }[] = [];
      for await (const event of events) {
        if (event.kind === 'batch') rows.push(...(event.rows as { id: string; note: string | null }[]));
      }
      return { rows: Object.freeze(rows) };
    },
    serviceOptions: {
      functionRegistry: functionRegistry.value,
      authorize: ({ context }) =>
        context.principal === 'local-user'
          ? { ok: true, value: { scopeDigest: 'nullable-scope', policyRevision: 'nullable-policy' } }
          : { ok: false, diagnostics: [{ code: 'data.denied', message: 'Denied.', retryable: false }] },
    },
  });
  const runtime = createVarendoRuntime({
    runtimeId: 'nullable-runtime',
    resources: [{ resource: feature.resource, data: binding.service }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'local-user',
          scopeDigest: 'nullable-scope',
          policyRevision: 'nullable-policy',
          experienceRevision: 'nullable-experience',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: 'local-user' },
        },
      }),
    },
  });
  const scope = runtime.createLocalSurfaceScope({ id: 'nullable-scope', allowedFeatures: [feature.id] });
  const surface = runtime.createSurface({
    scope,
    id: 'nullable-surface',
    feature,
    bindings: binding,
  });
  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  const before = surface.getSnapshot();
  const rejected = binding.service.replaceSnapshot({
    catalog: feature.catalog,
    sourceRevision: 'nullable-source-2',
    records: { 'nullable-people': [{ id: '1' }] },
  });
  expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-inconsistent' }] });
  expect(binding.service.sourceRevision).toBe('nullable-source-1');
  expect(surface.getSnapshot()).toBe(before);
  const executable = binding.service.replaceSnapshot({
    catalog: feature.catalog,
    sourceRevision: 'nullable-source-3',
    records: { 'nullable-people': [{ id: '1', note: null, toJSON: () => ({}) }] },
  } as never);
  expect(executable).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-executable' }] });
  expect(binding.service.sourceRevision).toBe('nullable-source-1');
  expect(surface.getSnapshot()).toBe(before);
  runtime.dispose();
  scope.dispose();
});

it('rejects historical source revision replay and bounds revision lifetime', async () => {
  const f = createPeopleFixture();
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const service = createLocalDataService({
    snapshot: f.initialSnapshot,
    functionRegistry: functions.value,
    maxSourceRevisions: 2,
  });
  expect(service.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  expect(
    service.replaceSnapshot({
      ...f.initialSnapshot,
      records: { people: f.updatedSnapshot.records.people ?? [] },
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.source-revision-conflict' }] });
  expect(service.replaceSnapshot(f.initialSnapshot)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-revision-conflict' }],
  });
  expect(service.sourceRevision).toBe('people-source-2');
  expect(service.replaceSnapshot({ ...f.updatedSnapshot, sourceRevision: 'people-source-3' })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-revision-capacity' }],
  });
  expect(service.sourceRevision).toBe('people-source-2');
  expect(service.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  expect(() => createLocalDataService({ snapshot: f.initialSnapshot, maxSourceRevisions: 0 })).toThrow(
    /maxSourceRevisions/u,
  );

  const capacityProbe = createLocalDataService({ snapshot: f.initialSnapshot, maxSourceRevisions: 2 });
  const malformed: LocalSnapshot = {
    ...f.initialSnapshot,
    sourceRevision: 'people-source-invalid',
    records: { people: [{ id: 'bad', name: 'Bad', team: 'Design', nested: { invalid: true } }] },
  } as unknown as LocalSnapshot;
  expect(capacityProbe.replaceSnapshot(malformed)).toMatchObject({ ok: false });
  expect(capacityProbe.replaceSnapshot({ ...f.updatedSnapshot, sourceRevision: 'people-source-valid' })).toMatchObject({
    ok: true,
  });
  const catalogProbe = createLocalDataBinding({
    feature: f.feature,
    snapshot: f.initialSnapshot,
    initialState: f.bindings.initialState,
    coverage: f.bindings.source.coverage,
    normalize: f.bindings.source.normalize,
    serviceOptions: { maxSourceRevisions: 2 },
  }).service;
  const changedCatalog = { ...f.initialSnapshot.catalog, revision: 'people-catalog-probe' };
  expect(
    catalogProbe.replaceSnapshot({
      ...f.updatedSnapshot,
      sourceRevision: 'people-source-catalog',
      catalog: changedCatalog,
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-catalog-conflict' }],
  });
  expect(catalogProbe.replaceSnapshot({ ...f.updatedSnapshot, sourceRevision: 'people-source-valid' })).toMatchObject({
    ok: true,
  });

  const rollback = createLocalDataService({
    snapshot: f.initialSnapshot,
    functionRegistry: functions.value,
    maxSourceRevisions: 3,
  });
  expect(rollback.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  expect(rollback.replaceSnapshot({ ...f.initialSnapshot, sourceRevision: 'people-source-3' })).toMatchObject({
    ok: true,
  });
  expect(rollback.sourceRevision).toBe('people-source-3');
  const rollbackPlan = await rollback.plan({
    version: '1',
    requestId: 'rollback-plan',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'rollback-task', outputId: 'rows' },
    query: {
      entity: 'people',
      fields: ['id', 'name', 'team'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [],
    },
    budget: DEFAULT_BUDGET,
  });
  expect(rollbackPlan.ok).toBe(true);
  if (rollbackPlan.ok) {
    const rollbackEvents = [];
    for await (const event of rollback.execute(rollbackPlan.value)) rollbackEvents.push(event);
    expect(rollbackEvents[0]).toMatchObject({
      kind: 'descriptor',
      descriptor: { consistency: { snapshotId: 'people-source-3' } },
    });
    expect(rollbackEvents.find((event) => event.kind === 'batch')?.rows[0]?.name).toBe('Ada Chen');
  }
  f.dispose();
});

it('keeps the mounted feature catalog and validated snapshot authoritative', () => {
  const f = createPeopleFixture();
  let snapshotGets = 0;
  let recordsGets = 0;
  const rowArrayProxy = new Proxy(f.initialSnapshot.records.people ?? [], {
    get: (target, property, receiver) => {
      if (property === 'length') throw new Error('binding row-array length getter must not run');
      return Reflect.get(target, property, receiver);
    },
  });
  const recordsProxy = new Proxy(
    { people: rowArrayProxy },
    {
      get: () => {
        recordsGets += 1;
        throw new Error('binding records getter must not run');
      },
    },
  );
  const snapshotProxy = new Proxy(f.initialSnapshot, {
    get: () => {
      snapshotGets += 1;
      throw new Error('binding snapshot getter must not run');
    },
  });
  const safeSnapshotProxy = new Proxy(
    { catalog: f.initialSnapshot.catalog, sourceRevision: f.initialSnapshot.sourceRevision, records: recordsProxy },
    {
      get: () => {
        snapshotGets += 1;
        throw new Error('binding snapshot getter must not run');
      },
    },
  );
  const proxyBinding = createLocalDataBinding({
    feature: f.feature,
    snapshot: safeSnapshotProxy,
    initialState: f.bindings.initialState,
    coverage: f.bindings.source.coverage,
    normalize: f.bindings.source.normalize,
  });
  expect(proxyBinding.service.sourceRevision).toBe(f.initialSnapshot.sourceRevision);
  expect(snapshotGets).toBe(0);
  expect(recordsGets).toBe(0);
  expect(() =>
    createLocalDataBinding({
      feature: f.feature,
      snapshot: snapshotProxy,
      initialState: f.bindings.initialState,
      coverage: f.bindings.source.coverage,
      normalize: f.bindings.source.normalize,
    }),
  ).not.toThrow();
  expect(snapshotGets).toBe(0);
  expect(recordsGets).toBe(0);
  expect(() =>
    createLocalDataBinding({
      feature: f.feature,
      snapshot: { ...f.initialSnapshot, catalog: { ...f.initialSnapshot.catalog, revision: 'people-catalog-other' } },
      initialState: f.bindings.initialState,
      coverage: f.bindings.source.coverage,
      normalize: f.bindings.source.normalize,
    }),
  ).toThrow(/data\.feature-catalog/u);
  const divergentCatalog = { ...f.updatedSnapshot.catalog, revision: 'people-catalog-other' };
  expect(f.source.replaceSnapshot({ ...f.updatedSnapshot, catalog: divergentCatalog })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-catalog-conflict' }],
  });
  const injected = createLocalDataBinding({
    feature: f.feature,
    snapshot: f.initialSnapshot,
    initialState: f.bindings.initialState,
    coverage: f.bindings.source.coverage,
    normalize: f.bindings.source.normalize,
    serviceOptions: { snapshot: f.updatedSnapshot } as never,
  });
  expect(injected.service.sourceRevision).toBe(f.initialSnapshot.sourceRevision);
  f.dispose();
});

it('does not observe caller mutation until an explicit new source revision is accepted', async () => {
  const rows: DataRecord[] = [{ id: 'e-1', name: 'Before', team: 'Design' }];
  const f = createPeopleFixture();
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const service = createLocalDataService({
    snapshot: { ...f.initialSnapshot, records: { people: rows } },
    functionRegistry: functions.value,
  });
  rows[0] = { id: 'e-1', name: 'After', team: 'Engineering' };
  const planned = await service.plan({
    version: '1',
    requestId: 'mutation-plan',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'mutation-task', outputId: 'rows' },
    query: {
      entity: 'people',
      fields: ['id', 'name', 'team'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [],
    },
    budget: DEFAULT_BUDGET,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].message);
  const events = [];
  for await (const event of service.execute(planned.value)) events.push(event);
  expect(events.some((event) => event.kind === 'batch' && event.rows[0]?.name === 'Before')).toBe(true);
  expect(
    service.replaceSnapshot({ ...f.initialSnapshot, sourceRevision: 'people-source-new', records: { people: rows } }),
  ).toMatchObject({ ok: true });
  const replacementPlan = await service.plan({
    version: '1',
    requestId: 'mutation-plan-new',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'mutation-task-new', outputId: 'rows' },
    query: {
      entity: 'people',
      fields: ['id', 'name', 'team'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [],
    },
    budget: DEFAULT_BUDGET,
  });
  expect(replacementPlan.ok).toBe(true);
  if (!replacementPlan.ok) throw new Error(replacementPlan.diagnostics[0].message);
  const replacementEvents = [];
  for await (const event of service.execute(replacementPlan.value)) replacementEvents.push(event);
  expect(replacementEvents.some((event) => event.kind === 'batch' && event.rows[0]?.name === 'After')).toBe(true);
  f.dispose();
});

it('captures source descriptor values before validation and never executes row accessors', async () => {
  const f = createPeopleFixture();
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const throwingGet = new Proxy(
    { id: 'proxy', name: 'Proxy', team: 'Design' },
    {
      get: () => {
        throw new Error('row getter must not run');
      },
    },
  );
  const source = createLocalDataService({
    snapshot: { ...f.initialSnapshot, records: { people: [throwingGet] } },
  });
  expect(source.sourceRevision).toBe(f.initialSnapshot.sourceRevision);
  expect(() =>
    createLocalDataBinding({
      feature: f.feature,
      snapshot: {
        ...f.initialSnapshot,
        records: { people: [{ id: 'proxy', name: 'Proxy', team: 'Design', toJSON: () => ({}) }] },
      } as never,
      initialState: f.bindings.initialState,
      coverage: f.bindings.source.coverage,
      normalize: f.bindings.source.normalize,
      serviceOptions: { functionRegistry: functions.value },
    }),
  ).toThrow(/data\.shape-executable/u);
  const inheritedDecimal = Object.create({
    toJSON: () => {
      throw new Error('toJSON must not run');
    },
  });
  inheritedDecimal.decimal = '1.0';
  expect(() =>
    createLocalDataService({
      snapshot: {
        ...f.initialSnapshot,
        records: { people: [{ id: 'proxy', name: inheritedDecimal, team: 'Design' }] },
      } as never,
    }),
  ).toThrow(/invalid value/u);
  let snapshotGetCalls = 0;
  const topLevel = new Proxy(
    {
      catalog: f.initialSnapshot.catalog,
      sourceRevision: 'people-source-top-level',
      records: { people: [throwingGet] },
    },
    {
      get: () => {
        snapshotGetCalls += 1;
        throw new Error('snapshot getter must not run');
      },
    },
  );
  const arrayWithGetTrap = new Proxy([throwingGet], {
    get: (target, property, receiver) => {
      if (property === 'length') throw new Error('array length getter must not run');
      return Reflect.get(target, property, receiver);
    },
  });
  const captured = createLocalDataService({
    snapshot: {
      catalog: f.initialSnapshot.catalog,
      sourceRevision: 'people-source-array',
      records: { people: arrayWithGetTrap },
    } as never,
  });
  expect(captured.sourceRevision).toBe('people-source-array');
  const topCaptured = createLocalDataService({ snapshot: topLevel as never, functionRegistry: functions.value });
  expect(topCaptured.sourceRevision).toBe('people-source-top-level');
  expect(snapshotGetCalls).toBe(0);
  const planned = await topCaptured.plan({
    version: '1',
    requestId: 'proxy-replacement-plan',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'proxy-replacement-task', outputId: 'rows' },
    query: {
      entity: 'people',
      fields: ['id', 'name', 'team'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [],
    },
    budget: DEFAULT_BUDGET,
  });
  expect(planned.ok).toBe(true);
  const badReplacement = Object.defineProperty({ id: 'bad', name: 'Bad', team: 'Design' }, 'name', {
    enumerable: true,
    get: () => {
      throw new Error('replacement getter must not run');
    },
  });
  expect(
    topCaptured.replaceSnapshot({
      ...f.updatedSnapshot,
      sourceRevision: 'people-source-rejected',
      records: { people: [badReplacement] },
    } as never),
  ).toMatchObject({ ok: false });
  expect(topCaptured.sourceRevision).toBe('people-source-top-level');
  if (planned.ok) {
    const events = [];
    for await (const event of topCaptured.execute(planned.value)) events.push(event);
    expect(events.some((event) => event.kind === 'batch')).toBe(true);
  }
  f.dispose();
});

it('rejects changed records under the current source revision atomically', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({ scope: f.scope, id: 'conflict', feature: f.feature, bindings: f.bindings });
  await surface.request({ kind: 'browse' });
  const before = await f.observeRows(surface);
  const addressBefore = surface.address;
  const conflict: LocalSnapshot = { ...f.updatedSnapshot, sourceRevision: 'people-source-1' };

  expect(f.source.replaceSnapshot(conflict)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-revision-conflict' }],
  });
  expect(f.source.sourceRevision).toBe('people-source-1');
  expect(await f.observeRows(surface)).toEqual(before);
  expect(surface.address).toEqual(addressBefore);
  f.dispose();
});

it('reports bounded structural inference states without inventing fields or identities', () => {
  expect(inferLocalDataShape({ id: 'empty', rows: [] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-empty' }],
  });
  expect(
    inferLocalDataShape({
      id: 'people',
      rows: [{ id: 'ada', name: 'Ada' }],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({
    ok: true,
    value: { status: 'ready', identity: ['id'], fields: [{ id: 'id' }, { id: 'name' }] },
  });
});

it('keeps declared shape for an empty schema and marks all-null inference ambiguous', () => {
  const f = createPeopleFixture();
  expect(
    inferLocalDataShape({ id: 'people', rows: [], schema: f.feature.schema, identity: f.feature.identity }),
  ).toMatchObject({
    ok: true,
    value: {
      status: 'empty',
      identity: ['id'],
      fields: [
        { id: 'id', kind: 'text' },
        { id: 'name', kind: 'text' },
        { id: 'team', kind: 'text' },
      ],
    },
  });
  expect(
    inferLocalDataShape({
      id: 'unknown',
      rows: [{ id: '1', value: null }],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-ambiguous' }] });
  expect(
    inferLocalDataShape({ id: 'empty-callback', rows: [], schema: f.feature.schema, getRowId: (row) => row }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-ambiguous' }] });
  f.dispose();
});

it('reuses declared resource type semantics and rejects optional or unknown identity fields', () => {
  const schema = z.object({ id: z.string(), amount: z.number().nullable(), happenedAt: z.string().datetime() });
  expect(
    inferLocalDataShape({
      id: 'typed',
      rows: [{ id: 'one', amount: null, happenedAt: '2026-01-01T00:00:00.100Z' }],
      schema,
      identity: ['id'],
    }),
  ).toMatchObject({
    ok: true,
    value: {
      fields: [
        { id: 'amount', kind: 'float', nullable: true },
        { id: 'happenedAt', kind: 'instant', nullable: false },
        { id: 'id', kind: 'text', nullable: false },
      ],
    },
  });
  expect(
    inferLocalDataShape({
      id: 'optional',
      rows: [],
      schema: z.object({ id: z.string().optional() }),
      identity: ['id'],
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'resource.optional-field' }] });
  expect(
    inferLocalDataShape({
      id: 'unknown-identity',
      rows: [],
      schema: z.object({ id: z.string() }),
      identity: ['missing'],
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-field' }] });
});

it('rejects heterogeneous, nested, accessor and executable row shapes', () => {
  const getRowId = (row: unknown) => (row as { id: string }).id;
  expect(
    inferLocalDataShape({
      id: 'mixed',
      rows: [
        { id: '1', value: 1 },
        { id: '2', value: 'two' },
      ],
      getRowId,
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-inconsistent' }],
  });
  expect(inferLocalDataShape({ id: 'nested', rows: [{ id: '1', value: { nested: true } }], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-nested' }],
  });
  expect(inferLocalDataShape({ id: 'array', rows: [{ id: '1', value: [true] }], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-nested' }],
  });
  class UnsafeRow {
    readonly id = '1';
    readonly value = 'unsafe';
  }
  expect(inferLocalDataShape({ id: 'class', rows: [new UnsafeRow()], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-object' }],
  });
  const symbolRow = { id: '1' } as Record<string | symbol, unknown>;
  symbolRow[Symbol('unsafe')] = 'unsafe';
  expect(inferLocalDataShape({ id: 'symbol', rows: [symbolRow], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-executable' }],
  });
  const accessor = Object.defineProperty({ id: '1' }, 'value', { enumerable: true, get: () => 'unsafe' });
  expect(inferLocalDataShape({ id: 'accessor', rows: [accessor], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-accessor' }],
  });
  expect(inferLocalDataShape({ id: 'to-json', rows: [{ id: '1', toJSON: () => ({}) }], getRowId })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-executable' }],
  });
  const transformed = z.object({ id: z.string(), amount: z.coerce.number() });
  expect(
    inferLocalDataShape({ id: 'coerce', rows: [{ id: '1', amount: '12' }], schema: transformed, identity: ['id'] }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-inconsistent' }] });
});

it('rejects missing, duplicate and canonical-colliding identities without synthesizing IDs', () => {
  expect(
    inferLocalDataShape({ id: 'missing', rows: [{ label: 'one' }], getRowId: (row) => (row as { id?: string }).id }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-missing' }] });
  expect(
    inferLocalDataShape({
      id: 'duplicate',
      rows: [
        { id: 'same', label: 'one' },
        { id: 'same', label: 'two' },
      ],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-duplicate' }] });
  expect(
    inferLocalDataShape({
      id: 'decimal-duplicate',
      rows: [{ id: { decimal: '1.0' } }, { id: { decimal: '1.00' } }],
      getRowId: (row) => (row as { id: unknown }).id,
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-duplicate' }] });
  expect(
    inferLocalDataShape({
      id: 'instant-duplicate',
      rows: [
        { id: '2026-01-01T00:00:00.100Z', label: 'one' },
        { id: '2025-12-31T19:00:00.1000-05:00', label: 'two' },
      ],
      schema: z.object({ id: z.string().datetime({ offset: true }), label: z.string() }),
      identity: ['id'],
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-duplicate' }] });
  expect(
    inferLocalDataShape({
      id: 'text-instant-looking',
      rows: [{ id: '2026-01-01T00:00:00.100Z' }, { id: '2025-12-31T19:00:00.1000-05:00' }],
      identity: ['id'],
    }),
  ).toMatchObject({ ok: true, value: { identity: ['id'] } });
});

it('rejects callback identities that do not resolve to one real scalar field', () => {
  const rows = [{ id: 'one', label: 'One' }];
  expect(
    // @ts-expect-error identity fields and a callback are mutually exclusive.
    inferLocalDataShape({ id: 'both', rows, identity: ['id'], getRowId: (row) => (row as { id: string }).id }),
  ).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.identity-ambiguous' }],
  });
  for (const value of [{ synthetic: true }, ['one'], () => 'one', Symbol('one')]) {
    expect(inferLocalDataShape({ id: 'callback', rows, getRowId: () => value })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.identity-ambiguous' }],
    });
  }
  expect(
    inferLocalDataShape({
      id: 'callback-duplicate',
      rows: [
        { id: 'same', label: 'same' },
        { id: 'same', label: 'other' },
      ],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.identity-duplicate' }] });
  expect(
    inferLocalDataShape({
      id: 'mirrored-single',
      rows: [{ id: 'one', code: 'one' }],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({ ok: true, value: { identity: ['id'] } });
  expect(
    inferLocalDataShape({
      id: 'mirrored-rows',
      rows: [
        { id: 'one', code: 'one' },
        { id: 'two', code: 'two' },
      ],
      getRowId: (row) => (row as { id: string }).id,
    }),
  ).toMatchObject({ ok: true, value: { identity: ['id'] } });
});

it('reports bounded value and identifier diagnostics without throwing on non-JSON rows', () => {
  let lengthGets = 0;
  const rowsProxy = new Proxy([{ id: 'one' }], {
    get: (target, property, receiver) => {
      if (property === 'length') {
        lengthGets += 1;
        throw new Error('rows length getter must not run');
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expect(inferLocalDataShape({ id: 'rows-proxy', rows: rowsProxy, identity: ['id'] })).toMatchObject({ ok: true });
  expect(lengthGets).toBe(0);
  const sparse: unknown[] = [];
  sparse.length = 1;
  expect(inferLocalDataShape({ id: 'sparse', rows: sparse, identity: ['id'] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-object' }],
  });
  const accessorRows = Object.defineProperty([{ id: 'one' }], '0', { enumerable: true, get: () => ({ id: 'one' }) });
  expect(inferLocalDataShape({ id: 'accessor-rows', rows: accessorRows, identity: ['id'] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-accessor' }],
  });
  expect(
    inferLocalDataShape({ id: 'bigint', rows: [{ id: 'one', value: 1n as unknown as number }], identity: ['id'] }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-value' }] });
  const cyclic: Record<string, unknown> = { id: 'one' };
  cyclic.value = cyclic;
  expect(inferLocalDataShape({ id: 'cycle', rows: [cyclic], identity: ['id'] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-nested' }],
  });
  expect(inferLocalDataShape({ id: 'bad id', rows: [{ id: 'one' }] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-id' }],
  });
  expect(inferLocalDataShape({ id: '__proto__', rows: [{ id: 'one' }] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-id' }],
  });
  expect(
    inferLocalDataShape({ id: 'field-bound', rows: [{ id: 'one', label: 'One' }], limits: { fields: 1 } }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-capacity' }] });
  expect(
    inferLocalDataShape({ id: 'byte-bound', rows: [{ id: 'one', label: 'One' }], limits: { bytes: 8 } }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'data.shape-capacity' }] });
  expect(
    inferLocalDataShape({ id: 'row-bound', rows: new Array(3).fill({ id: 'one' }), limits: { rows: 2 } }),
  ).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-capacity' }],
  });
  class DecimalClass {
    readonly decimal = '1.0';
  }
  expect(
    inferLocalDataShape({ id: 'decimal-class', rows: [{ id: new DecimalClass() }], identity: ['id'] }),
  ).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-nested' }],
  });
  let toJsonCalls = 0;
  const inherited = Object.create({
    toJSON: () => {
      toJsonCalls += 1;
      return { decimal: '1' };
    },
  });
  inherited.decimal = '1';
  expect(inferLocalDataShape({ id: 'decimal-inherited', rows: [{ id: inherited }], identity: ['id'] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.shape-nested' }],
  });
  expect(toJsonCalls).toBe(0);
});

it('rejects initial and replacement snapshots over configured row and byte bounds', async () => {
  const f = createPeopleFixture();
  expect(() =>
    createLocalDataService({
      snapshot: f.updatedSnapshot,
      sourceLimits: { rows: 1, bytes: 100_000 },
    }),
  ).toThrow(/row limit/u);
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const service = createLocalDataService({
    snapshot: f.initialSnapshot,
    functionRegistry: functions.value,
    sourceLimits: { rows: 4, bytes: 100_000 },
  });
  const oversized: LocalSnapshot = {
    ...f.updatedSnapshot,
    sourceRevision: 'people-source-3',
    records: {
      people: [
        ...(f.updatedSnapshot.records.people ?? []),
        ...(f.updatedSnapshot.records.people ?? []),
        ...(f.updatedSnapshot.records.people ?? []),
      ],
    },
  };
  expect(service.replaceSnapshot(oversized)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-capacity' }],
  });
  expect(service.sourceRevision).toBe(f.initialSnapshot.sourceRevision);
  expect(() => createLocalDataService({ snapshot: f.initialSnapshot, sourceLimits: { rows: 4, bytes: 20 } })).toThrow(
    /byte limit/u,
  );
  const byteService = createLocalDataService({
    snapshot: f.initialSnapshot,
    functionRegistry: functions.value,
    sourceLimits: { rows: 4, bytes: 500 },
  });
  const byteOversized: LocalSnapshot = {
    ...f.updatedSnapshot,
    sourceRevision: 'people-source-byte-overflow',
    records: {
      people: [
        { id: 'ada', name: 'Ada Chen', team: 'Design' },
        { id: 'sam', name: 'x'.repeat(1_000), team: 'Design' },
      ],
    },
  };
  expect(byteService.replaceSnapshot(byteOversized)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-capacity' }],
  });
  const byteBinding = createLocalDataBinding({
    feature: f.feature,
    snapshot: f.initialSnapshot,
    initialState: f.bindings.initialState,
    coverage: f.bindings.source.coverage,
    normalize: f.bindings.source.normalize,
    serviceOptions: {
      functionRegistry: functions.value,
      sourceLimits: { rows: 4, bytes: 500 },
      authorize: () => ({
        ok: true,
        value: { scopeDigest: f.scope.getSnapshot().scopeInstanceId, policyRevision: 'local-policy-1' },
      }),
    },
  });
  const byteSurface = f.runtime.createSurface({
    scope: f.scope,
    id: 'byte-surface',
    feature: f.feature,
    bindings: byteBinding,
  });
  await byteSurface.request({ kind: 'browse' });
  const beforeRows = await f.observeRows(byteSurface);
  const beforeAddress = byteSurface.address;
  const beforeRevision = byteSurface.getSnapshot().revision;
  expect(byteBinding.service.replaceSnapshot(byteOversized)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-capacity' }],
  });
  expect(byteBinding.service.sourceRevision).toBe(f.initialSnapshot.sourceRevision);
  expect(await f.observeRows(byteSurface)).toEqual(beforeRows);
  expect(byteSurface.address).toEqual(beforeAddress);
  expect(byteSurface.getSnapshot().revision).toBe(beforeRevision);
  f.dispose();
});

it('rejects a bad binding shape before the service can emit a batch', () => {
  const f = createPeopleFixture();
  const bad = {
    ...f.initialSnapshot,
    sourceRevision: 'people-source-bad-shape',
    records: { people: [{ id: 'bad', name: 'Bad', team: 'Design', nested: { unsafe: true } }] },
  } as unknown as LocalSnapshot;
  expect(() =>
    createLocalDataBinding({
      feature: f.feature,
      snapshot: bad,
      initialState: f.bindings.initialState,
      coverage: f.bindings.source.coverage,
      normalize: f.bindings.source.normalize,
    }),
  ).toThrow(/data\.shape-inconsistent/u);
  f.dispose();
});

it('preserves the last committed result after a failed refresh', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({ scope: f.scope, id: 'preserve', feature: f.feature, bindings: f.bindings });
  await surface.request({ kind: 'browse' });
  const before = await f.observeRows(surface);
  const failed = f.source.replaceSnapshot({
    ...f.updatedSnapshot,
    sourceRevision: 'people-source-failed',
    records: {
      people: [...(f.updatedSnapshot.records.people ?? []), ...(f.updatedSnapshot.records.people ?? [])],
    },
  });
  expect(failed).toMatchObject({ ok: false, diagnostics: [{ code: 'data.source-shape' }] });
  expect(await f.observeRows(surface)).toEqual(before);
  f.dispose();
});

it('preserves the last committed surface result after refresh authorization fails', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'denied-refresh',
    feature: f.feature,
    bindings: f.bindings,
  });
  await surface.request({ kind: 'browse' });
  const before = await f.observeRows(surface);
  const address = surface.address;
  const revision = surface.getSnapshot().revision;
  f.setReadsAllowed(false);
  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({
    status: 'denied',
    diagnosticCode: 'data.denied',
  });
  expect(await f.observeRows(surface)).toEqual(before);
  expect(surface.address).toEqual(address);
  expect(surface.getSnapshot().revision).toBe(revision);
  f.dispose();
});

it('exposes explicit partial coverage for page-bounded local results', async () => {
  const f = createPeopleFixture();
  const planned = await f.source.plan(
    {
      version: '1',
      requestId: 'partial-plan',
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'partial-task', outputId: 'rows' },
      query: {
        entity: 'people',
        fields: ['id', 'name', 'team'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
        page: { size: 1 },
      },
      budget: DEFAULT_BUDGET,
    },
    { principal: 'local-user' },
  );
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].message);
  const events = [];
  for await (const event of f.source.execute(planned.value, { principal: 'local-user' })) events.push(event);
  expect(events.find((event) => event.kind === 'descriptor')).toMatchObject({
    descriptor: {
      coverage: { kind: 'partial' },
      warnings: [],
      counts: { loaded: 1, population: { kind: 'exact', value: 2 } },
    },
  });
  expect(events.find((event) => event.kind === 'complete')).toMatchObject({
    finalCoverage: { kind: 'partial', reason: 'page' },
  });
  f.dispose();
});

it('reports explicit query row and response-byte bounds', async () => {
  const f = createPeopleFixture();
  const planned = await f.source.plan(
    {
      version: '1',
      requestId: 'query-bound-plan',
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'query-bound-task', outputId: 'rows' },
      query: {
        entity: 'people',
        fields: ['id', 'name', 'team'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
      },
      budget: { ...DEFAULT_BUDGET, maxRows: 1 },
    },
    { principal: 'local-user' },
  );
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].message);
  const rowBoundEvents = [];
  for await (const event of f.source.execute(planned.value, { principal: 'local-user' })) rowBoundEvents.push(event);
  expect(rowBoundEvents.find((event) => event.kind === 'complete')).toMatchObject({
    finalCoverage: { kind: 'partial', reason: 'row budget' },
  });
  const bytePlanned = await f.source.plan(
    {
      version: '1',
      requestId: 'query-byte-plan',
      catalogRevision: f.feature.catalog.revision,
      target: { taskId: 'query-byte-task', outputId: 'rows' },
      query: {
        entity: 'people',
        fields: ['id', 'name', 'team'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        order: [],
      },
      budget: { ...DEFAULT_BUDGET, maxBytes: 100 },
    },
    { principal: 'local-user' },
  );
  expect(bytePlanned.ok).toBe(true);
  if (!bytePlanned.ok) throw new Error(bytePlanned.diagnostics[0].message);
  const byteEvents = [];
  for await (const event of f.source.execute(bytePlanned.value, { principal: 'local-user' })) byteEvents.push(event);
  expect(byteEvents.find((event) => event.kind === 'error')).toMatchObject({ error: { code: 'data.budget' } });
  f.dispose();
});

it('does not resurrect a disposed surface and isolates same-feature services', async () => {
  const f = createPeopleFixture();
  const first = f.runtime.createSurface({ scope: f.scope, id: 'first', feature: f.feature, bindings: f.bindings });
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const secondBinding = createLocalDataBinding({
    feature: f.feature,
    snapshot: f.updatedSnapshot,
    initialState: f.bindings.initialState,
    coverage: f.bindings.source.coverage,
    normalize: f.bindings.source.normalize,
    serviceOptions: {
      functionRegistry: functions.value,
      authorize: ({ context }) =>
        context.principal === 'local-user'
          ? {
              ok: true,
              value: { scopeDigest: f.scope.getSnapshot().scopeInstanceId, policyRevision: 'local-policy-1' },
            }
          : { ok: false, diagnostics: [{ code: 'data.denied', message: 'Denied.', retryable: false }] },
    },
  });
  const second = f.runtime.createSurface({ scope: f.scope, id: 'second', feature: f.feature, bindings: secondBinding });
  await first.request({ kind: 'browse' });
  await second.request({ kind: 'browse' });
  expect(await f.observeRows(second)).toHaveLength(2);
  expect((await f.observeRows(second)).find((row) => row.id === 'sam')?.team).toBe('Design');
  const firstReplacement: LocalSnapshot = {
    ...f.updatedSnapshot,
    sourceRevision: 'people-source-3',
    records: {
      people: [
        { id: 'ada', name: 'Ada Chen', team: 'Design' },
        { id: 'sam', name: 'Sam Updated', team: 'Design' },
      ],
    },
  };
  expect(f.source.replaceSnapshot(firstReplacement)).toMatchObject({ ok: true });
  await first.request({ kind: 'browse' });
  expect((await f.observeRows(first)).find((row) => row.id === 'sam')?.name).toBe('Sam Updated');
  expect((await f.observeRows(second)).find((row) => row.id === 'sam')?.name).toBe('Sam Rivera');
  first.dispose();
  expect(await first.request({ kind: 'browse' })).toMatchObject({
    status: 'disposed',
    diagnosticCode: 'surface.disposed',
  });
  expect(
    f.source.replaceSnapshot({ ...firstReplacement, sourceRevision: 'people-source-after-dispose' }),
  ).toMatchObject({
    ok: true,
  });
  expect(await first.request({ kind: 'browse' })).toMatchObject({
    status: 'disposed',
    diagnosticCode: 'surface.disposed',
  });
  f.dispose();
});

it('fences an in-flight local request when its scope is disposed', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({ scope: f.scope, id: 'racing', feature: f.feature, bindings: f.bindings });
  const pending = surface.request({ kind: 'browse' });
  f.scope.dispose();
  expect(await pending).toMatchObject({ status: expect.stringMatching(/cancelled|stale|denied|disposed/u) });
  expect(surface.address.activationEpoch).toBe(1);
  f.dispose();
});

it('fences a local source update racing an actual ScopeController transition', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const captured = f.currentOrders();
  const oldAddress = captured.address;
  const deferred = f.source.deferNext();
  const pending = captured.request({ kind: 'browse' });
  await deferred.started;
  const transition = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  expect(f.source.replace('acme', [f.source.acmePrivateRow], 'orders-acme-race-2')).toMatchObject({ ok: true });
  await expect(transition).resolves.toMatchObject({ status: 'active', selector: { id: 'globex' } });
  expect(f.currentOrders().address.activationEpoch).toBeGreaterThan(oldAddress.activationEpoch);
  deferred.resolve();
  await f.release('acme');
  await expect(pending).resolves.toMatchObject({ status: expect.stringMatching(/stale|cancelled|disposed/u) });
  await expect(f.currentOrders().request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  expect(f.view.readRows()).toEqual([{ id: 'globex-order', workspace: 'globex', total: 73 }]);
  await f.dispose();
});

it('rejects a local source change after evaluation terminal state but before publication', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'terminal-race',
    feature: f.feature,
    bindings: f.bindings,
  });
  let replacement: ReturnType<typeof f.source.replaceSnapshot> | undefined;
  f.setAuthorityReadHook((count) => {
    if (count === 3) replacement = f.source.replaceSnapshot(f.updatedSnapshot);
  });
  const result = await surface.request({ kind: 'browse' });
  expect(replacement).toMatchObject({ ok: true });
  expect(result).toMatchObject({ status: 'cancelled', diagnosticCode: 'runtime.evaluation-stale' });
  expect(surface.getSnapshot().state.rows).toEqual([]);
  f.dispose();
});

it('fences a local source change in the final Region publication recheck', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'region-race',
    feature: f.feature,
    bindings: f.bindings,
  });
  let replacement: ReturnType<typeof f.source.replaceSnapshot> | undefined;
  f.setAuthorityReadHook((count) => {
    if (count === 6) replacement = f.source.replaceSnapshot(f.updatedSnapshot);
  });
  const result = await surface.request({ kind: 'browse' });
  expect(replacement).toMatchObject({ ok: true });
  expect(result).toMatchObject({ status: 'cancelled', diagnosticCode: 'runtime.render-stale' });
  expect(surface.getSnapshot().state.rows).toEqual([]);
  expect(f.runtime.snapshot('surface-1')?.results).toEqual([]);
  f.dispose();
});

it('fences a local source change during surface normalization before state publication', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'normalize-race',
    feature: f.feature,
    bindings: f.bindings,
  });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  f.setNormalizeWaiter(async () => {
    started();
    await new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
  });
  const pending = surface.request({ kind: 'browse' });
  await startedPromise;
  expect(f.source.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  release();
  await expect(pending).resolves.toMatchObject({ status: 'cancelled', diagnosticCode: 'runtime.render-stale' });
  expect(surface.getSnapshot().state.rows).toEqual([]);
  f.dispose();
});

it('preserves the prior Region when a source changes during a refresh normalization', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'normalize-prior',
    feature: f.feature,
    bindings: f.bindings,
  });
  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  const priorSurface = surface.getSnapshot();
  const priorRuntime = f.runtime.snapshot('surface-1');
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  f.setNormalizeWaiter(async () => {
    started();
    await new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
  });
  const pending = surface.request({ kind: 'browse' });
  await startedPromise;
  expect(f.source.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
  release();
  await expect(pending).resolves.toMatchObject({ status: 'cancelled', diagnosticCode: 'runtime.render-stale' });
  expect(surface.getSnapshot()).toBe(priorSurface);
  expect(f.runtime.snapshot('surface-1')).toBe(priorRuntime);
  f.dispose();
});

it('rechecks the source pin at the final synchronous surface publication seam', async () => {
  const f = createPeopleFixture();
  let replaced = false;
  f.setNormalizeWaiter(async () => {
    if (!replaced) {
      replaced = true;
      expect(f.source.replaceSnapshot(f.updatedSnapshot)).toMatchObject({ ok: true });
    }
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'publication-seam',
    feature: f.feature,
    bindings: f.bindings,
  });
  const result = await surface.request({ kind: 'browse' });
  expect(replaced).toBe(true);
  expect(result).toMatchObject({ status: 'cancelled', diagnosticCode: 'runtime.render-stale' });
  expect(surface.getSnapshot().state.rows).toEqual([]);
  f.dispose();
});

it('does not publish when normalization disposes the surface before Region commit', async () => {
  const f = createPeopleFixture();
  let surface!: ReturnType<typeof f.runtime.createSurface>;
  let disposeOnNormalize = false;
  surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'publication-dispose',
    feature: f.feature,
    bindings: f.bindings,
  });
  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  disposeOnNormalize = true;
  f.setNormalizeWaiter(async () => {
    if (disposeOnNormalize) surface.dispose();
  });
  const result = await surface.request({ kind: 'browse' });
  expect(result.status).not.toBe('committed');
  expect(surface.getSnapshot().phase).toBe('disposed');
  expect(f.runtime.snapshot('surface-1')).toBeUndefined();
  f.dispose();
});

it('does not inspect sourceRevision on an unbranded custom data service', async () => {
  const f = createPeopleFixture();
  let reads = 0;
  const custom = { ...f.source } as LocalDataService;
  Object.defineProperty(custom, 'sourceRevision', {
    configurable: true,
    get: () => {
      reads += 1;
      throw new Error('custom sourceRevision must not be inspected');
    },
  });
  const binding = Object.freeze({
    ...f.bindings,
    service: custom,
    source: Object.freeze({ ...f.bindings.source, service: custom }),
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'unbranded-source',
    feature: f.feature,
    bindings: binding,
  });
  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  expect(reads).toBe(0);
  f.dispose();
});
