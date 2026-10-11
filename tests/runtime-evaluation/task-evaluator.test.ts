import { describe, expect, it } from 'vitest';
import { type Catalog, type QuerySpec, type ResultRef, type Task } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import {
  createDataHttpHandler,
  createHttpDataService,
  createLocalDataService,
  type DataRecord,
  type LocalSnapshot,
  type QueryBudget,
  type ResultEvent,
} from '../../packages/runtime/src/data/index.js';
import { createResultStore, type ResultHandle } from '../../packages/runtime/src/results/index.js';
import {
  createResultCohortResolver,
  createTaskEvaluator,
  cohortDigest,
  type CohortMembership,
  type CohortResolverContext,
  type TrustedEvaluationContext,
} from '../../packages/runtime/src/evaluation/index.js';

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

const catalog: Catalog = {
  version: '1',
  revision: 'evaluation-catalog-1',
  functionRegistryDigest,
  entities: [
    {
      id: 'employees',
      label: 'Employees',
      identity: ['employee_id'],
      rowGrain: ['employee_id'],
      fields: [
        { id: 'employee_id', label: 'Employee', type: { value: 'text', nullable: false }, role: 'identity' },
        { id: 'score', label: 'Score', type: { value: 'integer', nullable: false }, role: 'measure' },
      ],
    },
    {
      id: 'facts',
      label: 'Facts',
      identity: ['fact_id'],
      rowGrain: ['fact_id'],
      fields: [
        { id: 'fact_id', label: 'Fact', type: { value: 'text', nullable: false }, role: 'identity' },
        { id: 'employee_id', label: 'Employee', type: { value: 'text', nullable: false }, role: 'attribute' },
        { id: 'week', label: 'Week', type: { value: 'text', nullable: false }, role: 'dimension' },
        { id: 'amount', label: 'Amount', type: { value: 'integer', nullable: false }, role: 'measure' },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

const employees: DataRecord[] = [
  { employee_id: 'e1', score: 9 },
  { employee_id: 'e2', score: 4 },
  { employee_id: 'e3', score: 2 },
];
const facts: DataRecord[] = [
  { fact_id: 'f1', employee_id: 'e1', week: '2026-W01', amount: 1 },
  { fact_id: 'f2', employee_id: 'e2', week: '2026-W01', amount: 1 },
  { fact_id: 'f3', employee_id: 'e1', week: '2026-W02', amount: 2 },
  { fact_id: 'f4', employee_id: 'e3', week: '2026-W02', amount: 4 },
];

const snapshot = (sourceRevision = 'source-1', nextFacts = facts): LocalSnapshot => ({
  catalog,
  sourceRevision,
  records: { employees, facts: nextFacts },
});

function query(
  entity: string,
  fields: readonly string[],
  population: QuerySpec['population'] = { kind: 'all-authorized' },
  overrides: Partial<QuerySpec> = {},
): QuerySpec {
  return { entity, fields, measures: [], relations: [], groupBy: [], population, order: [], ...overrides };
}

async function materializeSeed(
  service: ReturnType<typeof createLocalDataService>,
  store: ReturnType<typeof createResultStore>,
  input: { readonly query: QuerySpec; readonly outputId: string; readonly allowPartial?: boolean },
): Promise<ResultHandle> {
  const planned = await service.plan({
    version: '1',
    requestId: `seed-plan-${input.outputId}`,
    catalogRevision: catalog.revision,
    target: { taskId: `seed-plan-${input.outputId}`, outputId: input.outputId },
    query: input.query,
    budget,
  });
  if (!planned.ok) throw new Error(planned.diagnostics[0]?.message ?? 'seed plan failed');
  const accepted = planned.value;
  const handle = store.begin({
    principalKey: 'principal-a',
    scopeDigest: accepted.scopeDigest,
    ...(accepted.policyRevision === undefined ? {} : { policyRevision: accepted.policyRevision }),
    populationDigest: accepted.populationDigest,
    queryDigest: accepted.queryDigest,
    catalogRevision: accepted.catalogRevision,
    functionRegistryDigest: accepted.functionRegistryDigest,
    sourceRevision: accepted.sourceRevision,
    sourceLineage: accepted.sourceLineage,
    planDigest: accepted.planDigest,
    resultShape: accepted.resultShape,
    lineageDigest: accepted.lineageDigest,
    outputId: accepted.target.outputId,
    taskId: accepted.requestId,
    requestId: accepted.requestId,
  });
  const subscription = handle.subscribe(service.execute(accepted));
  for await (const _ of subscription) {
    /* materialize the complete seed */
  }
  if (handle.snapshot().status !== 'ready' && !(input.allowPartial === true && handle.snapshot().status === 'partial'))
    throw new Error(handle.snapshot().diagnostics[0]?.message ?? 'seed result failed');
  return handle;
}

function resolverContext(
  context: TrustedEvaluationContext,
  resolveResult: (ref: ResultRef) => ResultHandle | undefined,
): CohortResolverContext {
  return {
    readContext: context.readContext,
    principalKey: context.principalKey,
    scopeDigest: context.scopeDigest,
    ...(context.policyRevision === undefined ? {} : { policyRevision: context.policyRevision }),
    catalogRevision: context.catalogRevision,
    functionRegistryDigest: context.functionRegistryDigest,
    grants: context.grants,
    catalog: context.catalog,
    resultStore: context.resultStore,
    resolveResult,
    now: context.now,
  };
}

function task(outputs: Extract<Task, { readonly kind: 'data' }>['outputs']): Task {
  return {
    version: '1',
    id: 'task-evaluation',
    revision: '1',
    catalogRevision: catalog.revision,
    functionRegistryDigest,
    regionId: 'region-evaluation',
    goal: 'Evaluate named outputs',
    needs: [],
    assumptions: [],
    kind: 'data',
    outputs,
  };
}

function rows(handle: ResultHandle): readonly Record<string, unknown>[] {
  return handle.snapshot().batches.flatMap((batch) => batch.rows as readonly Record<string, unknown>[]);
}

async function collect(events: AsyncIterable<ResultEvent>): Promise<ResultEvent[]> {
  const all: ResultEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

function hostContext(
  service: ReturnType<typeof createLocalDataService>,
  store: ReturnType<typeof createResultStore>,
  resolveResult: (ref: ResultRef) => ResultHandle | undefined,
  resolver?: ReturnType<typeof createResultCohortResolver>,
  grants: readonly string[] = ['task.evaluate', 'result.inspect'],
): TrustedEvaluationContext {
  return {
    principalKey: 'principal-a',
    scopeDigest: 'scope-public',
    catalogRevision: catalog.revision,
    functionRegistryDigest,
    grants,
    catalog,
    data: service,
    resultStore: store,
    readContext: { principal: 'principal-a' },
    ...(resolver === undefined ? {} : { cohortResolver: resolver }),
    resolveResult,
    now: () => Date.now(),
    budget,
  };
}

async function membershipFor(
  context: TrustedEvaluationContext,
  resolver: ReturnType<typeof createResultCohortResolver>,
  source: ResultHandle,
): Promise<CohortMembership> {
  const ref = source.snapshot().descriptor!.ref;
  const result = await resolver.resolve(
    {
      source: ref,
      identityKeys: ['employee_id'],
      targetGrain: ['employee_id'],
      scopeDigest: context.scopeDigest,
      catalogRevision: context.catalogRevision,
      deadlineAt: Date.now() + 5_000,
    },
    resolverContext(context, (candidate) => (candidate.id === ref.id ? source : undefined)),
  );
  if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? 'cohort resolution failed');
  return result.value;
}

describe('runtime named-output and cohort evaluation', () => {
  it('resolves a complete fixed cohort, preserves its digest and lineage, and survives a later source revision', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const store = createResultStore();
    const seed = await materializeSeed(service, store, {
      outputId: 'ranking-seed',
      query: query('employees', ['employee_id', 'score'], undefined, {
        order: [{ field: 'score', direction: 'desc', nulls: 'last' }],
      }),
    });
    const resolver = createResultCohortResolver();
    const resolveResult = (ref: ResultRef): ResultHandle | undefined =>
      ref.id === seed.snapshot().descriptor?.ref.id ? seed : undefined;
    const context = hostContext(service, store, resolveResult, resolver);
    const membership = await membershipFor(context, resolver, seed);
    expect(membership.tuples).toEqual([['e1'], ['e2'], ['e3']]);
    const reversedDigest = await cohortDigest({
      source: membership.source,
      identityKeys: membership.identityKeys,
      types: membership.types,
      tuples: [...membership.tuples].reverse(),
      scopeDigest: membership.scopeDigest,
      catalogRevision: membership.catalogRevision,
      sourceRevision: membership.sourceRevision,
    });
    expect(reversedDigest).toEqual({ ok: true, value: membership.tupleDigest });
    const fixed = task([
      {
        id: 'trend',
        kind: 'query',
        query: query('facts', ['fact_id', 'employee_id', 'week', 'amount'], {
          kind: 'fixed',
          source: seed.snapshot().descriptor!.ref,
          identityKeys: ['employee_id'],
          cohortDigest: membership.tupleDigest,
        }),
        dependsOn: [],
        delivery: 'eager',
      },
    ]);
    const evaluator = createTaskEvaluator({ host: { readContext: () => ({ ok: true, value: context }) } });
    const evaluated = await evaluator.evaluate({ task: fixed });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message);
    const output = evaluated.value.get('trend')!;
    expect(rows(output.handle).map((row) => row.employee_id)).toEqual(['e1', 'e2', 'e1', 'e3']);
    expect(output.descriptor?.coverage).toEqual({ kind: 'complete', populationDigest: membership.tupleDigest });
    expect(output.descriptor?.lineage).toEqual([{ output: 'trend', inputs: [seed.snapshot().descriptor!.ref] }]);
    const originalQueryDigest = output.descriptor!.ref.queryDigest;
    expect(originalQueryDigest).toMatch(/^query-/u);
    expect(output.accepted?.queryDigest).toBe(originalQueryDigest);
    expect(output.ref.outputId).toBe('trend');
    const wrongDigestTask = task([
      {
        id: 'wrong',
        kind: 'query',
        query: query('facts', ['fact_id', 'employee_id'], {
          kind: 'fixed',
          source: seed.snapshot().descriptor!.ref,
          identityKeys: ['employee_id'],
          cohortDigest: 'cohort-untrusted',
        }),
        dependsOn: [],
        delivery: 'eager',
      },
    ]);
    const wrongDigest = await evaluator.evaluate({ task: wrongDigestTask });
    expect(wrongDigest.ok).toBe(false);
    if (!wrongDigest.ok) expect(wrongDigest.diagnostics[0]?.code).toBe('data.stale-cohort');
    evaluated.value.release();
    expect(
      service.replaceSnapshot(
        snapshot(
          'source-2',
          facts.map((row) => (row.employee_id === 'e2' ? { ...row, amount: 99 } : row)),
        ),
      ).ok,
    ).toBe(true);
    const afterRevision = await evaluator.evaluate({ task: fixed });
    expect(afterRevision.ok).toBe(true);
    if (afterRevision.ok)
      expect(rows(afterRevision.value.get('trend')!.handle).map((row) => row.employee_id)).toEqual([
        'e1',
        'e2',
        'e1',
        'e3',
      ]);
  });

  it('executes a live-output dependency in topological order and only materializes requested on-demand outputs', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const store = createResultStore();
    const context = hostContext(service, store, () => undefined);
    const evaluator = createTaskEvaluator({ host: { readContext: () => ({ ok: true, value: context }) } });
    const ranking = {
      id: 'ranking',
      kind: 'query' as const,
      query: query('employees', ['employee_id', 'score'], undefined, {
        order: [{ field: 'score', direction: 'desc', nulls: 'last' }],
      }),
      dependsOn: [],
      delivery: 'on-demand' as const,
    };
    const trend = {
      id: 'trend',
      kind: 'query' as const,
      query: query('facts', ['fact_id', 'employee_id', 'week', 'amount'], {
        kind: 'live-output',
        outputId: 'ranking',
        identityKeys: ['employee_id'],
      }),
      dependsOn: ['ranking'],
      delivery: 'eager' as const,
    };
    const evaluated = await evaluator.evaluate({ task: task([ranking, trend]) });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message);
    expect(evaluated.value.outputs.map((output) => output.outputId)).toEqual(['ranking', 'trend']);
    expect(rows(evaluated.value.get('trend')!.handle).map((row) => row.employee_id)).toEqual(['e1', 'e2', 'e1', 'e3']);
    evaluated.value.release();
    const requested = await evaluator.evaluate({
      task: task([ranking, { ...trend, delivery: 'on-demand' }]),
      requestedOutputs: ['ranking'],
    });
    expect(requested.ok).toBe(true);
    if (requested.ok) {
      expect(requested.value.outputs.map((output) => output.outputId)).toEqual(['ranking']);
      requested.value.release();
    }
    const rankingOutput = evaluated.ok ? evaluated.value.get('ranking')! : undefined;
    const reuseContext = hostContext(service, store, (ref) =>
      ref.id === rankingOutput?.ref.id ? rankingOutput?.handle : undefined,
    );
    const reused = await createTaskEvaluator({
      host: { readContext: () => ({ ok: true, value: reuseContext }) },
    }).evaluate({ task: task([{ id: 'ranking-alias', kind: 'reuse', result: rankingOutput!.ref, dependsOn: [] }]) });
    expect(reused.ok).toBe(true);
    if (reused.ok) {
      expect(reused.value.get('ranking-alias')?.ref).toEqual(rankingOutput!.ref);
      reused.value.release();
    }
  });

  it('publishes honest partial on-demand pages but never uses them as cohort sources', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const store = createResultStore();
    const context = hostContext(service, store, () => undefined);
    const evaluator = createTaskEvaluator({ host: { readContext: () => ({ ok: true, value: context }) } });
    const detail = {
      id: 'detail',
      kind: 'query' as const,
      query: query('facts', ['fact_id', 'employee_id', 'week', 'amount'], undefined, { page: { size: 2 } }),
      dependsOn: [] as const,
      delivery: 'on-demand' as const,
    };
    const paged = await evaluator.evaluate({ task: task([detail]), requestedOutputs: ['detail'] });
    expect(paged.ok).toBe(true);
    if (!paged.ok) throw new Error(paged.diagnostics[0]?.message);
    const partial = paged.value.get('detail')!;
    expect(partial.handle.snapshot().status).toBe('partial');
    expect(partial.descriptor?.coverage.kind).toBe('partial');
    paged.value.release();

    const cohortDependent = {
      id: 'trend',
      kind: 'query' as const,
      query: query('facts', ['fact_id', 'employee_id'], {
        kind: 'live-output',
        outputId: 'detail',
        identityKeys: ['employee_id'],
      }),
      dependsOn: ['detail'] as const,
      delivery: 'eager' as const,
    };
    const rejected = await evaluator.evaluate({ task: task([detail, cohortDependent]), requestedOutputs: ['trend'] });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('runtime.evaluation-incomplete');
  });

  it('releases evaluator ownership without disposing retained outputs and holds reuse leases until release', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const store = createResultStore({ maxEntries: 1 });
    const context = hostContext(service, store, () => undefined);
    const evaluator = createTaskEvaluator({ host: { readContext: () => ({ ok: true, value: context }) } });
    const first = await evaluator.evaluate({
      task: task([
        {
          id: 'first',
          kind: 'query',
          query: query('employees', ['employee_id', 'score']),
          dependsOn: [],
          delivery: 'eager',
        },
      ]),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.diagnostics[0]?.message);
    const firstHandle = first.value.get('first')!.handle;
    first.value.release();
    expect(firstHandle.snapshot().status).toBe('ready');

    const second = await evaluator.evaluate({
      task: task([
        {
          id: 'second',
          kind: 'query',
          query: query('employees', ['employee_id', 'score']),
          dependsOn: [],
          delivery: 'eager',
        },
      ]),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.diagnostics[0]?.message);
    second.value.release();

    const retained = await evaluator.evaluate({
      task: task([
        {
          id: 'retained',
          kind: 'query',
          query: query('employees', ['employee_id', 'score']),
          dependsOn: [],
          delivery: 'eager',
        },
      ]),
    });
    expect(retained.ok).toBe(true);
    if (!retained.ok) throw new Error(retained.diagnostics[0]?.message);
    const retainedHandle = retained.value.get('retained')!.handle;
    const externalLease = retainedHandle.retain();
    retained.value.release();
    expect(retainedHandle.snapshot().status).toBe('ready');
    expect(() =>
      store.begin({
        principalKey: 'principal-a',
        scopeDigest: 'scope-public',
        queryDigest: 'query-retained',
        catalogRevision: catalog.revision,
        functionRegistryDigest,
        sourceRevision: 'source-1',
        outputId: 'retained-next',
        taskId: 'retained-next',
        requestId: 'retained-next',
      }),
    ).toThrow(/capacity/u);
    externalLease.release();

    const reusedStore = createResultStore({ maxEntries: 1 });
    const reusedSeed = await materializeSeed(service, reusedStore, {
      outputId: 'reused-seed',
      query: query('employees', ['employee_id', 'score']),
    });
    reusedSeed.release();
    const reusedContext = hostContext(service, reusedStore, (ref) =>
      ref.id === reusedSeed.snapshot().descriptor?.ref.id ? reusedSeed : undefined,
    );
    const reused = await createTaskEvaluator({
      host: { readContext: () => ({ ok: true, value: reusedContext }) },
    }).evaluate({
      task: task([{ id: 'alias', kind: 'reuse', result: reusedSeed.snapshot().descriptor!.ref, dependsOn: [] }]),
    });
    expect(reused.ok).toBe(true);
    if (!reused.ok) throw new Error(reused.diagnostics[0]?.message);
    expect(() =>
      reusedStore.begin({
        principalKey: 'principal-a',
        scopeDigest: 'scope-public',
        queryDigest: 'query-new',
        catalogRevision: catalog.revision,
        functionRegistryDigest,
        sourceRevision: 'source-1',
        outputId: 'new',
        taskId: 'new',
        requestId: 'new',
      }),
    ).toThrow(/capacity/u);
    reused.value.release();
    reused.value.release();
    const replacement = reusedStore.begin({
      principalKey: 'principal-a',
      scopeDigest: 'scope-public',
      queryDigest: 'query-new',
      catalogRevision: catalog.revision,
      functionRegistryDigest,
      sourceRevision: 'source-1',
      outputId: 'new',
      taskId: 'new',
      requestId: 'new',
    });
    replacement.dispose();
  });

  it('uses core scalar identities for order-independent cohort digests', async () => {
    const source: ResultRef = {
      id: 'digest-result',
      revision: '1',
      sourceLineage: 'source-1',
      outputId: 'output',
      queryDigest: 'query',
      scopeDigest: 'scope-public',
    };
    const common = {
      source,
      identityKeys: ['value'],
      scopeDigest: 'scope-public',
      catalogRevision: catalog.revision,
      sourceRevision: 'source-1',
    };
    const signedZero = await cohortDigest({ ...common, types: [{ value: 'float', nullable: false }], tuples: [[-0]] });
    const positiveZero = await cohortDigest({ ...common, types: [{ value: 'float', nullable: false }], tuples: [[0]] });
    expect(signedZero).toEqual(positiveZero);
    const instantType = { value: 'instant' as const, nullable: false };
    const utc = await cohortDigest({ ...common, types: [instantType], tuples: [['2026-01-01T00:00:00Z']] });
    const offset = await cohortDigest({ ...common, types: [instantType], tuples: [['2025-12-31T19:00:00-05:00']] });
    expect(utc).toEqual(offset);
  });

  it('rejects partial or revoked cohort sources and independent grant loss before publication', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const store = createResultStore();
    const seed = await materializeSeed(service, store, {
      outputId: 'ranking-seed',
      query: query('employees', ['employee_id', 'score']),
    });
    const resolver = createResultCohortResolver();
    const base = hostContext(
      service,
      store,
      (ref) => (ref.id === seed.snapshot().descriptor?.ref.id ? seed : undefined),
      resolver,
    );
    const partial = seed.snapshot().descriptor!.ref;
    const crossPrincipal = { ...base, principalKey: 'principal-b', resolveResult: () => seed };
    const reused = await createTaskEvaluator({
      host: { readContext: () => ({ ok: true, value: crossPrincipal }) },
    }).evaluate({ task: task([{ id: 'reuse', kind: 'reuse', result: partial, dependsOn: [] }]) });
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.diagnostics[0]?.code).toBe('runtime.evaluation-denied');
    seed.dispose();
    const denied = await resolver.resolve(
      {
        source: partial,
        identityKeys: ['employee_id'],
        scopeDigest: base.scopeDigest,
        catalogRevision: base.catalogRevision,
        deadlineAt: Date.now() + 5_000,
      },
      resolverContext(base, () => seed),
    );
    expect(denied.ok).toBe(false);
    const fixedTask = task([
      {
        id: 'trend',
        kind: 'query',
        query: query('facts', ['fact_id', 'employee_id'], {
          kind: 'fixed',
          source: partial,
          identityKeys: ['employee_id'],
          cohortDigest: 'cohort-untrusted',
        }),
        dependsOn: [],
        delivery: 'eager',
      },
    ]);
    let reads = 0;
    const revokedContext: TrustedEvaluationContext = { ...base, resolveResult: () => seed };
    const evaluator = createTaskEvaluator({
      host: {
        readContext: () => {
          reads++;
          return reads === 1
            ? { ok: true, value: revokedContext }
            : { ok: false, diagnostics: [{ code: 'runtime.evaluation-denied', message: 'revoked', retryable: false }] };
        },
      },
    });
    const rejected = await evaluator.evaluate({ task: fixedTask });
    expect(rejected.ok).toBe(false);
    expect(reads).toBeGreaterThanOrEqual(1);
    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancellationEvaluator = createTaskEvaluator({ host: { readContext: () => ({ ok: true, value: base }) } });
    const cancelled = await cancellationEvaluator.evaluate({ task: fixedTask, signal: cancelledController.signal });
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.diagnostics[0]?.code).toBe('runtime.evaluation-cancelled');
  });

  it('accepts the original fixed population through direct LocalDataService and HTTP ADC', async () => {
    const sourceStore = createResultStore();
    const sourceService = createLocalDataService({ snapshot: snapshot() });
    const ranked = await materializeSeed(sourceService, sourceStore, {
      outputId: 'ranked-top-k',
      query: query('employees', ['employee_id', 'score'], undefined, {
        order: [{ field: 'score', direction: 'desc', nulls: 'last' }],
        topK: 2,
      }),
    });
    expect(rows(ranked).map((row) => row.employee_id)).toEqual(['e1', 'e2']);
    expect(ranked.snapshot().descriptor?.coverage).toMatchObject({ kind: 'complete' });
    const paged = await materializeSeed(sourceService, sourceStore, {
      outputId: 'ranked-page',
      allowPartial: true,
      query: query('employees', ['employee_id', 'score'], undefined, {
        order: [{ field: 'score', direction: 'desc', nulls: 'last' }],
        page: { size: 2 },
      }),
    });
    expect(rows(paged).map((row) => row.employee_id)).toEqual(['e1', 'e2']);
    expect(paged.snapshot().descriptor?.coverage).toMatchObject({ kind: 'partial' });
    const source = await materializeSeed(sourceService, sourceStore, {
      outputId: 'ranking-seed',
      query: query('employees', ['employee_id', 'score']),
    });
    const sourceRef = source.snapshot().descriptor!.ref;
    const resolver = createResultCohortResolver();
    const sourceResolver = (ref: ResultRef): ResultHandle | undefined =>
      ref.id === sourceRef.id && ref.revision === sourceRef.revision ? source : undefined;
    const sourceContext = () => ({ resultStore: sourceStore, resolveResult: sourceResolver });
    const targetService = createLocalDataService({
      snapshot: snapshot(),
      cohortResolver: resolver,
      cohortContext: sourceContext,
    });
    const membership = await resolver.resolve(
      {
        source: sourceRef,
        identityKeys: ['employee_id'],
        scopeDigest: 'scope-public',
        catalogRevision: catalog.revision,
        sourceRevision: sourceRef.revision,
        deadlineAt: Date.now() + 5_000,
      },
      {
        readContext: {},
        principalKey: 'principal-a',
        scopeDigest: 'scope-public',
        catalogRevision: catalog.revision,
        functionRegistryDigest,
        grants: ['result.inspect'],
        catalog,
        resultStore: sourceStore,
        resolveResult: sourceResolver,
        now: () => Date.now(),
      },
    );
    if (!membership.ok) throw new Error(membership.diagnostics[0]?.message ?? 'membership failed');
    const bounded = await createResultCohortResolver({ maxTuples: 2 }).resolve(
      {
        source: sourceRef,
        identityKeys: ['employee_id'],
        scopeDigest: 'scope-public',
        catalogRevision: catalog.revision,
        sourceRevision: sourceRef.revision,
        deadlineAt: Date.now() + 5_000,
      },
      {
        readContext: {},
        principalKey: 'principal-a',
        scopeDigest: 'scope-public',
        catalogRevision: catalog.revision,
        functionRegistryDigest,
        grants: ['result.inspect'],
        catalog,
        resultStore: sourceStore,
        resolveResult: sourceResolver,
        now: () => Date.now(),
      },
    );
    expect(bounded.ok).toBe(false);
    if (!bounded.ok) expect(bounded.diagnostics[0]?.code).toBe('runtime.evaluation-budget');
    const fixedQuery = query('facts', ['fact_id', 'employee_id', 'week', 'amount'], {
      kind: 'fixed',
      source: sourceRef,
      identityKeys: ['employee_id'],
      cohortDigest: membership.value.tupleDigest,
    });
    const planRequest = {
      version: '1' as const,
      requestId: 'direct-fixed',
      catalogRevision: catalog.revision,
      target: { taskId: 'direct-fixed', outputId: 'trend' },
      query: fixedQuery,
      budget,
    };
    const directContext = { principal: 'principal-a' };
    const directPlan = await targetService.plan(planRequest, directContext);
    expect(directPlan.ok).toBe(true);
    if (!directPlan.ok) throw new Error(directPlan.diagnostics[0]?.message);
    expect(directPlan.value.query.population).toEqual(fixedQuery.population);
    expect(directPlan.value.populationDigest).toBe(membership.value.tupleDigest);
    const directEvents = await collect(targetService.execute(directPlan.value, directContext));
    const directDescriptor = directEvents.find(
      (event): event is Extract<ResultEvent, { readonly kind: 'descriptor' }> => event.kind === 'descriptor',
    );
    expect(directDescriptor?.descriptor.ref.queryDigest).toBe(directPlan.value.queryDigest);
    expect(directDescriptor?.descriptor.lineage).toEqual([{ output: 'trend', inputs: [sourceRef] }]);
    expect(directDescriptor?.descriptor.coverage).toEqual({
      kind: 'complete',
      populationDigest: membership.value.tupleDigest,
    });
    const handler = createDataHttpHandler({
      service: targetService,
      authenticate: () => ({ ok: true, value: { principal: 'principal-a' } }),
    });
    const http = createHttpDataService({
      baseUrl: 'https://aeliqo.test',
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const httpPlan = await http.plan(planRequest);
    expect(httpPlan.ok).toBe(true);
    if (!httpPlan.ok) throw new Error(httpPlan.diagnostics[0]?.message);
    expect(httpPlan.value.query.population).toEqual(fixedQuery.population);
    const httpEvents = await collect(http.execute(httpPlan.value));
    const httpDescriptor = httpEvents.find(
      (event): event is Extract<ResultEvent, { readonly kind: 'descriptor' }> => event.kind === 'descriptor',
    );
    expect(httpDescriptor?.descriptor.ref.queryDigest).toBe(httpPlan.value.queryDigest);
    expect(httpDescriptor?.descriptor.lineage).toEqual([{ output: 'trend', inputs: [sourceRef] }]);
  });
});
