import type { Catalog } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type {
  LogicalPlan,
  PlanNode,
  PlanOperation,
  QueryCost,
  QueryLimits,
  QueryOutcome,
  QueryPins,
  QuerySchema,
  RelationalQuery,
} from '../types.js';
import {
  failure,
  immutableSnapshot,
  isJoinOperation,
  safeId,
  scanSchema,
  stable,
  type CatalogEntity,
} from './shared.js';

export interface PlannerState {
  readonly nodes: PlanNode[];
  current: string;
  schema: QuerySchema;
  depth: number;
  cost: QueryCost;
}

interface BuildContext {
  readonly input: RelationalQuery;
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly limits: QueryLimits;
}

export interface PreparedBuild {
  readonly context: BuildContext;
  readonly state: PlannerState;
}

export type BuildStep = (prepared: PreparedBuild) => QueryOutcome<void>;

function estimateBytes(schema: QuerySchema, rows: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, rows) * Math.max(1, schema.fields.length) * 32);
}

const POPULATION_OPERATIONS: ReadonlySet<PlanOperation> = new Set([
  'join',
  'semijoin',
  'group',
  'aggregate',
  'top-k',
  'window',
]);

function nextCost(
  previous: QueryCost,
  schema: QuerySchema,
  operation: PlanOperation,
  rows: number,
  joinRows = previous.joinRows,
  requiresComplete = previous.requiresComplete,
): QueryCost {
  const isJoin = isJoinOperation(operation);
  const requiresPopulation = POPULATION_OPERATIONS.has(operation);
  return {
    estimatedRows: Math.max(0, rows),
    estimatedBytes: estimateBytes(schema, rows),
    nodes: previous.nodes + 1,
    joinRows: joinRows + (isJoin ? rows : 0),
    requiresComplete: requiresComplete || requiresPopulation,
    operations: previous.operations + Math.max(1, rows),
  };
}

function nodeDetail(operation: PlanOperation): string {
  switch (operation) {
    case 'semijoin':
      return 'membership join preserves left identity and row count';
    case 'join':
      return 'declared cardinality join';
    default:
      return `${operation} over bounded typed relation`;
  }
}

export function addNode(
  state: PlannerState,
  operation: PlanOperation,
  output: QuerySchema,
  params: Record<string, unknown>,
  limits: QueryLimits,
  inputs: readonly string[],
  rows: number,
  joinRows = state.cost.joinRows,
  requiresComplete = state.cost.requiresComplete,
): QueryOutcome<void> {
  const id = `n${state.nodes.length}-${operation}`;
  const boundedRows = Math.min(limits.maxRows, rows);
  const cost = nextCost(state.cost, output, operation, boundedRows, joinRows, requiresComplete);
  if (cost.nodes > limits.maxNodes || state.depth + 1 > limits.maxDepth || cost.operations > limits.maxOperations)
    return failure('query.budget', 'Logical query plan exceeds the bounded node, depth or operation budget.');
  if (cost.joinRows > limits.maxJoinRows)
    return failure('query.budget', 'Logical query plan exceeds the bounded join-row budget.');
  const node = { id, op: operation, inputs: [...inputs], output, cost, ...params } as unknown as PlanNode;
  state.nodes.push(node);
  state.current = id;
  state.schema = output;
  state.depth += 1;
  state.cost = cost;
  return { ok: true, value: undefined };
}

function validatePins(pins: QueryPins, catalog: Catalog, registry: FunctionRegistry): QueryOutcome<void> {
  if (!safeId(pins.catalogRevision) || pins.catalogRevision !== catalog.revision)
    return failure('query.stale-catalog', 'Query pins must match the current catalog revision.', [
      'pins',
      'catalogRevision',
    ]);
  if (!safeId(pins.functionRegistryDigest) || pins.functionRegistryDigest !== registry.digest)
    return failure('query.stale-registry', 'Query pins must match the current function registry digest.', [
      'pins',
      'functionRegistryDigest',
    ]);
  for (const value of [pins.sourceRevision, pins.scopeDigest, pins.policyRevision]) {
    if (value !== undefined && !safeId(value))
      return failure('query.pin', 'Query revision and scope pins must be bounded identifiers.', ['pins']);
  }
  return { ok: true, value: undefined };
}

function initialState(entity: CatalogEntity, limits: QueryLimits): PlannerState {
  const schema = scanSchema(entity);
  return {
    nodes: [],
    current: '',
    schema,
    depth: 0,
    cost: {
      estimatedRows: limits.maxRows,
      estimatedBytes: estimateBytes(schema, limits.maxRows),
      nodes: 0,
      joinRows: 0,
      requiresComplete: false,
      operations: 0,
    },
  };
}

export function prepareBuild(
  input: RelationalQuery,
  catalog: Catalog,
  registry: FunctionRegistry,
  limits: QueryLimits,
): QueryOutcome<PreparedBuild> {
  if (input.topK !== undefined && (input.orderBy?.length ?? 0) === 0)
    return failure('query.top-k-order', 'A top-K population requires an explicit deterministic ordering.', ['topK']);
  const pins = validatePins(input.pins, catalog, registry);
  if (!pins.ok) return pins;
  const entity = catalog.entities.find((candidate) => candidate.id === input.root);
  if (entity === undefined) return failure('query.entity', `Entity ${input.root} is not declared.`, ['root']);
  if (!Array.isArray(input.select) || input.select.length === 0)
    return failure('query.projection', 'A relational query must declare at least one projected field.', ['select']);
  const context = { input, catalog, registry, limits };
  return { ok: true, value: { context, state: initialState(entity, limits) } };
}

export function finishPlan(prepared: PreparedBuild): QueryOutcome<LogicalPlan> {
  const { state, context } = prepared;
  const pins = context.input.pins;
  const canonical = stable({ version: '1', pins, root: state.current, nodes: state.nodes });
  const plan: LogicalPlan = {
    version: '1',
    pins,
    root: state.current,
    nodes: state.nodes,
    output: state.schema,
    cost: state.cost,
    canonical,
    planKey: `query-${canonical}`,
    explain: state.nodes.map((node) => ({
      nodeId: node.id,
      operation: node.op,
      inputIds: node.inputs,
      detail: nodeDetail(node.op),
      estimatedRows: node.cost.estimatedRows,
      estimatedBytes: node.cost.estimatedBytes,
    })),
  };
  return { ok: true, value: immutableSnapshot(plan) };
}
