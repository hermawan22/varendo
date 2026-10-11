import type { Catalog } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { LogicalPlan, PlanNode, PlanOperation, QueryOutcome, QuerySchema } from '../types.js';
import { failure, scanSchema, stable } from './shared.js';
import { resolveExpression, validatePredicate } from './expressions.js';
import { relationshipFor, validateRelationshipKeyTypes } from './relations.js';
import {
  aggregateSchema,
  appendSchema,
  groupSchema,
  joinSchema,
  projectSchema,
  timeBucketSchema,
  windowSchema,
} from './schemas.js';

interface SemanticContext {
  readonly nodes: ReadonlyMap<string, PlanNode>;
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
}

type SemanticHandler = (context: SemanticContext, node: PlanNode) => QueryOutcome<QuerySchema>;

function firstInput(context: SemanticContext, node: PlanNode): QueryOutcome<QuerySchema> {
  const inputId = node.inputs[0];
  const input = inputId === undefined ? undefined : context.nodes.get(inputId)?.output;
  if (input === undefined) return failure('query.plan', 'Plan input schema is unavailable.');
  return { ok: true, value: input };
}

function scanOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'scan' }>): QueryOutcome<QuerySchema> {
  const entity = context.catalog.entities.find((candidate) => candidate.id === node.entity);
  if (entity === undefined) return failure('query.plan', 'Plan scan entity is unavailable.');
  return { ok: true, value: scanSchema(entity) };
}

function filterOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'filter' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  const checked = validatePredicate(node.predicate, input.value, context.registry);
  if (!checked.ok) return checked;
  return input;
}

function projectOutput(
  context: SemanticContext,
  node: Extract<PlanNode, { op: 'project' }>,
): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return projectSchema(input.value, node.items, context.registry);
}

function deriveOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'derive' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return appendSchema(input.value, node.items, context.registry);
}

function timeBucketOutput(
  context: SemanticContext,
  node: Extract<PlanNode, { op: 'time-bucket' }>,
): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return timeBucketSchema(input.value, node.items, context.registry);
}

function windowOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'window' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return windowSchema(input.value, node.items, context.registry);
}

function groupOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'group' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return groupSchema(input.value, node.keys, context.registry);
}

function aggregateOutput(
  context: SemanticContext,
  node: Extract<PlanNode, { op: 'aggregate' }>,
): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  const groupId = node.inputs[0];
  const group = groupId === undefined ? undefined : context.nodes.get(groupId);
  const populationId = group?.inputs[0];
  const population = populationId === undefined ? undefined : context.nodes.get(populationId)?.output;
  if (group?.op !== 'group' || population === undefined)
    return failure('query.plan', 'Aggregate population schema is unavailable.');
  return aggregateSchema(population, input.value, node.items, context.registry);
}

function validateSortItems(
  node: Extract<PlanNode, { op: 'sort' }>,
  input: QuerySchema,
  registry: FunctionRegistry,
): QueryOutcome<void> {
  for (const item of node.items) {
    const checked = resolveExpression(item.expression, input, registry);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function sortOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'sort' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  const checked = validateSortItems(node, input.value, context.registry);
  if (!checked.ok) return checked;
  return input;
}

function relationshipOutput(
  context: SemanticContext,
  node: Extract<PlanNode, { op: 'join' | 'semijoin' }>,
  input: QuerySchema,
): QueryOutcome<QuerySchema> {
  const rightId = node.inputs[1];
  const right = rightId === undefined ? undefined : context.nodes.get(rightId)?.output;
  const relation = relationshipFor(context.catalog, node.spec.relationship);
  if (right === undefined || relation === undefined)
    return failure('query.plan', 'Relationship schema is unavailable.');
  const keys = validateRelationshipKeyTypes(context.catalog, relation, []);
  if (!keys.ok) return keys;
  if (node.spec.where !== undefined) {
    const checked = validatePredicate(node.spec.where, right, context.registry);
    if (!checked.ok) return checked;
  }
  if (node.op === 'join') return { ok: true, value: joinSchema(input, right, relation, node.spec.kind) };
  return { ok: true, value: input };
}

function joinOutput(context: SemanticContext, node: Extract<PlanNode, { op: 'join' }>): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return relationshipOutput(context, node, input.value);
}

function semijoinOutput(
  context: SemanticContext,
  node: Extract<PlanNode, { op: 'semijoin' }>,
): QueryOutcome<QuerySchema> {
  const input = firstInput(context, node);
  if (!input.ok) return input;
  return relationshipOutput(context, node, input.value);
}

function unchangedOutput(context: SemanticContext, node: PlanNode): QueryOutcome<QuerySchema> {
  return firstInput(context, node);
}

const SEMANTIC_HANDLERS: Record<PlanOperation, SemanticHandler> = {
  scan: (context, node) => scanOutput(context, node as Extract<PlanNode, { op: 'scan' }>),
  filter: (context, node) => filterOutput(context, node as Extract<PlanNode, { op: 'filter' }>),
  project: (context, node) => projectOutput(context, node as Extract<PlanNode, { op: 'project' }>),
  derive: (context, node) => deriveOutput(context, node as Extract<PlanNode, { op: 'derive' }>),
  'time-bucket': (context, node) => timeBucketOutput(context, node as Extract<PlanNode, { op: 'time-bucket' }>),
  window: (context, node) => windowOutput(context, node as Extract<PlanNode, { op: 'window' }>),
  join: (context, node) => joinOutput(context, node as Extract<PlanNode, { op: 'join' }>),
  semijoin: (context, node) => semijoinOutput(context, node as Extract<PlanNode, { op: 'semijoin' }>),
  group: (context, node) => groupOutput(context, node as Extract<PlanNode, { op: 'group' }>),
  aggregate: (context, node) => aggregateOutput(context, node as Extract<PlanNode, { op: 'aggregate' }>),
  sort: (context, node) => sortOutput(context, node as Extract<PlanNode, { op: 'sort' }>),
  'top-k': unchangedOutput,
};

function expectedOutput(context: SemanticContext, node: PlanNode): QueryOutcome<QuerySchema> {
  return SEMANTIC_HANDLERS[node.op](context, node);
}

function validateNodeOutput(context: SemanticContext, node: PlanNode): QueryOutcome<void> {
  const expected = expectedOutput(context, node);
  if (!expected.ok) return expected;
  if (stable(expected.value) === stable(node.output)) return { ok: true, value: undefined };
  return failure('query.plan-schema', 'Plan output metadata does not match its validated semantics.', [
    'nodes',
    node.id,
    'output',
  ]);
}

/** Reuse planner semantics after a transported plan passes structural validation. */
export function validatePlanSemantics(
  plan: LogicalPlan,
  catalog: Catalog,
  registry: FunctionRegistry,
): QueryOutcome<void> {
  const context: SemanticContext = { nodes: new Map(plan.nodes.map((node) => [node.id, node])), catalog, registry };
  for (const node of plan.nodes) {
    const checked = validateNodeOutput(context, node);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}
