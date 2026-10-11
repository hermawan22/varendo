import type { Catalog, MeaningDefinition, Outcome } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import { DEFAULT_LIMITS } from '../planner.js';
import { isJoinOperation } from '../planner/shared.js';
import type { LogicalPlan, PlanNode, QueryExecutionContext, QueryLimits, QueryResult, QuerySource } from '../types.js';
import { failure, isPlainDataRecord, safePositiveCount, type EvalRelation, type EvalState } from './shared.js';
import { validateExecutionContext, validateLogicalPlan } from './plan-validation.js';
import { executeOperator } from './operator-dispatch.js';
import { outputBytes, tick } from './execution-budget.js';

interface PreparedExecution {
  readonly context: QueryExecutionContext;
  readonly startedAt?: number;
}

function limitsAreValid(limits: QueryLimits): boolean {
  const keys = Object.keys(DEFAULT_LIMITS) as (keyof QueryLimits)[];
  if (!isPlainDataRecord(limits)) return false;
  return keys.every((key) => safePositiveCount(limits[key]));
}

function effectiveContext(context: QueryExecutionContext, limits: QueryLimits): QueryExecutionContext {
  return {
    ...context,
    maxRows: Math.min(context.maxRows ?? limits.maxRows, limits.maxRows),
    maxBytes: Math.min(context.maxBytes ?? limits.maxBytes, limits.maxBytes),
    maxOperations: Math.min(context.maxOperations ?? limits.maxOperations, limits.maxOperations),
  };
}

function prepareExecution(context: QueryExecutionContext, limits: QueryLimits): Outcome<PreparedExecution> {
  const validated = validateExecutionContext(context);
  if (!validated.ok) return validated;
  if (!limitsAreValid(limits)) return failure('query.budget', 'Evaluator host limits must be positive safe integers.');
  return {
    ok: true,
    value: {
      context: effectiveContext(context, limits),
      ...(validated.value.startedAt === undefined ? {} : { startedAt: validated.value.startedAt }),
    },
  };
}

function validateSourceEnvelope(source: QuerySource): Outcome<void> {
  if (isPlainDataRecord(source) && typeof source.revision === 'string' && isPlainDataRecord(source.relations))
    return { ok: true, value: undefined };
  return failure('query.source-shape', 'Query source must be a plain data object with a plain relations map.');
}

function verifyPlan(
  plan: LogicalPlan,
  catalog: Catalog,
  registry: FunctionRegistry,
  limits: QueryLimits,
  definitions: readonly MeaningDefinition[],
): Outcome<LogicalPlan> {
  try {
    return validateLogicalPlan(plan as unknown, catalog, registry, limits, definitions);
  } catch {
    return failure('query.plan', 'Logical plan validation failed safely at the untrusted boundary.');
  }
}

function validateSourceRevision(plan: LogicalPlan, source: QuerySource, catalog: Catalog): Outcome<void> {
  if (plan.pins.sourceRevision !== undefined && plan.pins.sourceRevision !== source.revision)
    return failure('query.stale-source', 'The logical plan is stale for the source revision.');
  if (source.catalogRevision !== undefined && source.catalogRevision !== catalog.revision)
    return failure('query.stale-source', 'The source catalog revision is stale.');
  return { ok: true, value: undefined };
}

function validateScopeAuthorization(
  plan: LogicalPlan,
  source: QuerySource,
  context: QueryExecutionContext,
): Outcome<void> {
  if (plan.pins.scopeDigest === undefined) return { ok: true, value: undefined };
  const scope = context.scopeDigest ?? source.scopeDigest;
  if (
    scope !== plan.pins.scopeDigest ||
    (source.scopeDigest !== undefined && source.scopeDigest !== plan.pins.scopeDigest)
  )
    return failure('query.denied', 'The logical plan scope is not authorized for this source.');
  return { ok: true, value: undefined };
}

function validatePolicyAuthorization(
  plan: LogicalPlan,
  source: QuerySource,
  context: QueryExecutionContext,
): Outcome<void> {
  if (plan.pins.policyRevision === undefined) return { ok: true, value: undefined };
  const policy = context.policyRevision ?? source.policyRevision;
  if (
    policy !== plan.pins.policyRevision ||
    (source.policyRevision !== undefined && source.policyRevision !== plan.pins.policyRevision)
  )
    return failure('query.denied', 'The logical plan policy revision is not current.');
  return { ok: true, value: undefined };
}

function validateCatalogAuthorization(context: QueryExecutionContext, catalog: Catalog): Outcome<void> {
  if (context.catalogRevision !== undefined && context.catalogRevision !== catalog.revision)
    return failure('query.stale-catalog', 'The evaluator context catalog revision is stale.');
  return { ok: true, value: undefined };
}

function authorizePlan(
  plan: LogicalPlan,
  source: QuerySource,
  catalog: Catalog,
  context: QueryExecutionContext,
): Outcome<void> {
  const sourceRevision = validateSourceRevision(plan, source, catalog);
  if (!sourceRevision.ok) return sourceRevision;
  const scope = validateScopeAuthorization(plan, source, context);
  if (!scope.ok) return scope;
  const policy = validatePolicyAuthorization(plan, source, context);
  if (!policy.ok) return policy;
  return validateCatalogAuthorization(context, catalog);
}

function createState(
  source: QuerySource,
  catalog: Catalog,
  registry: FunctionRegistry,
  prepared: PreparedExecution,
): EvalState {
  const startedAt = prepared.startedAt;
  return {
    source,
    catalog,
    registry,
    context: prepared.context,
    ...(startedAt === undefined ? {} : { startedAt, lastClock: startedAt }),
    unknown: [],
    approximate: false,
    operations: 0,
    scannedRows: 0,
    sourceBytes: 0,
    materializedBytes: new WeakMap(),
  };
}

function validateIntermediateBudget(
  result: Outcome<EvalRelation>,
  node: PlanNode,
  context: QueryExecutionContext,
  limits: QueryLimits,
): Outcome<EvalRelation> {
  if (!result.ok) return result;
  const overRows = result.value.rows.length > context.maxRows!;
  const overBytes = outputBytes(result.value.rows) > context.maxBytes!;
  const isJoin = isJoinOperation(node.op);
  const overJoinRows = isJoin && result.value.rows.length > limits.maxJoinRows;
  if (overRows || overBytes || overJoinRows)
    return failure('query.budget', 'Query intermediate exceeds its effective materialization budget.');
  return result;
}

function createNodeEvaluator(
  plan: LogicalPlan,
  state: EvalState,
  catalog: Catalog,
  limits: QueryLimits,
): (id: string) => Outcome<EvalRelation> {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node] as const));
  const cache = new Map<string, Outcome<EvalRelation>>();
  const evaluateNode = (id: string): Outcome<EvalRelation> => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = nodes.get(id);
    if (node === undefined) return failure('query.plan', `Plan node ${id} is missing.`);
    const charged = tick(state);
    if (!charged.ok) {
      cache.set(id, charged);
      return charged;
    }
    const inputs: EvalRelation[] = [];
    for (const inputId of node.inputs) {
      const evaluated = evaluateNode(inputId);
      if (!evaluated.ok) {
        cache.set(id, evaluated);
        return evaluated;
      }
      inputs.push(evaluated.value);
    }
    const execution = executeOperator(node, inputs, state, catalog);
    const bounded = validateIntermediateBudget(execution, node, state.context, limits);
    cache.set(id, bounded);
    return bounded;
  };
  return evaluateNode;
}

function completeResult(state: EvalState, source: QuerySource, result: EvalRelation): Outcome<QueryResult> {
  const bytes = outputBytes(result.rows);
  if (state.context.maxRows !== undefined && result.rows.length > state.context.maxRows)
    return failure('query.budget', 'Query result exceeds the row budget.');
  if (state.context.maxBytes !== undefined && bytes > state.context.maxBytes)
    return failure('query.budget', 'Query result exceeds the byte budget.');
  const finalCheck = tick(state, 0);
  if (!finalCheck.ok) return finalCheck;
  const precision = state.approximate
    ? { kind: 'approximate' as const, method: 'IEEE-754 arithmetic, division or mean' }
    : { kind: 'exact' as const };
  return {
    ok: true,
    value: {
      schema: result.schema,
      rows: result.rows,
      sourceRevision: source.revision,
      complete: result.complete,
      precision,
      unknown: state.unknown,
      estimatedBytes: bytes,
    },
  };
}

export function evaluateLogicalPlan(
  plan: LogicalPlan,
  source: QuerySource,
  catalog: Catalog,
  registry: FunctionRegistry,
  context: QueryExecutionContext = {},
  limits: QueryLimits = DEFAULT_LIMITS,
  definitions: readonly MeaningDefinition[] = [],
): Outcome<QueryResult> {
  const prepared = prepareExecution(context, limits);
  if (!prepared.ok) return prepared;
  const sourceEnvelope = validateSourceEnvelope(source);
  if (!sourceEnvelope.ok) return sourceEnvelope;
  const verified = verifyPlan(plan, catalog, registry, limits, definitions);
  if (!verified.ok) return verified;
  const authorized = authorizePlan(verified.value, source, catalog, prepared.value.context);
  if (!authorized.ok) return authorized;
  const state = createState(source, catalog, registry, prepared.value);
  const evaluateNode = createNodeEvaluator(verified.value, state, catalog, limits);
  const result = evaluateNode(verified.value.root);
  if (!result.ok) return result;
  return completeResult(state, source, result.value);
}
