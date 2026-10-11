import { parseQuery } from '@varendo/core';
import type { Outcome } from '@varendo/core';
import { lowerQuerySpec } from '@varendo/core/query';
import type { LogicalPlan, QueryPlanner } from '@varendo/core/query';
import { parsePlanRequest } from '../schema.js';
import type { AcceptedQuery, PlanAcceptance, PlanRequest, QueryBudget, ReadContext, ReadGrant } from '../types.js';
import { resolvePopulation } from './cohort.js';
import type { ResolvedPopulation } from './cohort.js';
import { authorizeWithDeadline, digestWithDeadline } from './authorization.js';
import { DEFAULT_BUDGET, minBudget } from './budget.js';
import { isSnapshotCursor, resolveCursor } from './cursor.js';
import type { CursorValue } from './cursor.js';
import type { LocalDataServiceState, StoredPlan } from './service-state.js';
import { reapExpiredPlans } from './service-state.js';
import {
  checkPlanDependencies,
  dependenciesForPlan,
  plannerFailure,
  queryPlanner,
  scanEntityIds,
  supportedOperations,
} from './query-planning.js';
import type { PlanDependencies } from './query-planning.js';
import { queryWithoutPage, normalizedQuery, validateQuery } from './query-validation.js';
import { canonical, failure, freezeDeep, policyContext } from './shared.js';

interface PreparedPlan {
  readonly input: PlanRequest;
  readonly context: ReadContext;
  readonly grant: ReadGrant;
  readonly budget: QueryBudget;
  readonly startedAt: number;
  readonly workNow: () => number;
  readonly initialCatalog: LocalDataServiceState['currentCatalog'];
  readonly initialSnapshot: LocalDataServiceState['snapshot'];
}

interface CompiledPlan {
  readonly planner: QueryPlanner;
  readonly logical: LogicalPlan;
  readonly dependencies: PlanDependencies;
  readonly population: ResolvedPopulation;
}

interface PlanDigests {
  readonly queryDigest: string;
  readonly populationDigest: string;
  readonly lineageDigest: string;
  readonly cursorOffset?: number;
}

export async function planLocalData(
  state: LocalDataServiceState,
  request: unknown,
  context: ReadContext = {},
): Promise<Outcome<PlanAcceptance>> {
  const prepared = await preparePlan(state, request, context, state.workNow());
  if (!prepared.ok) return prepared;
  const compiled = await compilePlan(state, prepared.value, context);
  if (!compiled.ok) return compiled;
  const digests = await computePlanDigests(state, prepared.value, compiled.value);
  if (!digests.ok) return digests;
  if (!isCurrentPlan(state, prepared.value))
    return failure('data.stale-plan', 'The catalog or source changed while plan identities were being computed.');
  return storeAcceptedPlan(state, prepared.value, compiled.value, digests.value);
}

async function preparePlan(
  state: LocalDataServiceState,
  request: unknown,
  context: ReadContext,
  startedAt: number,
): Promise<Outcome<PreparedPlan>> {
  const initialCatalog = state.currentCatalog;
  const initialSnapshot = state.snapshot;
  const parsed = parsePlanRequest(request);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (input.catalogRevision !== state.currentCatalog.revision)
    return failure('data.stale-catalog', 'The plan must pin the current catalog revision.', ['catalogRevision']);
  const grant = await authorizeWithDeadline(
    state.options.authorize,
    'plan',
    input.requestId,
    input.target,
    policyContext(context),
    Math.min(input.budget.maxMilliseconds, state.options.hostBudget?.maxMilliseconds ?? DEFAULT_BUDGET.maxMilliseconds),
    input.query,
  );
  if (!grant.ok) return grant;
  const authorization = validatePlanningAuthorization(
    state,
    input.query,
    grant.value,
    context,
    initialCatalog,
    initialSnapshot,
  );
  if (!authorization.ok) return authorization;
  const budget = boundedPlanBudget(input.budget, state, input.query, grant.value);
  if (budget.maxMessages < 3 || budget.maxRows < 1)
    return failure('data.budget', 'The effective budget cannot carry a bounded result.', ['budget']);
  if (exceededTimeBudget(startedAt, budget, state.workNow))
    return failure('data.budget', 'Planning exceeded the effective time budget.', ['budget']);
  return {
    ok: true,
    value: {
      input,
      context,
      grant: grant.value,
      budget,
      startedAt,
      workNow: state.workNow,
      initialCatalog,
      initialSnapshot,
    },
  };
}

function validatePlanningAuthorization(
  state: LocalDataServiceState,
  query: PlanRequest['query'],
  grant: ReadGrant,
  context: ReadContext,
  initialCatalog: LocalDataServiceState['currentCatalog'],
  initialSnapshot: LocalDataServiceState['snapshot'],
): Outcome<void> {
  if (context.signal?.aborted) return failure('data.aborted', 'The data service plan was cancelled.');
  if (!isCurrentPlan(state, { initialCatalog, initialSnapshot }))
    return failure('data.stale-plan', 'The catalog or source changed while authorization was being resolved.');
  if (grant.rowPolicy !== undefined && grant.policyRevision === undefined)
    return failure('data.authorization', 'A row policy must declare a policy revision before a plan can be accepted.');
  return validateQuery(query, state.currentCatalog, grant, fixedCohortSupported(state, context));
}

function fixedCohortSupported(state: LocalDataServiceState, context: ReadContext): boolean {
  return (
    context.cohort !== undefined ||
    (state.options.cohortResolver !== undefined && state.options.cohortContext !== undefined)
  );
}

function boundedPlanBudget(
  requested: QueryBudget,
  state: LocalDataServiceState,
  query: PlanRequest['query'],
  grant: ReadGrant,
): QueryBudget {
  const effective = minBudget(requested, state.options.hostBudget ?? DEFAULT_BUDGET, grant.maxBudget);
  const capability = state.currentCatalog.capabilities.find((candidate) => candidate.entity === query.entity);
  if (capability === undefined) return effective;
  return Object.freeze({ ...effective, maxRows: Math.min(effective.maxRows, capability.maxOutputRows) });
}

function exceededTimeBudget(startedAt: number, budget: QueryBudget, now: () => number): boolean {
  return now() - startedAt > budget.maxMilliseconds;
}

function isCurrentPlan(
  state: LocalDataServiceState,
  prepared: Pick<PreparedPlan, 'initialCatalog' | 'initialSnapshot'>,
): boolean {
  return state.currentCatalog === prepared.initialCatalog && state.snapshot === prepared.initialSnapshot;
}

async function compilePlan(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  context: ReadContext,
): Promise<Outcome<CompiledPlan>> {
  const population = await resolvePopulation(
    state,
    prepared.input.query,
    prepared.grant,
    context,
    prepared.budget,
    prepared.startedAt,
  );
  if (!population.ok) return population;
  const plannerOutcome = queryPlanner(state.options, state.currentCatalog, state.sourceLimits);
  if (!plannerOutcome.ok) return plannerOutcome;
  const lowered = lowerQuerySpec(
    queryWithoutPage(population.value.query),
    state.currentCatalog,
    plannerOutcome.value.registry,
    state.currentCatalog.meanings,
  );
  if (!lowered.ok) return plannerFailure(lowered);
  const relational = attachPlanPins(lowered.value, prepared.grant, state);
  const logicalOutcome = plannerOutcome.value.plan(relational);
  if (!logicalOutcome.ok) return plannerFailure(logicalOutcome);
  const dependencies = dependenciesForPlan(logicalOutcome.value, state.currentCatalog);
  const access = checkPlanDependencies(dependencies, prepared.grant);
  if (!access.ok) return access;
  const outputBudget = validatePlanOutput(logicalOutcome.value, prepared.budget);
  if (!outputBudget.ok) return outputBudget;
  if (!isCurrentPlan(state, prepared))
    return failure('data.stale-plan', 'The catalog or source changed while the logical plan was being built.');
  return {
    ok: true,
    value: { planner: plannerOutcome.value, logical: logicalOutcome.value, dependencies, population: population.value },
  };
}

function attachPlanPins(
  logical: ReturnType<typeof lowerQuerySpec> extends Outcome<infer T> ? T : never,
  grant: ReadGrant,
  state: LocalDataServiceState,
) {
  return {
    ...logical,
    pins: {
      ...logical.pins,
      sourceRevision: state.snapshot.sourceRevision,
      scopeDigest: grant.scopeDigest,
      ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
    },
  };
}

function validatePlanOutput(logical: LogicalPlan, budget: QueryBudget): Outcome<void> {
  if (logical.output.fields.length <= budget.maxColumns) return { ok: true, value: undefined };
  return failure('data.budget', 'The query output exceeds the effective column budget.', ['budget', 'maxColumns']);
}

async function computePlanDigests(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  compiled: CompiledPlan,
): Promise<Outcome<PlanDigests>> {
  const parsedQuery = parseQuery(normalizedQuery(prepared.input.query));
  if (!parsedQuery.ok) return parsedQuery;
  const querySerialized = canonical(parsedQuery.value);
  const queryDigest = await digestWithDeadline(
    querySerialized,
    'query',
    preparedContext(prepared),
    remainingBudget(prepared),
  );
  if (!queryDigest.ok) return queryDigest;
  const cursorCheck = validateQueryCursor(state, prepared, queryDigest.value);
  if (!cursorCheck.ok) return cursorCheck;
  const populationDigest = await computePopulationDigest(state, prepared, compiled, queryDigest.value);
  if (!populationDigest.ok) return populationDigest;
  const lineageDigest = await digestWithDeadline(
    { output: prepared.input.target.outputId, inputs: compiled.population.lineage },
    'lineage',
    preparedContext(prepared),
    remainingBudget(prepared),
  );
  if (!lineageDigest.ok) return lineageDigest;
  return {
    ok: true,
    value: {
      queryDigest: queryDigest.value,
      populationDigest: populationDigest.value,
      lineageDigest: lineageDigest.value,
      ...(cursorCheck.value === undefined ? {} : { cursorOffset: cursorCheck.value }),
    },
  };
}

function preparedContext(prepared: PreparedPlan): ReadContext {
  return prepared.context;
}

function remainingBudget(prepared: PreparedPlan): number {
  return prepared.budget.maxMilliseconds - (prepared.workNow() - prepared.startedAt);
}

function validateQueryCursor(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  queryDigest: string,
): Outcome<number | undefined> {
  const cursorValue = prepared.input.query.page?.cursor;
  if (cursorValue === undefined) return { ok: true, value: undefined };
  const partition = prepared.grant.cursorPartition ?? prepared.grant.scopeDigest;
  const cursor = resolveCursor(cursorValue, partition, state.cursorStore, state.now());
  if (queryCursorPinsMatch(state, prepared, queryDigest, cursor)) return { ok: true, value: cursor.offset };
  return failure(
    'data.stale-cursor',
    'The query cursor does not belong to this query, scope, target or source revision.',
    ['query', 'page', 'cursor'],
  );
}

function queryCursorPinsMatch(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  queryDigest: string,
  cursor: CursorValue | undefined,
): cursor is CursorValue {
  if (!isSnapshotCursor(cursor, 'data')) return false;
  if (cursor.queryDigest !== queryDigest) return false;
  if (!queryCursorScopeSourceMatch(cursor, prepared, state)) return false;
  if (cursor.orderDigest !== canonical(prepared.input.query.order)) return false;
  if (!queryCursorTargetMatch(cursor, prepared, state)) return false;
  if (cursor.expiresAt === undefined || cursor.expiresAt <= state.now()) return false;
  return true;
}

function queryCursorScopeSourceMatch(
  cursor: CursorValue,
  prepared: PreparedPlan,
  state: LocalDataServiceState,
): boolean {
  if (cursor.scopeDigest !== prepared.grant.scopeDigest) return false;
  if (cursor.policyRevision !== prepared.grant.policyRevision) return false;
  if (cursor.sourceRevision !== state.snapshot.sourceRevision) return false;
  if (cursor.sourceLineage !== state.snapshot.sourceRevision) return false;
  return cursor.snapshotId === state.snapshot.sourceRevision;
}

function queryCursorTargetMatch(cursor: CursorValue, prepared: PreparedPlan, state: LocalDataServiceState): boolean {
  if (cursor.catalogRevision !== state.currentCatalog.revision) return false;
  return cursor.target === canonical(prepared.input.target);
}

async function computePopulationDigest(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  compiled: CompiledPlan,
  queryDigest: string,
): Promise<Outcome<string>> {
  const membership = compiled.population.membership;
  if (membership !== undefined) return { ok: true, value: membership.tupleDigest };
  return digestWithDeadline(
    {
      queryDigest,
      planKey: compiled.logical.planKey,
      scopeDigest: prepared.grant.scopeDigest,
      sourceRevision: state.snapshot.sourceRevision,
      catalogRevision: state.currentCatalog.revision,
      ...(prepared.grant.policyRevision === undefined ? {} : { policyRevision: prepared.grant.policyRevision }),
    },
    'population',
    preparedContext(prepared),
    remainingBudget(prepared),
  );
}

async function storeAcceptedPlan(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  compiled: CompiledPlan,
  digests: PlanDigests,
): Promise<Outcome<PlanAcceptance>> {
  const expiresAt = state.now() + state.planTtlMs;
  const acceptedBase = acceptedPlanBase(state, prepared, compiled, digests, expiresAt);
  const planDigest = await digestWithDeadline(
    {
      accepted: acceptedBase,
      planKey: compiled.logical.planKey,
      cursorPartition: prepared.grant.cursorPartition ?? prepared.grant.scopeDigest,
    },
    'plan',
    prepared.context,
    remainingBudget(prepared),
  );
  if (!planDigest.ok) return planDigest;
  if (!isCurrentPlan(state, prepared))
    return failure('data.stale-plan', 'The catalog or source changed while plan identities were being computed.');
  const accepted: PlanAcceptance = {
    ...acceptedBase,
    kind: 'accepted',
    planDigest: planDigest.value,
    supported: supportedOperations(compiled.logical, prepared.input.query),
  };
  const frozen = freezeDeep(accepted);
  reapExpiredPlans(state, state.now());
  state.plans.set(
    planDigest.value,
    storedPlan(prepared, compiled, frozen, state.now() + state.cursorTtlMs, digests.cursorOffset),
  );
  return { ok: true, value: frozen };
}

function acceptedPlanBase(
  state: LocalDataServiceState,
  prepared: PreparedPlan,
  compiled: CompiledPlan,
  digests: PlanDigests,
  expiresAt: number,
): AcceptedQuery {
  return {
    version: '1',
    requestId: prepared.input.requestId,
    target: prepared.input.target,
    catalogRevision: state.currentCatalog.revision,
    sourceRevision: state.snapshot.sourceRevision,
    sourceLineage: state.snapshot.sourceRevision,
    scopeDigest: prepared.grant.scopeDigest,
    queryDigest: digests.queryDigest,
    populationDigest: digests.populationDigest,
    lineageDigest: digests.lineageDigest,
    resultShape: resultShape(compiled.logical),
    planDigest: '',
    expiresAt,
    functionRegistryDigest: compiled.planner.registry.digest,
    ...(prepared.grant.policyRevision === undefined ? {} : { policyRevision: prepared.grant.policyRevision }),
    query: prepared.input.query,
    effectiveBudget: prepared.budget,
  };
}

function resultShape(logical: LogicalPlan): 'rows' | 'global-aggregate' {
  if (
    logical.nodes.some((node) => node.op === 'aggregate') &&
    logical.output.identity.length === 0 &&
    logical.output.grain.length === 0
  )
    return 'global-aggregate';
  return 'rows';
}

function storedPlan(
  prepared: PreparedPlan,
  compiled: CompiledPlan,
  accepted: PlanAcceptance,
  cursorExpiresAt: number,
  cursorOffset: number | undefined,
): StoredPlan {
  return {
    accepted,
    cursorExpiresAt,
    cursorPartition: prepared.grant.cursorPartition ?? prepared.grant.scopeDigest,
    ...(cursorOffset === undefined ? {} : { cursorOffset }),
    logical: compiled.logical,
    dependencies: compiled.dependencies,
    scanEntities: scanEntityIds(compiled.logical),
    ...(prepared.grant.policyRevision === undefined ? {} : { policyRevision: prepared.grant.policyRevision }),
    lineage:
      compiled.population.membership === undefined
        ? []
        : [{ output: prepared.input.target.outputId, inputs: compiled.population.lineage }],
  };
}
