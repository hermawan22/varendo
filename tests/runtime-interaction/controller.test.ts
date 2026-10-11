import { describe, expect, it } from 'vitest';
import {
  createInteractionController,
  createInteractionGraph,
  type InteractionEvent,
  type InteractionGraphDefinition,
  type InteractionHostContext,
  type InteractionPayload,
} from '../../packages/runtime/src/interaction/index.js';
import { createRegionStore, type RegionAuthority } from '../../packages/runtime/src/regions/index.js';
import {
  createResultStore,
  type ResultBeginInput,
  type ResultEvent,
  type ResultHandle,
} from '../../packages/runtime/src/results/index.js';
import {
  createLocalDataService,
  type DataRecord,
  type LocalSnapshot,
  type QueryBudget,
} from '../../packages/runtime/src/data/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import type { Catalog, QuerySpec, ResultRef, Task } from '../../packages/core/src/index.js';

const budget: QueryBudget = {
  maxRows: 100,
  maxBytes: 500_000,
  maxMessages: 32,
  maxMilliseconds: 10_000,
  maxColumns: 20,
};
const registry = createStandardFunctionRegistry();
if (!registry.ok) throw new Error('Standard function registry unavailable.');
const functionRegistry = registry.ok
  ? registry.value
  : (() => {
      throw new Error('Standard function registry unavailable.');
    })();
const catalog: Catalog = {
  version: '1',
  revision: 'interaction-catalog-1',
  functionRegistryDigest: functionRegistry.digest,
  entities: [
    {
      id: 'events',
      label: 'Events',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
        { id: 'department', label: 'Department', type: { value: 'text', nullable: false }, role: 'dimension' },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const rows: DataRecord[] = [
  { id: 'a', department: 'A' },
  { id: 'b', department: 'B' },
];
const sourceSnapshot = (sourceRows: readonly DataRecord[] = rows): LocalSnapshot => ({
  catalog,
  sourceRevision: 'interaction-source-1',
  records: { events: sourceRows },
});
const query = (): QuerySpec => ({
  entity: 'events',
  fields: ['id', 'department'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [],
});

async function localResult(): Promise<{ readonly handle: ResultHandle; readonly ref: ResultRef }> {
  const service = createLocalDataService({ snapshot: sourceSnapshot(), functionRegistry });
  const planned = await service.plan({
    version: '1',
    requestId: 'interaction-query',
    target: { taskId: 'interaction-query', outputId: 'rows' },
    catalogRevision: catalog.revision,
    query: query(),
    budget,
  });
  if (!planned.ok) throw new Error(planned.diagnostics[0]!.message);
  const events: ResultEvent[] = [];
  for await (const event of service.execute(planned.value)) events.push(event);
  const descriptor = events.find((event) => event.kind === 'descriptor');
  if (descriptor?.kind !== 'descriptor') throw new Error('Local data did not produce a descriptor.');
  const ref = descriptor.descriptor.ref;
  const population = descriptor.descriptor.counts.population;
  const populationDigest = population.kind === 'unknown' ? undefined : population.populationDigest;
  const input: ResultBeginInput = {
    principalKey: 'principal-a',
    scopeDigest: ref.scopeDigest,
    policyRevision: 'policy-1',
    queryDigest: ref.queryDigest,
    catalogRevision: catalog.revision,
    functionRegistryDigest: catalog.functionRegistryDigest,
    sourceRevision: 'interaction-source-1',
    outputId: ref.outputId,
    taskId: descriptor.descriptor.taskId,
    requestId: 'interaction-result',
    ...(populationDigest === undefined ? {} : { populationDigest }),
  };
  const store = createResultStore();
  const handle = store.begin(input);
  async function* source(): AsyncGenerator<unknown> {
    yield* events;
  }
  for await (const _update of handle.subscribe(source())) {
    /* consume the real ResultStore stream */
  }
  if (!['ready', 'partial'].includes(handle.snapshot().status))
    throw new Error(
      `ResultStore did not materialize the local result: ${handle.snapshot().status} ${JSON.stringify(handle.snapshot().diagnostics)}`,
    );
  return { handle, ref };
}

const temporalCatalog: Catalog = {
  version: '1',
  revision: 'interaction-temporal-catalog-1',
  functionRegistryDigest: functionRegistry.digest,
  entities: [
    {
      id: 'events',
      label: 'Events',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
        {
          id: 'occurredAt',
          label: 'Occurred at',
          type: {
            value: 'instant',
            nullable: false,
            temporal: { calendar: 'gregorian', timezone: 'UTC', grain: 'day' },
          },
          role: 'time',
        },
        { id: 'department', label: 'Department', type: { value: 'text', nullable: false }, role: 'dimension' },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const temporalRows: DataRecord[] = [
  { id: 'a', occurredAt: '2026-01-05T00:00:00Z', department: 'A' },
  { id: 'b', occurredAt: '2026-02-05T00:00:00Z', department: 'B' },
];
const temporalQuery = (period?: NonNullable<QuerySpec['period']>): QuerySpec => ({
  entity: 'events',
  fields: ['id', 'occurredAt', 'department'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [],
  ...(period === undefined ? {} : { period, timeBucket: { field: 'occurredAt', grain: 'day' } }),
});
const temporalTask = (querySpec: QuerySpec): Extract<Task, { readonly kind: 'data' }> => ({
  version: '1',
  id: 'temporal-interaction-task',
  revision: '1',
  catalogRevision: temporalCatalog.revision,
  functionRegistryDigest: temporalCatalog.functionRegistryDigest,
  regionId: 'temporal-region',
  goal: 'Filter events by period',
  kind: 'data',
  needs: [],
  assumptions: [],
  outputs: [{ id: 'rows', kind: 'query', query: querySpec, dependsOn: [], delivery: 'eager' }],
});

async function temporalResult(
  querySpec: QuerySpec,
): Promise<{ readonly handle: ResultHandle; readonly ref: ResultRef }> {
  const service = createLocalDataService({
    snapshot: {
      catalog: temporalCatalog,
      sourceRevision: 'interaction-temporal-source',
      records: { events: temporalRows },
    },
    functionRegistry,
  });
  const planned = await service.plan({
    version: '1',
    requestId: 'interaction-temporal-query',
    target: { taskId: 'interaction-temporal-query', outputId: 'rows' },
    catalogRevision: temporalCatalog.revision,
    query: querySpec,
    budget,
  });
  if (!planned.ok) throw new Error(planned.diagnostics[0]!.message);
  const events: ResultEvent[] = [];
  for await (const event of service.execute(planned.value)) events.push(event);
  const descriptor = events.find((event) => event.kind === 'descriptor');
  if (descriptor?.kind !== 'descriptor') throw new Error('Temporal local data did not produce a descriptor.');
  const ref = descriptor.descriptor.ref;
  const population = descriptor.descriptor.counts.population;
  const populationDigest = population.kind === 'unknown' ? undefined : population.populationDigest;
  const input: ResultBeginInput = {
    principalKey: 'principal-temporal',
    scopeDigest: ref.scopeDigest,
    policyRevision: 'policy-temporal',
    queryDigest: ref.queryDigest,
    catalogRevision: temporalCatalog.revision,
    functionRegistryDigest: temporalCatalog.functionRegistryDigest,
    sourceRevision: 'interaction-temporal-source',
    outputId: ref.outputId,
    taskId: descriptor.descriptor.taskId,
    requestId: 'interaction-temporal-result',
    ...(populationDigest === undefined ? {} : { populationDigest }),
  };
  const store = createResultStore();
  const handle = store.begin(input);
  async function* source(): AsyncGenerator<unknown> {
    yield* events;
  }
  for await (const _update of handle.subscribe(source())) {
    /* consume the real ResultStore stream */
  }
  if (!['ready', 'partial'].includes(handle.snapshot().status))
    throw new Error(`Temporal result did not materialize: ${handle.snapshot().status}`);
  return { handle, ref };
}

function graphFor(payload: InteractionPayload['kind'] = 'selection'): InteractionGraphDefinition {
  const selection = {
    payload: 'selection' as const,
    entity: 'events',
    identity: ['id'],
    grain: ['id'],
    type: { value: 'text' as const, nullable: false },
  };
  const other = { payload };
  if (payload === 'selection')
    return {
      nodes: [
        {
          id: 'view',
          ports: [
            { id: 'input', direction: 'output', ...selection },
            { id: 'filter', direction: 'output', payload: 'filter' as const },
          ],
        },
      ],
      links: [],
      mappings: [],
    };
  return { nodes: [{ id: 'view', ports: [{ id: 'input', direction: 'output', ...other }] }], links: [], mappings: [] };
}

function event(
  regionRevision: string,
  payload: InteractionPayload,
  eventId: string,
  originNodeId = 'view',
  regionId = 'region-1',
): InteractionEvent {
  return { eventId, causationId: `cause-${eventId}`, regionId, regionRevision, originNodeId, payload };
}

async function harness() {
  const result = await localResult();
  const authority: RegionAuthority = {
    principalKey: 'principal-a',
    scopeDigest: result.ref.scopeDigest,
    policyRevision: 'policy-1',
    catalogRevision: catalog.revision,
    experienceRevision: 'experience-1',
    functionRegistryDigest: catalog.functionRegistryDigest,
    results: [result.ref],
  };
  const task = {
    version: '1' as const,
    id: 'interaction-task',
    revision: '1',
    catalogRevision: catalog.revision,
    functionRegistryDigest: catalog.functionRegistryDigest,
    regionId: 'region-1',
    goal: 'Interact with events',
    kind: 'presentation' as const,
    needs: [],
    assumptions: [],
    inputs: [result.ref],
  };
  const store = createRegionStore({
    readAuthority: () => ({ ok: true as const, value: authority }),
    authorizeCommit: async () => ({ ok: true as const, value: undefined }),
  });
  const created = store.create({ id: 'region-1', state: { task } });
  if (!created.ok) throw new Error(created.diagnostics[0]!.message);
  const region = created.value;
  const graph = createInteractionGraph(graphFor());
  const host = (): InteractionHostContext => ({
    principalKey: 'principal-a',
    draftDomain: 'events',
    actor: { id: 'user-a', kind: 'user' },
    grants: ['experience.commit', 'result.inspect', 'draft.edit', 'navigation.propose', 'action.propose'],
    scopeDigest: authority.scopeDigest,
    policyRevision: authority.policyRevision,
    catalogRevision: authority.catalogRevision,
    experienceRevision: authority.experienceRevision,
    functionRegistryDigest: authority.functionRegistryDigest,
    results: [result.ref],
  });
  const controller = createInteractionController({
    region,
    graph,
    readContext: host,
    resolveResult: (ref) => (ref.id === result.ref.id ? result.handle : undefined),
    validateSelection: (selection) => {
      if (selection.mode === 'clear') return { ok: true, value: undefined };
      const loaded = new Set(
        result.handle.snapshot().batches.flatMap((batch) => batch.rows.map((row) => String(row.id))),
      );
      return selection.mode === 'ids' && selection.keys.every((key) => loaded.has(key))
        ? { ok: true, value: undefined }
        : {
            ok: false,
            diagnostics: [
              {
                code: 'host.selection-scope',
                message: 'Selection is outside the loaded authorized population.',
                retryable: false,
              },
            ],
          };
    },
    validateScope: (payload) =>
      payload.kind === 'filter' && payload.outputId === result.ref.outputId
        ? { ok: true, value: undefined }
        : {
            ok: false,
            diagnostics: [{ code: 'host.scope', message: 'The interaction scope changed.', retryable: false }],
          },
    validateDraft: () => ({ ok: true, value: undefined }),
    materialize: (_payloads, context, next) => ({
      ok: true,
      value: { state: { ...context.region.state!, interaction: next }, resultHandles: [result.handle] },
    }),
    validateNavigation: () => ({ ok: true, value: undefined }),
    onNavigate: () => ({ ok: true, value: undefined }),
    onActionProposal: () => ({ ok: true, value: undefined }),
  });
  return { authority, result, store, region, controller };
}

async function temporalHarness() {
  const initial = await temporalResult(temporalQuery());
  let authority: RegionAuthority = {
    principalKey: 'principal-temporal',
    scopeDigest: initial.ref.scopeDigest,
    policyRevision: 'policy-temporal',
    catalogRevision: temporalCatalog.revision,
    experienceRevision: 'experience-temporal-1',
    functionRegistryDigest: temporalCatalog.functionRegistryDigest,
    results: [initial.ref],
  };
  const task = temporalTask(temporalQuery());
  const store = createRegionStore({
    readAuthority: () => ({ ok: true as const, value: authority }),
    authorizeCommit: async () => ({ ok: true as const, value: undefined }),
  });
  const created = store.create({ id: 'temporal-region', state: { task } });
  if (!created.ok) throw new Error(created.diagnostics[0]!.message);
  const region = created.value;
  const rangeShape = { payload: 'range' as const };
  const graph = createInteractionGraph({
    nodes: [{ id: 'calendar', ports: [{ id: 'range', direction: 'output', ...rangeShape }] }],
    links: [],
    mappings: [],
  });
  let current = initial;
  let materializeCalls = 0;
  const readContext = (): InteractionHostContext => ({
    principalKey: authority.principalKey,
    draftDomain: 'events',
    actor: { id: 'user-temporal', kind: 'user' },
    grants: ['experience.commit', 'result.inspect'],
    scopeDigest: authority.scopeDigest,
    policyRevision: authority.policyRevision,
    catalogRevision: temporalCatalog.revision,
    experienceRevision: authority.experienceRevision,
    functionRegistryDigest: temporalCatalog.functionRegistryDigest,
    results: [initial.ref],
  });
  const controller = createInteractionController({
    region,
    graph,
    readContext,
    resolveResult: (ref) => (ref.id === initial.ref.id ? initial.handle : undefined),
    validateScope: (payload) =>
      payload.kind === 'range' &&
      payload.outputId === 'rows' &&
      payload.range?.calendar === 'gregorian' &&
      payload.range.timezone === 'UTC'
        ? { ok: true, value: undefined }
        : {
            ok: false,
            diagnostics: [
              { code: 'host.calendar-policy', message: 'The range calendar is not authorized.', retryable: false },
            ],
          },
    materialize: async (payloads, context, next) => {
      materializeCalls++;
      const range = payloads[0];
      if (range?.kind !== 'range') throw new Error('Expected a range payload.');
      const fresh = await temporalResult(temporalQuery(range.range ?? undefined));
      current = fresh;
      authority = { ...authority, results: [initial.ref, fresh.ref] };
      const nextTask = temporalTask(temporalQuery(range.range ?? undefined));
      return {
        ok: true,
        value: { state: { task: nextTask, interaction: next }, resultHandles: [initial.handle, fresh.handle] },
      };
    },
  });
  return {
    authority: () => authority,
    initial,
    get current() {
      return current;
    },
    get materializeCalls() {
      return materializeCalls;
    },
    store,
    region,
    controller,
  };
}

describe('runtime interaction controller', () => {
  it('uses a real local-data and ResultStore population for selection and filter state', async () => {
    const { region, controller, result } = await harness();
    const selected = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'select-a',
      ),
      { sourcePortId: 'input' },
    );
    expect(selected).toMatchObject({
      ok: true,
      value: { state: { values: [{ payload: { kind: 'selection', selection: { mode: 'ids', keys: ['a'] } } }] } },
    });
    const filtered = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: result.ref.outputId,
        },
        'filter-a',
      ),
      { sourcePortId: 'filter' },
    );
    expect(filtered.ok).toBe(true);
    if (filtered.ok)
      expect(
        filtered.value.state.values.some(
          (entry) => entry.payload.kind === 'filter' && entry.payload.outputId === 'rows',
        ),
      ).toBe(true);
    expect(controller.state().regionRevision).toBe(region.snapshot().regionRevision);
  });

  it('materializes a temporal range through the real local ADC and changes rows', async () => {
    const temporal = await temporalHarness();
    const period = {
      from: '2026-01-01T00:00:00Z',
      toExclusive: '2026-02-01T00:00:00Z',
      calendar: 'gregorian',
      timezone: 'UTC',
      interpretation: 'UTC calendar month',
    } as const;
    const before = temporal.region.snapshot();
    expect(temporal.initial.handle.snapshot().batches.flatMap((batch) => batch.rows)).toHaveLength(2);
    const accepted = await temporal.controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'range', field: 'occurredAt', range: period, outputId: 'rows' },
        'temporal-range',
        'calendar',
        'temporal-region',
      ),
      { sourcePortId: 'range' },
    );
    expect(accepted).toMatchObject({ ok: true, value: { noop: false } });
    expect(temporal.current.handle.snapshot().batches.flatMap((batch) => batch.rows)).toHaveLength(1);
    const temporalTaskState = temporal.region.snapshot().state?.task;
    expect(temporalTaskState?.kind).toBe('data');
    const temporalOutput = temporalTaskState?.kind === 'data' ? temporalTaskState.outputs[0] : undefined;
    expect(temporalOutput?.kind).toBe('query');
    if (temporalOutput?.kind === 'query') expect(temporalOutput.query.period).toEqual(period);
    expect(
      temporal.controller
        .state()
        .values.some((entry) => entry.payload.kind === 'range' && entry.payload.field === 'occurredAt'),
    ).toBe(true);
    expect(temporal.materializeCalls).toBe(1);
    temporal.controller.dispose();
    temporal.store.dispose();
  });

  it('denies a mismatched range calendar before materialization and preserves state', async () => {
    const temporal = await temporalHarness();
    const before = temporal.region.snapshot();
    const rejected = await temporal.controller.dispatch(
      event(
        before.regionRevision,
        {
          kind: 'range',
          field: 'occurredAt',
          range: {
            from: '2026-01-01T00:00:00Z',
            toExclusive: '2026-02-01T00:00:00Z',
            calendar: 'iso8601',
            timezone: 'UTC',
            interpretation: 'Wrong calendar',
          },
          outputId: 'rows',
        },
        'wrong-calendar',
        'calendar',
        'temporal-region',
      ),
      { sourcePortId: 'range' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'host.calendar-policy' }] });
    expect(temporal.materializeCalls).toBe(0);
    expect(temporal.region.snapshot()).toEqual(before);
    temporal.controller.dispose();
    temporal.store.dispose();
  });

  it('rejects a page cursor from a different query generation before validation', async () => {
    const { region, result, authority, store } = await harness();
    let validated = false;
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor('page')),
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateScope: () => {
        validated = true;
        return { ok: true, value: undefined };
      },
    });
    const before = region.snapshot();
    const rejected = await controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'page', outputId: result.ref.outputId, cursor: 'cursor-next', queryDigest: 'stale-query' },
        'stale-page',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-stale' }] });
    expect(validated).toBe(false);
    expect(region.snapshot().state).toEqual(before.state);
    controller.dispose();
    store.dispose();
  });

  it('preserves the committed draft and task layout on an entity revision conflict', async () => {
    const { region, result, authority, store } = await harness();
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor('draft')),
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'draft.edit'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      validateDraft: () => ({ ok: true, value: undefined }),
    });
    const firstRevision = region.snapshot().regionRevision;
    const firstDraft = {
      kind: 'draft' as const,
      entity: 'events',
      key: 'a',
      field: 'department',
      value: 'C',
      entityRevision: 'entity-1',
    };
    const first = await controller.dispatch(event(firstRevision, firstDraft, 'draft-first'), { sourcePortId: 'input' });
    expect(first).toMatchObject({ ok: true, value: { noop: false } });
    const afterFirst = region.snapshot();
    const taskAfterFirst = afterFirst.state?.task;
    const conflictingDraft = {
      kind: 'draft' as const,
      entity: 'events',
      key: 'a',
      field: 'department',
      value: 'D',
      entityRevision: 'entity-2',
    };
    const rejected = await controller.dispatch(event(afterFirst.regionRevision, conflictingDraft, 'draft-conflict'), {
      sourcePortId: 'input',
    });
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-stale' }] });
    expect(region.snapshot().state?.task).toEqual(taskAfterFirst);
    expect(region.snapshot().state?.interaction?.drafts).toMatchObject([
      { domain: 'events', entity: 'events', key: 'a', field: 'department', value: 'C', entityRevision: 'entity-1' },
    ]);
    controller.dispose();
    store.dispose();
  });

  it('denies an undeclared navigation destination before emitting a navigation effect', async () => {
    const { region, result, authority, store } = await harness();
    let navigated = false;
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor('navigate')),
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['navigation.propose'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      validateNavigation: () => ({
        ok: false,
        diagnostics: [
          { code: 'host.navigation', message: 'The destination is not declared by the application.', retryable: false },
        ],
      }),
      onNavigate: () => {
        navigated = true;
        return { ok: true, value: undefined };
      },
    });
    const before = region.snapshot();
    const rejected = await controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'navigate', route: { id: 'screen.unknown', revision: '1' }, params: {} },
        'unknown-navigation',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'host.navigation' }] });
    expect(navigated).toBe(false);
    expect(region.snapshot()).toEqual(before);
    controller.dispose();
    store.dispose();
  });

  it('rejects an identity outside the real materialized result population', async () => {
    const { region, controller, result } = await harness();
    const rejected = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['not-loaded'], result: result.ref } },
        'select-forbidden',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'host.selection-scope' }] });
    expect(controller.state().values).toEqual([]);
  });

  it('rejects a result handle from a different trusted principal partition', async () => {
    const { region, result, authority } = await harness();
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      readContext: () => ({
        principalKey: 'principal-b',
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: () => ({ ok: true, value: undefined }),
    });
    const rejected = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'cross-principal',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-denied' }] });
  });

  it('rejects stale region vectors after another committed controller update', async () => {
    const first = await harness();
    const second = createInteractionController({
      region: first.region,
      graph: createInteractionGraph(graphFor()),
      readContext: () => ({
        principalKey: 'principal-a',
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit'],
        scopeDigest: first.authority.scopeDigest,
        policyRevision: first.authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: first.authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [first.result.ref],
      }),
      resolveResult: (ref) => (ref.id === first.result.ref.id ? first.result.handle : undefined),
      validateSelection: () => ({ ok: true, value: undefined }),
    });
    const revision = first.region.snapshot().regionRevision;
    const committed = await first.controller.dispatch(
      event(
        revision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: first.result.ref } },
        'first',
      ),
      { sourcePortId: 'input' },
    );
    expect(committed.ok).toBe(true);
    const stale = await second.dispatch(
      event(revision, { kind: 'selection', selection: { mode: 'clear' } }, 'second'),
      { sourcePortId: 'input' },
    );
    expect(stale).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-stale' }] });
  });

  it('allows a failed event ID to retry and commit on a later attempt', async () => {
    const { region, result, authority, store } = await harness();
    let attempts = 0;
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: () => {
        attempts++;
        return attempts === 1
          ? { ok: false, diagnostics: [{ code: 'host.retryable', message: 'Try again.', retryable: true }] }
          : { ok: true, value: undefined };
      },
    });
    const input = event(
      region.snapshot().regionRevision,
      { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
      'retry-event',
    );
    expect(await controller.dispatch(input, { sourcePortId: 'input' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'host.retryable' }],
    });
    expect(await controller.dispatch(input, { sourcePortId: 'input' })).toMatchObject({
      ok: true,
      value: { noop: false },
    });
    expect(attempts).toBe(2);
    controller.dispose();
    store.dispose();
  });

  it('deduplicates an exact successful event and rejects an event ID collision', async () => {
    const { region, controller, result, store } = await harness();
    const input = event(
      region.snapshot().regionRevision,
      { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
      'dedupe-event',
    );
    const first = await controller.dispatch(input, { sourcePortId: 'input' });
    expect(first).toMatchObject({ ok: true, value: { noop: false } });
    const duplicate = await controller.dispatch(input, { sourcePortId: 'input' });
    expect(duplicate).toMatchObject({ ok: true, value: { noop: true, effects: [] } });
    const collision = await controller.dispatch(
      { ...input, payload: { kind: 'selection', selection: { mode: 'clear' } } },
      { sourcePortId: 'input' },
    );
    expect(collision).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-invalid' }] });
    controller.dispose();
    store.dispose();
  });

  it('applies the event deadline to a successful duplicate receipt', async () => {
    const fixture = await harness();
    fixture.controller.dispose();
    let slow = false;
    const controller = createInteractionController({
      region: fixture.region,
      graph: createInteractionGraph(graphFor()),
      maxEventMilliseconds: 10,
      readContext: () => {
        if (slow) {
          const until = Date.now() + 30;
          while (Date.now() < until) {
            /* deliberately block the event loop */
          }
        }
        return {
          principalKey: fixture.authority.principalKey,
          draftDomain: 'events',
          actor: { id: 'user-a', kind: 'user' },
          grants: ['experience.commit', 'result.inspect'],
          scopeDigest: fixture.authority.scopeDigest,
          policyRevision: fixture.authority.policyRevision,
          catalogRevision: catalog.revision,
          experienceRevision: fixture.authority.experienceRevision,
          functionRegistryDigest: fixture.authority.functionRegistryDigest,
          results: [fixture.result.ref],
        };
      },
      resolveResult: () => fixture.result.handle,
      validateSelection: () => ({ ok: true, value: undefined }),
    });
    const input = event(
      fixture.region.snapshot().regionRevision,
      { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: fixture.result.ref } },
      'deadline-duplicate',
    );
    expect(await controller.dispatch(input, { sourcePortId: 'input' })).toMatchObject({
      ok: true,
      value: { noop: false },
    });
    slow = true;
    expect(await controller.dispatch(input, { sourcePortId: 'input' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.interaction-budget' }],
    });
    controller.dispose();
    fixture.store.dispose();
  });

  it('admits no more synchronous pending events than the queue budget', async () => {
    const { region, result, authority, store } = await harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      maxQueuedEvents: 1,
      readContext: () => ({
        principalKey: 'principal-a',
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: async () => {
        await gate;
        return { ok: true, value: undefined };
      },
    });
    const first = controller.dispatch(
      event(
        region.snapshot().regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'bounded-first',
      ),
      { sourcePortId: 'input' },
    );
    const second = await controller.dispatch(
      event(region.snapshot().regionRevision, { kind: 'selection', selection: { mode: 'clear' } }, 'bounded-second'),
      { sourcePortId: 'input' },
    );
    expect(second).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-budget' }] });
    release();
    expect((await first).ok).toBe(true);
    controller.dispose();
    store.dispose();
  });

  it('materializes once when one event reaches multiple query outputs', async () => {
    const { region, result, authority, store } = await harness();
    const filterShape = { payload: 'filter' as const };
    const manifest = {
      ref: { id: 'filter-pass-through', revision: '1' },
      source: filterShape,
      target: filterShape,
      kind: 'registered' as const,
    };
    const graph = createInteractionGraph({
      nodes: [
        { id: 'source', ports: [{ id: 'out', direction: 'output', ...filterShape }] },
        { id: 'left', ports: [{ id: 'in', direction: 'input', ...filterShape }] },
        { id: 'right', ports: [{ id: 'in', direction: 'input', ...filterShape }] },
      ],
      links: [
        {
          id: 'to-left',
          source: { node: 'source', port: 'out' },
          target: { node: 'left', port: 'in' },
          mapping: manifest.ref,
          propagation: 'directed',
        },
        {
          id: 'to-right',
          source: { node: 'source', port: 'out' },
          target: { node: 'right', port: 'in' },
          mapping: manifest.ref,
          propagation: 'directed',
        },
      ],
      mappings: [manifest],
    });
    expect(graph.registerMapping({ manifest, map: (payload) => ({ ok: true, value: payload }) })).toMatchObject({
      ok: true,
    });
    const host = (): InteractionHostContext => ({
      principalKey: 'principal-a',
      draftDomain: 'events',
      actor: { id: 'user-a', kind: 'user' },
      grants: ['experience.commit', 'result.inspect'],
      scopeDigest: authority.scopeDigest,
      policyRevision: authority.policyRevision,
      catalogRevision: catalog.revision,
      experienceRevision: authority.experienceRevision,
      functionRegistryDigest: catalog.functionRegistryDigest,
      results: [result.ref],
    });
    let materializeCalls = 0;
    const controller = createInteractionController({
      region,
      graph,
      readContext: host,
      resolveResult: () => result.handle,
      validateScope: () => ({ ok: true, value: undefined }),
      materialize: (_payloads, context, next) => {
        materializeCalls++;
        return {
          ok: true,
          value: { state: { ...context.region.state!, interaction: next }, resultHandles: [result.handle] },
        };
      },
    });
    const dispatched = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: result.ref.outputId,
        },
        'fanout',
        'source',
      ),
      { sourcePortId: 'out' },
    );
    expect(dispatched.ok).toBe(true);
    expect(materializeCalls).toBe(1);
    if (dispatched.ok)
      expect(dispatched.value.state.values.filter((entry) => entry.payload.kind === 'filter')).toHaveLength(3);
    controller.dispose();
    store.dispose();
  });

  it('enforces one event deadline across sequential host validations', async () => {
    const { region, result, authority, store } = await harness();
    const filterShape = { payload: 'filter' as const };
    const manifest = {
      ref: { id: 'filter-deadline-pass-through', revision: '1' },
      source: filterShape,
      target: filterShape,
      kind: 'registered' as const,
    };
    const graph = createInteractionGraph({
      nodes: [
        { id: 'source', ports: [{ id: 'out', direction: 'output', ...filterShape }] },
        { id: 'target', ports: [{ id: 'in', direction: 'input', ...filterShape }] },
      ],
      links: [
        {
          id: 'to-target',
          source: { node: 'source', port: 'out' },
          target: { node: 'target', port: 'in' },
          mapping: manifest.ref,
          propagation: 'directed',
        },
      ],
      mappings: [manifest],
    });
    expect(graph.registerMapping({ manifest, map: (payload) => ({ ok: true, value: payload }) })).toMatchObject({
      ok: true,
    });
    let validationCalls = 0;
    let materializeCalls = 0;
    const controller = createInteractionController({
      region,
      graph,
      maxEventMilliseconds: 50,
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateScope: async () => {
        validationCalls++;
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        return { ok: true, value: undefined };
      },
      materialize: () => {
        materializeCalls++;
        return { ok: true, value: { state: region.snapshot().state!, resultHandles: [result.handle] } };
      },
    });
    const outcome = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: result.ref.outputId,
        },
        'deadline-fanout',
        'source',
      ),
      { sourcePortId: 'out' },
    );
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-budget' }] });
    expect(validationCalls).toBe(2);
    expect(materializeCalls).toBe(0);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('aborts an uncooperative callback at the event deadline without committing late success', async () => {
    const { region, result, authority, store } = await harness();
    let resolveValidation!: (value: { ok: true; value: undefined }) => void;
    const lateValidation = new Promise<{ ok: true; value: undefined }>((resolve) => {
      resolveValidation = resolve;
    });
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      maxEventMilliseconds: 10,
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: () => lateValidation,
    });
    const before = region.snapshot();
    const pending = controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'late-validation',
      ),
      { sourcePortId: 'input' },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-budget' }] });
    resolveValidation({ ok: true, value: undefined });
    await Promise.resolve();
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('rejects a synchronous callback that blocks past the event deadline', async () => {
    const { region, result, authority, store } = await harness();
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      maxEventMilliseconds: 10,
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: () => {
        const until = Date.now() + 30;
        while (Date.now() < until) {
          /* deliberately block the event loop */
        }
        return { ok: true, value: undefined };
      },
    });
    const before = region.snapshot();
    const rejected = await controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'sync-deadline',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-budget' }] });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('extends the expected read set for a fresh materialized result handle', async () => {
    const first = await harness();
    const fresh = await localResult();
    const authority = first.authority as RegionAuthority & { results: ResultRef[] };
    const oldRef = first.result.ref;
    authority.results = [oldRef, fresh.ref];
    const host = (): InteractionHostContext => ({
      principalKey: authority.principalKey,
      draftDomain: 'events',
      actor: { id: 'user-a', kind: 'user' },
      grants: ['experience.commit', 'result.inspect'],
      scopeDigest: authority.scopeDigest,
      policyRevision: authority.policyRevision,
      catalogRevision: catalog.revision,
      experienceRevision: authority.experienceRevision,
      functionRegistryDigest: authority.functionRegistryDigest,
      results: [oldRef],
    });
    const controller = createInteractionController({
      region: first.region,
      graph: createInteractionGraph(graphFor('filter')),
      readContext: host,
      resolveResult: (ref) => (ref.id === oldRef.id ? first.result.handle : undefined),
      validateScope: () => ({ ok: true, value: undefined }),
      materialize: (_payloads, context, next) => ({
        ok: true,
        value: {
          state: { ...context.region.state!, interaction: next },
          resultHandles: [first.result.handle, fresh.handle],
        },
      }),
    });
    const committed = await controller.dispatch(
      event(
        first.region.snapshot().regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: oldRef.outputId,
        },
        'fresh-result',
      ),
      { sourcePortId: 'input' },
    );
    expect(committed.ok).toBe(true);
    expect(first.region.snapshot().readSet?.results).toHaveLength(2);
    controller.dispose();
    first.store.dispose();
    fresh.handle.release();
  });

  it('does not commit when a required grant is revoked during materialization', async () => {
    const { region, result, authority, store } = await harness();
    let grants: InteractionHostContext['grants'] = ['experience.commit', 'result.inspect'];
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const materializerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor('filter')),
      readContext: () => ({
        principalKey: 'principal-a',
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants,
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateScope: () => ({ ok: true, value: undefined }),
      materialize: async (_payloads, context, next) => {
        grants = ['result.inspect'];
        started();
        await gate;
        return {
          ok: true,
          value: { state: { ...context.region.state!, interaction: next }, resultHandles: [result.handle] },
        };
      },
    });
    const before = region.snapshot();
    const pending = controller.dispatch(
      event(
        before.regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: result.ref.outputId,
        },
        'grant-revoked',
      ),
      { sourcePortId: 'input' },
    );
    await materializerStarted;
    release();
    const rejected = await pending;
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-denied' }] });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('rejects an in-place actor change while materialization is awaiting', async () => {
    const { region, result, authority, store } = await harness();
    const hostContext: InteractionHostContext = {
      principalKey: authority.principalKey,
      draftDomain: 'events',
      actor: { id: 'user-a', kind: 'user' },
      grants: ['experience.commit', 'result.inspect'],
      scopeDigest: authority.scopeDigest,
      policyRevision: authority.policyRevision,
      catalogRevision: catalog.revision,
      experienceRevision: authority.experienceRevision,
      functionRegistryDigest: catalog.functionRegistryDigest,
      results: [result.ref],
    };
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor('filter')),
      readContext: () => hostContext,
      resolveResult: () => result.handle,
      validateScope: () => ({ ok: true, value: undefined }),
      materialize: (_payloads, context, next) => {
        (hostContext.actor as { id: string; kind: 'user' }).id = 'attacker';
        return {
          ok: true,
          value: { state: { ...context.region.state!, interaction: next }, resultHandles: [result.handle] },
        };
      },
    });
    const before = region.snapshot();
    const rejected = await controller.dispatch(
      event(
        before.regionRevision,
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: result.ref.outputId,
        },
        'actor-mutated',
      ),
      { sourcePortId: 'input' },
    );
    expect(rejected).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-stale' }] });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('cancels before region authorization publishes the staged interaction state', async () => {
    const result = await localResult();
    const authority: RegionAuthority = {
      principalKey: 'principal-a',
      scopeDigest: result.ref.scopeDigest,
      policyRevision: 'policy-1',
      catalogRevision: catalog.revision,
      experienceRevision: 'experience-1',
      functionRegistryDigest: catalog.functionRegistryDigest,
      results: [result.ref],
    };
    const task = {
      version: '1' as const,
      id: 'interaction-task',
      revision: '1',
      catalogRevision: catalog.revision,
      functionRegistryDigest: catalog.functionRegistryDigest,
      regionId: 'region-1',
      goal: 'Interact with events',
      kind: 'presentation' as const,
      needs: [],
      assumptions: [],
      inputs: [result.ref],
    };
    let authorizeStarted!: () => void;
    let releaseAuthorize!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizeStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorize = resolve;
    });
    const store = createRegionStore({
      readAuthority: () => ({ ok: true as const, value: authority }),
      authorizeCommit: async ({ signal }) => {
        void signal;
        authorizeStarted();
        await gate;
        return { ok: true as const, value: undefined };
      },
    });
    const created = store.create({ id: 'region-1', state: { task } });
    if (!created.ok) throw new Error(created.diagnostics[0]!.message);
    const region = created.value;
    const controller = createInteractionController({
      region,
      graph: createInteractionGraph(graphFor()),
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'events',
        actor: { id: 'user-a', kind: 'user' },
        grants: ['experience.commit', 'result.inspect'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: authority.catalogRevision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [result.ref],
      }),
      resolveResult: () => result.handle,
      validateSelection: () => ({ ok: true, value: undefined }),
    });
    const before = region.snapshot();
    const abort = new AbortController();
    const pending = controller.dispatch(
      event(
        before.regionRevision,
        { kind: 'selection', selection: { mode: 'ids', entity: 'events', keys: ['a'], result: result.ref } },
        'cancel-auth',
      ),
      { sourcePortId: 'input', signal: abort.signal },
    );
    await started;
    abort.abort();
    releaseAuthorize();
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-cancelled' }] });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(region.snapshot().state?.interaction).toBeUndefined();
    controller.dispose();
    store.dispose();
  });

  it('allows a propagation edge at the configured hop limit', () => {
    const shape = { payload: 'filter' as const };
    const manifest = {
      ref: { id: 'directed-hop', revision: '1' },
      source: shape,
      target: shape,
      kind: 'registered' as const,
    };
    const graph = createInteractionGraph({
      nodes: [
        { id: 'a', ports: [{ id: 'filter', direction: 'output', ...shape }] },
        { id: 'b', ports: [{ id: 'filter', direction: 'input', ...shape }] },
      ],
      links: [
        {
          id: 'a-to-b',
          source: { node: 'a', port: 'filter' },
          target: { node: 'b', port: 'filter' },
          mapping: manifest.ref,
          propagation: 'directed',
        },
      ],
      mappings: [manifest],
    });
    expect(graph.registerMapping({ manifest, map: (payload) => ({ ok: true, value: payload }) })).toMatchObject({
      ok: true,
    });
    const routed = graph.route(
      event(
        'r-1',
        {
          kind: 'filter',
          predicates: [{ op: 'compare', field: 'department', comparison: 'eq', value: 'A' }],
          outputId: 'rows',
        },
        'one-hop',
        'a',
      ),
      { nodeId: 'a', portId: 'filter' },
      new AbortController().signal,
      1,
    );
    expect(routed).toMatchObject({ ok: true, value: [{ route: { nodeId: 'b', portId: 'filter' } }] });
  });

  it('converges a bidirectional identity selection cycle with built-in propagation', async () => {
    const shape = {
      payload: 'selection' as const,
      entity: 'events',
      identity: ['id'],
      grain: ['id'],
      type: { value: 'text' as const, nullable: false },
    };
    const graph = createInteractionGraph({
      nodes: [
        { id: 'a', ports: [{ id: 'selection', direction: 'inout', ...shape }] },
        { id: 'b', ports: [{ id: 'selection', direction: 'inout', ...shape }] },
      ],
      links: [
        {
          id: 'a-to-b',
          source: { node: 'a', port: 'selection' },
          target: { node: 'b', port: 'selection' },
          mapping: { id: 'identity', revision: '1' },
          propagation: 'identity-equivalence',
        },
        {
          id: 'b-to-a',
          source: { node: 'b', port: 'selection' },
          target: { node: 'a', port: 'selection' },
          mapping: { id: 'identity', revision: '1' },
          propagation: 'identity-equivalence',
        },
      ],
      mappings: [{ ref: { id: 'identity', revision: '1' }, source: shape, target: shape, kind: 'identity' }],
    });
    expect(
      graph.registerMapping({
        manifest: { ref: { id: 'identity', revision: '1' }, source: shape, target: shape, kind: 'identity' },
      }),
    ).toMatchObject({ ok: true });
    const routed = graph.route(
      event('r-1', { kind: 'selection', selection: { mode: 'clear' } }, 'cycle'),
      { nodeId: 'a', portId: 'selection' },
      new AbortController().signal,
    );
    expect(routed).toMatchObject({
      ok: true,
      value: [{ route: { nodeId: 'b', portId: 'selection' } }, { route: { nodeId: 'a', portId: 'selection' } }],
    });
  });

  it('keeps action requests proposal-only and derives actor from host context', async () => {
    const { region, result, authority, store } = await harness();
    let actor = '';
    const graph = createInteractionGraph(graphFor('action-request'));
    const controller = createInteractionController({
      region,
      graph,
      readContext: () => ({
        principalKey: 'principal-a',
        draftDomain: 'events',
        actor: { id: 'trusted-user', kind: 'user' },
        grants: ['action.propose'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: catalog.revision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        results: [result.ref],
      }),
      onActionProposal: (_payload, context) => {
        actor = context.host.actor.id;
        return { ok: true, value: undefined };
      },
    });
    const accepted = await controller.dispatch(
      event(
        region.snapshot().regionRevision,
        { kind: 'action-request', action: { id: 'archive', revision: '1' }, input: { key: 'a' } },
        'propose',
      ),
      { sourcePortId: 'input' },
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: { effects: [{ kind: 'action-proposal', actorId: 'trusted-user' }] },
    });
    expect(actor).toBe('trusted-user');
    const forged = await controller.dispatch(
      {
        ...event(
          region.snapshot().regionRevision,
          { kind: 'action-request', action: { id: 'archive', revision: '1' }, input: {} },
          'forged',
        ),
        actor: 'human',
      },
      { sourcePortId: 'input' },
    );
    expect(forged).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.interaction-invalid' }] });
    store.dispose();
  });
});
