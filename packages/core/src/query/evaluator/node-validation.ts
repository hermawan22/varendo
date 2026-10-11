import type { Catalog, Expression, MeaningDefinition, Outcome, VersionRef } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { GroupKeySpec, PlanNode, PlanOperation, PredicateSpec, QuerySchema } from '../types.js';
import {
  failure,
  fieldKey,
  isRecord,
  planId,
  relationship,
  safeCount,
  safePositiveCount,
  stable,
  type PlanRecord,
} from './shared.js';
import {
  catalogSchema,
  compatibleSemanticTypes,
  expressionFields,
  planFields,
  predicateFields,
  validateAggregateSemantics,
  validQuerySchema,
} from './validation-common.js';
import { isFanoutCardinality } from '../planner/shared.js';

export type ValidNode = PlanRecord & {
  readonly id: string;
  readonly op: PlanOperation;
  readonly inputs: readonly string[];
  readonly output: QuerySchema;
};

interface NodeValidationContext {
  readonly node: ValidNode;
  readonly inputRelations: readonly PlanNode[];
  readonly nodes: ReadonlyMap<string, ValidNode>;
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly definitions: readonly MeaningDefinition[];
}

type NodeValidator = (context: NodeValidationContext) => Outcome<void>;

const NODE_VALIDATORS: Record<PlanOperation, NodeValidator> = {
  scan: validateScan,
  filter: validateFilter,
  project: validateProjection,
  derive: validateProjection,
  'time-bucket': validateProjection,
  window: validateWindow,
  join: validateJoin,
  semijoin: validateJoin,
  group: validateGroup,
  aggregate: validateAggregate,
  sort: validateSort,
  'top-k': validateTopK,
};

export function validNodeCost(value: unknown): value is PlanRecord {
  return (
    isRecord(value) &&
    safeCount(value.estimatedRows) &&
    safeCount(value.estimatedBytes) &&
    safeCount(value.nodes) &&
    safeCount(value.joinRows) &&
    typeof value.requiresComplete === 'boolean' &&
    safeCount(value.operations)
  );
}

export function validNodeShape(node: PlanRecord, catalog: Catalog): node is ValidNode {
  if (!planId(node.id) || typeof node.op !== 'string' || !Object.hasOwn(NODE_VALIDATORS, node.op)) return false;
  if (!Array.isArray(node.inputs) || !node.inputs.every(planId)) return false;
  return validQuerySchema(node.output, catalog) && validNodeCost(node.cost);
}

export function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function inputFor(context: NodeValidationContext): Outcome<PlanNode> {
  const input = context.inputRelations[0];
  if (input !== undefined) return { ok: true, value: input };
  return failure('query.plan', 'Non-scan node is missing its input.');
}

function validateScan(context: NodeValidationContext): Outcome<void> {
  const { node } = context;
  if (node.inputs.length !== 0 || typeof node.entity !== 'string')
    return failure('query.plan', 'Scan node shape is invalid.');
  const expected = catalogSchema(context.catalog, node.entity);
  if (expected !== undefined && stable(node.output) === stable(expected)) return { ok: true, value: undefined };
  return failure('query.plan', 'Scan node schema does not match the catalog entity.');
}

function validateFilter(context: NodeValidationContext): Outcome<void> {
  const { node, registry } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !isRecord(node.predicate))
    return failure('query.plan', 'Filter node shape is invalid.');
  return predicateFields(input.value.output, node.predicate as PredicateSpec, registry);
}

function addExpressionItem(
  item: unknown,
  ids: Set<string>,
  schema: QuerySchema,
  registry: FunctionRegistry,
): Outcome<string> {
  if (!isRecord(item) || !planId(item.id) || !isRecord(item.expression))
    return failure('query.plan', 'Projection item is invalid.');
  if (ids.has(item.id)) return failure('query.plan', 'Projection item identifiers must be unique.');
  const checked = expressionFields(schema, item.expression as Expression, registry);
  if (!checked.ok) return checked;
  ids.add(item.id);
  return { ok: true, value: item.id };
}

function validateExpressionItems(
  items: readonly unknown[],
  schema: QuerySchema,
  registry: FunctionRegistry,
): Outcome<string[]> {
  const ids = new Set<string>();
  for (const item of items) {
    const checked = addExpressionItem(item, ids, schema, registry);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: [...ids] };
}

function expectedProjectionIds(node: ValidNode, input: PlanNode, itemIds: readonly string[]): readonly string[] {
  if (node.op === 'project') return itemIds;
  return [...input.output.fields.map((field) => field.id), ...itemIds];
}

function validateProjection(context: NodeValidationContext): Outcome<void> {
  const { node, registry } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !Array.isArray(node.items))
    return failure('query.plan', `${node.op} node shape is invalid.`);
  const itemIds = validateExpressionItems(node.items, input.value.output, registry);
  if (!itemIds.ok) return itemIds;
  const expected = expectedProjectionIds(node, input.value, itemIds.value);
  const actual = node.output.fields.map((field) => field.id);
  if (sameIds(actual, expected)) return { ok: true, value: undefined };
  return failure('query.plan', `${node.op} output schema does not match its items.`);
}

function validateWindowSorts(
  values: readonly unknown[],
  schema: QuerySchema,
  registry: FunctionRegistry,
): Outcome<void> {
  for (const value of values) {
    if (!isRecord(value) || !isRecord(value.expression)) return failure('query.plan', 'Window sort item is invalid.');
    const checked = expressionFields(schema, value.expression as Expression, registry);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateWindowArguments(value: unknown, schema: QuerySchema, registry: FunctionRegistry): Outcome<void> {
  if (!Array.isArray(value)) return { ok: true, value: undefined };
  for (const expression of value) {
    const checked = expressionFields(schema, expression as Expression, registry);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validWindowItemShape(item: PlanRecord): boolean {
  if (!isRecord(item.function) || !isRecord(item.frame)) return false;
  if (
    !planId(item.function.id) ||
    !planId(item.function.revision) ||
    !Array.isArray(item.partitionBy) ||
    !Array.isArray(item.orderBy) ||
    !safeCount(item.frame.preceding) ||
    !safeCount(item.frame.following)
  )
    return false;
  return true;
}

function validateWindowItem(item: unknown, schema: QuerySchema, registry: FunctionRegistry): Outcome<string> {
  if (!isRecord(item) || !planId(item.id) || !isRecord(item.function) || !validWindowItemShape(item))
    return failure('query.plan', 'Window item is invalid.');
  const signature = registry.resolve(item.function as VersionRef);
  if (signature === undefined) return failure('query.plan', 'Window item is invalid.');
  if (!signature.contexts.includes('window'))
    return failure('query.plan', 'Window item function is not registered for window evaluation.');
  const partitions = validateWindowArguments(item.partitionBy, schema, registry);
  if (!partitions.ok) return partitions;
  const sorts = validateWindowSorts(item.orderBy as readonly unknown[], schema, registry);
  if (!sorts.ok) return sorts;
  const argumentsCheck = validateWindowArguments(item.arguments, schema, registry);
  if (!argumentsCheck.ok) return argumentsCheck;
  return { ok: true, value: item.id };
}

function validateWindow(context: NodeValidationContext): Outcome<void> {
  const { node, registry } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !Array.isArray(node.items))
    return failure('query.plan', 'Window node shape is invalid.');
  const ids = new Set<string>();
  for (const item of node.items) {
    const checked = validateWindowItem(item, input.value.output, registry);
    if (!checked.ok) return checked;
    if (ids.has(checked.value)) return failure('query.plan', 'Window item identifiers must be unique.');
    ids.add(checked.value);
  }
  const expected = [...input.value.output.fields.map((field) => field.id), ...ids];
  const actual = node.output.fields.map((field) => field.id);
  if (sameIds(actual, expected)) return { ok: true, value: undefined };
  return failure('query.plan', 'Window output schema does not match its items.');
}

function validateGroupKeys(
  values: readonly unknown[],
  schema: QuerySchema,
  registry: FunctionRegistry,
): Outcome<string[]> {
  const ids = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || !planId(value.id) || !isRecord(value.expression))
      return failure('query.plan', 'Group key is invalid.');
    if (ids.has(value.id)) return failure('query.plan', 'Group key identifiers must be unique.');
    const checked = expressionFields(schema, value.expression as Expression, registry);
    if (!checked.ok) return checked;
    ids.add(value.id);
  }
  return { ok: true, value: [...ids] };
}

function validateGroup(context: NodeValidationContext): Outcome<void> {
  const { node, registry } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !Array.isArray(node.keys))
    return failure('query.plan', 'Group node shape is invalid.');
  const keys = validateGroupKeys(node.keys, input.value.output, registry);
  if (!keys.ok) return keys;
  const actual = node.output.fields.map((field) => field.id);
  if (sameIds(actual, keys.value)) return { ok: true, value: undefined };
  return failure('query.plan', 'Group output schema does not match its keys.');
}

function aggregateExpressionSchema(context: NodeValidationContext, input: PlanNode): QuerySchema {
  if (input.op === 'group' && input.inputs.length === 1) {
    const population = context.nodes.get(input.inputs[0]!);
    if (population !== undefined) return population.output;
  }
  return input.output;
}

function trustedGroupKeys(context: NodeValidationContext, input: PlanNode): readonly GroupKeySpec[] {
  if (input.op !== 'group' || input.inputs.length !== 1 || !Array.isArray(input.keys)) return [];
  const population = context.nodes.get(input.inputs[0]!);
  return input.keys.map((key) => {
    const groupField = input.output.fields.find((field) => field.id === key.id);
    if (groupField === undefined || !['date', 'instant'].includes(groupField.type.value)) return key;
    if (population?.op !== 'time-bucket' || !Array.isArray(population.items) || key.expression.kind !== 'field')
      return key;
    const bucket = population.items.find(
      (item) => isRecord(item) && item.id === key.expression.ref && isRecord(item.expression),
    );
    return bucket === undefined ? key : { ...key, expression: bucket.expression as Expression };
  });
}

function validateAggregateItem(
  item: unknown,
  schema: QuerySchema,
  registry: FunctionRegistry,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  groupKeys: readonly GroupKeySpec[],
): Outcome<string> {
  if (
    !isRecord(item) ||
    !planId(item.id) ||
    !isRecord(item.function) ||
    !Array.isArray(item.arguments) ||
    registry.resolve(item.function as VersionRef) === undefined
  )
    return failure('query.plan', 'Aggregate item is invalid.');
  for (const argument of item.arguments) {
    const checked = expressionFields(schema, argument as Expression, registry);
    if (!checked.ok) return checked;
  }
  const semantics = validateAggregateSemantics(item, schema, catalog, definitions, groupKeys);
  if (!semantics.ok) return semantics;
  return { ok: true, value: item.id };
}

function validateAggregateItems(
  items: readonly unknown[],
  schema: QuerySchema,
  registry: FunctionRegistry,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  groupKeys: readonly GroupKeySpec[],
): Outcome<string[]> {
  const ids = new Set<string>();
  for (const item of items) {
    const checked = validateAggregateItem(item, schema, registry, catalog, definitions, groupKeys);
    if (!checked.ok) return checked;
    if (ids.has(checked.value)) return failure('query.plan', 'Aggregate item identifiers must be unique.');
    ids.add(checked.value);
  }
  return { ok: true, value: [...ids] };
}

function validateAggregate(context: NodeValidationContext): Outcome<void> {
  const { node, registry, catalog, definitions } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !Array.isArray(node.items))
    return failure('query.plan', 'Aggregate node shape is invalid.');
  const expressionSchema = aggregateExpressionSchema(context, input.value);
  const groupKeys = trustedGroupKeys(context, input.value);
  const itemIds = validateAggregateItems(node.items, expressionSchema, registry, catalog, definitions, groupKeys);
  if (!itemIds.ok) return itemIds;
  const expected = [...input.value.output.fields.map((field) => field.id), ...itemIds.value];
  const actual = node.output.fields.map((field) => field.id);
  if (sameIds(actual, expected)) return { ok: true, value: undefined };
  return failure('query.plan', 'Aggregate output schema does not match its items.');
}

function validateSortItems(values: readonly unknown[], schema: QuerySchema, registry: FunctionRegistry): Outcome<void> {
  for (const value of values) {
    if (!isRecord(value) || !isRecord(value.expression)) return failure('query.plan', 'Sort item is invalid.');
    const checked = expressionFields(schema, value.expression as Expression, registry);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateSort(context: NodeValidationContext): Outcome<void> {
  const { node, registry } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length !== 1 || !Array.isArray(node.items) || stable(node.output) !== stable(input.value.output))
    return failure('query.plan', 'Sort node shape is invalid.');
  return validateSortItems(node.items, input.value.output, registry);
}

function validateTopK(context: NodeValidationContext): Outcome<void> {
  const { node } = context;
  const input = inputFor(context);
  if (!input.ok) return input;
  if (node.inputs.length === 1 && safePositiveCount(node.limit) && stable(node.output) === stable(input.value.output))
    return { ok: true, value: undefined };
  return failure('query.plan', 'Top-K node shape is invalid.');
}

interface JoinValidationParts {
  readonly left: PlanNode;
  readonly right: PlanNode;
  readonly spec: PlanRecord;
}

function joinParts(context: NodeValidationContext): Outcome<JoinValidationParts> {
  const { node, inputRelations } = context;
  const left = inputRelations[0];
  const right = inputRelations[1];
  if (
    node.inputs.length !== 2 ||
    left === undefined ||
    right === undefined ||
    !isRecord(node.spec) ||
    !isRecord(node.spec.relationship) ||
    !Array.isArray(node.keys)
  )
    return failure('query.plan', `${node.op} node shape is invalid.`);
  return { ok: true, value: { left, right, spec: node.spec } };
}

function declaredJoinRelationship(
  context: NodeValidationContext,
  parts: JoinValidationParts,
): Outcome<NonNullable<ReturnType<typeof relationship>>> {
  const { catalog } = context;
  const relation = relationship(catalog, parts.spec.relationship as VersionRef);
  const sourceEntity = parts.left.output.fields.find((field) => field.source !== undefined)?.source?.entity;
  if (
    relation === undefined ||
    relation.joinPolicy !== 'validated' ||
    relation.sourceEntity !== sourceEntity ||
    relation.targetEntity !== parts.spec.rightEntity
  )
    return failure('query.plan', 'Join relationship is not declared or has the wrong direction.');
  return { ok: true, value: relation };
}

function validateJoinPolicy(node: ValidNode, relation: NonNullable<ReturnType<typeof relationship>>): Outcome<void> {
  const fanout = isFanoutCardinality(relation.cardinality);
  if (fanout && node.op === 'join') return failure('query.plan', 'A regular join cannot use a fanout relationship.');
  if (node.op === 'join' && !['inner', 'left'].includes(String((node.spec as PlanRecord).kind)))
    return failure('query.plan', 'Join kind is invalid.');
  return { ok: true, value: undefined };
}

function validJoinKey(key: unknown, left: QuerySchema, right: QuerySchema): Outcome<void> {
  if (!isRecord(key) || !planId(key.left) || !planId(key.right)) return failure('query.plan', 'Join key is invalid.');
  if (!planFields(left).has(key.left) || !planFields(right).has(key.right))
    return failure('query.plan', 'Join key is invalid.');
  const leftField = left.fields.find((field) => field.id === key.left);
  const rightField = right.fields.find((field) => field.id === key.right);
  if (leftField !== undefined && rightField !== undefined && compatibleSemanticTypes(leftField.type, rightField.type))
    return { ok: true, value: undefined };
  return failure(
    'query.relationship-key-type',
    'Join key fields must have compatible semantic types, units and temporal policies.',
  );
}

function validateJoinKeys(
  node: ValidNode,
  parts: JoinValidationParts,
  relation: NonNullable<ReturnType<typeof relationship>>,
): Outcome<void> {
  const declared = relation.keys.map((key) => ({
    left: fieldKey(relation.sourceEntity, key.sourceField),
    right: fieldKey(relation.targetEntity, key.targetField),
  }));
  if (stable(node.keys) !== stable(declared))
    return failure('query.relationship-keys', 'Plan join keys must exactly match the declared relationship keys.');
  for (const key of node.keys as readonly unknown[]) {
    const checked = validJoinKey(key, parts.left.output, parts.right.output);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateJoinFilter(parts: JoinValidationParts, registry: FunctionRegistry): Outcome<void> {
  if (parts.spec.where === undefined) return { ok: true, value: undefined };
  return predicateFields(parts.right.output, parts.spec.where as PredicateSpec, registry);
}

function validateJoin(context: NodeValidationContext): Outcome<void> {
  const parts = joinParts(context);
  if (!parts.ok) return parts;
  const relation = declaredJoinRelationship(context, parts.value);
  if (!relation.ok) return relation;
  const policy = validateJoinPolicy(context.node, relation.value);
  if (!policy.ok) return policy;
  const keys = validateJoinKeys(context.node, parts.value, relation.value);
  if (!keys.ok) return keys;
  return validateJoinFilter(parts.value, context.registry);
}

export function validateNode(
  node: PlanRecord,
  inputRelations: readonly PlanNode[],
  nodes: ReadonlyMap<string, ValidNode>,
  catalog: Catalog,
  registry: FunctionRegistry,
  definitions: readonly MeaningDefinition[] = [],
): Outcome<void> {
  if (!validNodeShape(node, catalog)) return failure('query.plan', 'Plan node shape is invalid.');
  const context = { node, inputRelations, nodes, catalog, registry, definitions };
  return NODE_VALIDATORS[node.op](context);
}
