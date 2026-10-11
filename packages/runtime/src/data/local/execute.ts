import type { Outcome } from '@varendo/core';
import type { QueryPlanner, QueryResult, QuerySource } from '@varendo/core/query';
import type { AcceptedQuery, QueryBudget, ReadContext, ReadGrant } from '../types.js';
import type { ResultEvent as DataResultEvent } from '../types.js';
import { parseAcceptedQuery } from '../schema.js';
import { authorizeWithDeadline, digestWithDeadline } from './authorization.js';
import { authorizedSource } from './authorized-source.js';
import { DEFAULT_BUDGET, minBudget } from './budget.js';
import { resolvePopulation } from './cohort.js';
import { buildResultEvents } from './result-stream.js';
import type { LocalDataServiceState, StoredPlan } from './service-state.js';
import { checkPlanDependencies, queryPlanner } from './query-planning.js';
import { validateQuery } from './query-validation.js';
import { resultError, resultReference, sameAccepted } from './result.js';
import { failure, policyContext } from './shared.js';

interface ExecutionHandle {
  readonly input: AcceptedQuery;
  readonly stored: StoredPlan;
  readonly startedAt: number;
  readonly initialCatalog: LocalDataServiceState['currentCatalog'];
  readonly initialSnapshot: LocalDataServiceState['snapshot'];
}

interface AuthorizedExecution {
  readonly grant: ReadGrant;
  readonly budget: QueryBudget;
}

interface PreparedExecution extends AuthorizedExecution {
  readonly handle: ExecutionHandle;
  readonly planner: QueryPlanner;
  readonly source: QuerySource;
  readonly ref: NonNullable<ReturnType<typeof resultReference>>;
}

type ExecutionLoad =
  { readonly ok: true; readonly value: ExecutionHandle } | { readonly ok: false; readonly error: DataResultEvent };
type FailedOutcome<T> = Extract<Outcome<T>, { readonly ok: false }>;

export async function* executeLocalData(
  state: LocalDataServiceState,
  request: unknown,
  context: ReadContext = {},
): AsyncGenerator<DataResultEvent> {
  const loaded = loadExecutionHandle(state, request, state.now(), state.workNow());
  if (!loaded.ok) {
    yield loaded.error;
    return;
  }
  const prepared = await prepareExecution(state, loaded.value, context);
  if (!prepared.ok) {
    yield outcomeError(loaded.value.input.requestId, prepared, 'data.denied', 'The execution could not be prepared.');
    return;
  }
  const result = evaluateExecution(state, prepared.value, context);
  if (!result.ok) {
    yield result.error;
    return;
  }
  const events = buildResultEvents({
    result: result.value,
    accepted: prepared.value.handle.input,
    stored: prepared.value.handle.stored,
    ref: prepared.value.ref,
    budget: prepared.value.budget,
    startedAt: prepared.value.handle.startedAt,
    context,
    grant: prepared.value.grant,
    cursorExpiresAt: prepared.value.handle.stored.cursorExpiresAt,
    now: state.workNow,
    cursorNow: state.now(),
    cursorStore: state.cursorStore,
    maxCursorEntries: state.maxCursors,
  });
  if (!events.ok) {
    yield outcomeError(
      loaded.value.input.requestId,
      events,
      'data.budget',
      'The result response could not be bounded.',
    );
    return;
  }
  yield* emitEvents(state, events.value, loaded.value.input.requestId, context, prepared.value);
}

function loadExecutionHandle(
  state: LocalDataServiceState,
  request: unknown,
  currentTime: number,
  startedAt: number,
): ExecutionLoad {
  const fallbackRequestId = requestIdFromUnknown(request);
  const parsed = parseAcceptedQuery(request);
  if (!parsed.ok)
    return {
      ok: false,
      error: resultError(fallbackRequestId, 'data.accepted-query', 'The accepted plan handle is invalid.'),
    };
  const input = parsed.value;
  const stored = state.plans.get(input.planDigest);
  const planError = acceptedPlanError(stored, input, currentTime);
  if (planError !== undefined)
    return { ok: false, error: resultError(input.requestId, planError.code, planError.message) };
  const currentPlanError = currentPlanErrorMessage(state, stored!);
  if (currentPlanError !== undefined)
    return { ok: false, error: resultError(input.requestId, 'data.stale-plan', currentPlanError) };
  return {
    ok: true,
    value: {
      input,
      stored: stored!,
      startedAt,
      initialCatalog: state.currentCatalog,
      initialSnapshot: state.snapshot,
    },
  };
}

function requestIdFromUnknown(request: unknown): string {
  if (request === null || typeof request !== 'object' || !('requestId' in request)) return 'execute';
  return typeof request.requestId === 'string' ? request.requestId : 'execute';
}

function acceptedPlanError(
  stored: StoredPlan | undefined,
  input: AcceptedQuery,
  now: number,
): { readonly code: string; readonly message: string } | undefined {
  if (stored === undefined) return unknownPlanError();
  if (now >= stored.accepted.expiresAt) return expiredPlanError();
  if (!sameAccepted(stored.accepted, input)) return unknownPlanError();
  return undefined;
}

function unknownPlanError(): { readonly code: string; readonly message: string } {
  return { code: 'data.stale-plan', message: 'The accepted plan handle is unknown, changed or expired.' };
}

function expiredPlanError(): { readonly code: string; readonly message: string } {
  return { code: 'data.expired-plan', message: 'The accepted plan handle has expired.' };
}

function currentPlanErrorMessage(state: LocalDataServiceState, stored: StoredPlan): string | undefined {
  const registryDigest = state.currentCatalog.functionRegistryDigest;
  if (
    stored.accepted.functionRegistryDigest !== registryDigest ||
    stored.logical.pins.functionRegistryDigest !== registryDigest
  )
    return 'The accepted plan is pinned to a different function registry digest.';
  if (
    state.snapshot.sourceRevision !== stored.accepted.sourceRevision ||
    state.currentCatalog.revision !== stored.accepted.catalogRevision
  )
    return 'The accepted plan is stale for the current catalog or source revision.';
  return undefined;
}

async function prepareExecution(
  state: LocalDataServiceState,
  handle: ExecutionHandle,
  context: ReadContext,
): Promise<Outcome<PreparedExecution>> {
  const authorized = await authorizeExecution(state, handle, context);
  if (!authorized.ok) return authorized;
  const source = await prepareAuthorizedSource(state, handle, authorized.value, context);
  if (!source.ok) return source;
  return {
    ok: true,
    value: {
      handle,
      grant: authorized.value.grant,
      budget: authorized.value.budget,
      planner: source.value.planner,
      source: source.value.source,
      ref: source.value.ref,
    },
  };
}

async function authorizeExecution(
  state: LocalDataServiceState,
  handle: ExecutionHandle,
  context: ReadContext,
): Promise<Outcome<AuthorizedExecution>> {
  const remaining = handle.input.effectiveBudget.maxMilliseconds - (state.workNow() - handle.startedAt);
  const grant = await authorizeWithDeadline(
    state.options.authorize,
    'execute',
    handle.input.requestId,
    handle.input.target,
    policyContext(context),
    remaining,
    handle.input.query,
  );
  if (!isCurrentHandle(state, handle))
    return failure('data.stale-plan', 'The catalog or source changed while authorization was being resolved.');
  if (!grant.ok) return grant;
  if (context.signal?.aborted) return failure('data.aborted', 'The result execution was cancelled.');
  const access = validateExecutionGrant(state, handle, grant.value, context);
  if (!access.ok) return access;
  const budget = minBudget(
    handle.stored.accepted.effectiveBudget,
    state.options.hostBudget ?? DEFAULT_BUDGET,
    grant.value.maxBudget,
  );
  if (budget.maxColumns < handle.stored.logical.output.fields.length)
    return failure('data.budget', 'The current authorization has a tighter projection budget.');
  if (state.workNow() - handle.startedAt > budget.maxMilliseconds)
    return failure('data.budget', 'Execution exceeded the effective time budget before reading rows.');
  return { ok: true, value: { grant: grant.value, budget } };
}

function validateExecutionGrant(
  state: LocalDataServiceState,
  handle: ExecutionHandle,
  grant: ReadGrant,
  context: ReadContext,
): Outcome<void> {
  const queryAccess = validateQuery(
    handle.input.query,
    state.currentCatalog,
    grant,
    fixedCohortSupported(state, context),
  );
  if (!queryAccess.ok) return queryAccess;
  const dependencies = checkPlanDependencies(handle.stored.dependencies, grant);
  if (!dependencies.ok) return dependencies;
  if (
    grant.scopeDigest !== handle.stored.accepted.scopeDigest ||
    grant.policyRevision !== handle.stored.accepted.policyRevision
  )
    return failure('data.denied', 'The execution authorization scope or policy revision changed.');
  if ((grant.cursorPartition ?? grant.scopeDigest) !== handle.stored.cursorPartition)
    return failure('data.denied', 'The execution authorization cursor partition changed.');
  return { ok: true, value: undefined };
}

function fixedCohortSupported(state: LocalDataServiceState, context: ReadContext): boolean {
  return (
    context.cohort !== undefined ||
    (state.options.cohortResolver !== undefined && state.options.cohortContext !== undefined)
  );
}

function isCurrentHandle(state: LocalDataServiceState, handle: ExecutionHandle): boolean {
  return state.currentCatalog === handle.initialCatalog && state.snapshot === handle.initialSnapshot;
}

interface PreparedSource {
  readonly planner: QueryPlanner;
  readonly source: QuerySource;
  readonly ref: ReturnType<typeof resultReference>;
}

async function prepareAuthorizedSource(
  state: LocalDataServiceState,
  handle: ExecutionHandle,
  authorized: AuthorizedExecution,
  context: ReadContext,
): Promise<Outcome<PreparedSource>> {
  const input = handle.input;
  const population = await resolvePopulation(
    state,
    input.query,
    authorized.grant,
    context,
    authorized.budget,
    handle.startedAt,
  );
  if (!population.ok) return population;
  if (
    population.value.membership !== undefined &&
    population.value.membership.tupleDigest !== handle.stored.accepted.populationDigest
  )
    return failure('data.stale-cohort', 'The fixed population changed after planning.');
  const plannerOutcome = queryPlanner(state.options, state.currentCatalog, state.sourceLimits);
  if (!plannerOutcome.ok) return plannerOutcome;
  const planner = plannerOutcome.value;
  const resultId = await digestWithDeadline(
    { planDigest: handle.stored.accepted.planDigest, requestId: input.requestId },
    'result',
    context,
    authorized.budget.maxMilliseconds - (state.workNow() - handle.startedAt),
  );
  if (!resultId.ok) return resultId;
  if (!isCurrentHandle(state, handle))
    return failure('data.stale-plan', 'The catalog or source changed while the result identity was being computed.');
  const ref = resultReference(handle.stored.accepted, resultId.value);
  const source = await authorizedSource(
    handle.stored,
    state.snapshot,
    authorized.grant,
    input.query,
    policyContext(context),
    handle.startedAt,
    authorized.budget,
    state.workNow,
    () => isCurrentHandle(state, handle),
  );
  if (!source.ok) return source;
  return { ok: true, value: { planner, source: source.value, ref } };
}

type EvaluatedResult =
  { readonly ok: true; readonly value: QueryResult } | { readonly ok: false; readonly error: DataResultEvent };

function evaluateExecution(
  state: LocalDataServiceState,
  execution: PreparedExecution,
  context: ReadContext,
): EvaluatedResult {
  const { handle, planner, source, grant, budget } = execution;
  const clock = state.workNow;
  const evaluated = planner.evaluate(handle.stored.logical, source, {
    cancellation: { aborted: context.signal?.aborted === true },
    clock,
    maxMilliseconds: Math.max(1, budget.maxMilliseconds - (state.workNow() - handle.startedAt)),
    maxRows: planner.limits.maxRows,
    maxBytes: planner.limits.maxBytes,
    maxOperations: planner.limits.maxOperations,
    catalogRevision: state.currentCatalog.revision,
    scopeDigest: grant.scopeDigest,
    ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
  });
  if (evaluated.ok) return evaluated;
  const first = evaluated.diagnostics[0];
  const code = first?.code === 'query.budget' ? 'data.budget' : 'data.unsupported';
  return {
    ok: false,
    error: resultError(handle.input.requestId, code, first?.message ?? 'The query could not be evaluated.'),
  };
}

function outcomeError<T>(
  requestId: string,
  outcome: FailedOutcome<T>,
  fallbackCode: string,
  fallbackMessage: string,
): DataResultEvent {
  const first = outcome.diagnostics[0];
  return resultError(requestId, first?.code ?? fallbackCode, first?.message ?? fallbackMessage);
}

async function* emitEvents(
  state: LocalDataServiceState,
  events: readonly DataResultEvent[],
  requestId: string,
  context: ReadContext,
  execution: PreparedExecution,
): AsyncGenerator<DataResultEvent> {
  for (const event of events) {
    const error = emissionError(state, requestId, context, execution);
    if (error !== undefined) {
      yield error;
      return;
    }
    yield event;
  }
}

function emissionError(
  state: LocalDataServiceState,
  requestId: string,
  context: ReadContext,
  execution: PreparedExecution,
): DataResultEvent | undefined {
  if (context.signal?.aborted) return resultError(requestId, 'data.aborted', 'The result execution was cancelled.');
  if (!isCurrentHandle(state, execution.handle))
    return resultError(requestId, 'data.stale-plan', 'The catalog or source changed while emitting the response.');
  if (state.workNow() - execution.handle.startedAt > execution.budget.maxMilliseconds)
    return resultError(
      requestId,
      'data.budget',
      'Execution exceeded the effective time budget while emitting the response.',
    );
  return undefined;
}
