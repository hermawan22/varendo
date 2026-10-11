import type { Catalog } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { LogicalPlan, PlanNode, QueryLimits, QueryOutcome, QuerySchema, RelationalQuery } from '../types.js';
import {
  DEFAULT_LIMITS,
  failure,
  fieldKey,
  isFanoutCardinality,
  safePositive,
  scanSchema,
  unsupported,
  type CatalogEntity,
} from './shared.js';
import {
  addNode,
  finishPlan,
  prepareBuild,
  type BuildStep,
  type PlannerState,
  type PreparedBuild,
} from './build-state.js';
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

function addInitialScan(prepared: PreparedBuild): QueryOutcome<void> {
  const entity = prepared.context.catalog.entities.find((candidate) => candidate.id === prepared.context.input.root);
  if (entity === undefined) return failure('query.entity', 'Plan root entity is unavailable.');
  return addNode(
    prepared.state,
    'scan',
    prepared.state.schema,
    { entity: entity.id },
    prepared.context.limits,
    [],
    prepared.context.limits.maxRows,
  );
}

function validateRelationship(
  relationship: NonNullable<ReturnType<typeof relationshipFor>>,
  root: string,
  rightEntity: string,
  operation: 'join' | 'semijoin',
  catalog: Catalog,
  index: number,
): QueryOutcome<void> {
  if (relationship.sourceEntity !== root || relationship.targetEntity !== rightEntity)
    return failure(
      'query.relationship-direction',
      `A ${operation} must follow the declared relationship direction from the root entity.`,
      [operation === 'join' ? 'joins' : 'semiJoins', index],
    );
  if (relationship.joinPolicy !== 'validated')
    return unsupported(
      'query.relationship-policy',
      `The declared relationship is not approved for local ${operation} evaluation.`,
      ['Use a validated relationship or a host capability.'],
      [operation === 'join' ? 'joins' : 'semiJoins', index],
    );
  return validateRelationshipKeyTypes(catalog, relationship, [operation === 'join' ? 'joins' : 'semiJoins', index]);
}

function rightEntity(catalog: Catalog, entityId: string): CatalogEntity | undefined {
  return catalog.entities.find((candidate) => candidate.id === entityId);
}

function validateRelationWhere(
  where: RelationalQuery['filter'],
  schema: QuerySchema,
  registry: FunctionRegistry,
  path: readonly (string | number)[],
): QueryOutcome<void> {
  if (where === undefined) return { ok: true, value: undefined };
  return validatePredicate(where, schema, registry, path);
}

function addRelationScans(
  state: PlannerState,
  right: CatalogEntity,
  limits: QueryLimits,
): QueryOutcome<{ readonly left: PlanNode; readonly right: PlanNode }> {
  const left = state.nodes[state.nodes.length - 1];
  if (left === undefined) return failure('query.plan', 'Left relation scan is unavailable.');
  const added = addNode(state, 'scan', scanSchema(right), { entity: right.id }, limits, [], limits.maxRows);
  if (!added.ok) return added;
  const rightNode = state.nodes[state.nodes.length - 1];
  if (rightNode === undefined) return failure('query.plan', 'Right relation scan is unavailable.');
  return { ok: true, value: { left, right: rightNode } };
}

function addSemiJoin(prepared: PreparedBuild, index: number): QueryOutcome<void> {
  const { input, catalog, registry, limits } = prepared.context;
  const spec = input.semiJoins![index]!;
  const relation = relationshipFor(catalog, spec.relationship);
  if (relation === undefined)
    return failure(
      'query.relationship',
      `Relationship ${JSON.stringify([spec.relationship.id, spec.relationship.revision])} is not declared.`,
      ['semiJoins', index],
    );
  const valid = validateRelationship(relation, input.root, spec.rightEntity, 'semijoin', catalog, index);
  if (!valid.ok) return valid;
  const right = rightEntity(catalog, spec.rightEntity);
  if (right === undefined) return failure('query.entity', `Entity ${spec.rightEntity} is not declared.`);
  const where = validateRelationWhere(spec.where, scanSchema(right), registry, ['semiJoins', index, 'where']);
  if (!where.ok) return where;
  const scans = addRelationScans(prepared.state, right, limits);
  if (!scans.ok) return scans;
  const keys = relation.keys.map((key) => ({
    left: fieldKey(relation.sourceEntity, key.sourceField),
    right: fieldKey(relation.targetEntity, key.targetField),
  }));
  return addNode(
    prepared.state,
    'semijoin',
    scans.value.left.output,
    { spec, keys },
    limits,
    [scans.value.left.id, scans.value.right.id],
    Math.min(prepared.state.cost.estimatedRows, limits.maxRows),
  );
}

function processSemiJoins(prepared: PreparedBuild): QueryOutcome<void> {
  const specs = prepared.context.input.semiJoins ?? [];
  for (let index = 0; index < specs.length; index += 1) {
    const result = addSemiJoin(prepared, index);
    if (!result.ok) return result;
  }
  return { ok: true, value: undefined };
}

function addJoin(prepared: PreparedBuild, index: number): QueryOutcome<void> {
  const { input, catalog, registry, limits } = prepared.context;
  const spec = input.joins![index]!;
  const relation = relationshipFor(catalog, spec.relationship);
  if (relation === undefined)
    return failure(
      'query.relationship',
      `Relationship ${JSON.stringify([spec.relationship.id, spec.relationship.revision])} is not declared.`,
      ['joins', index],
    );
  const valid = validateRelationship(relation, input.root, spec.rightEntity, 'join', catalog, index);
  if (!valid.ok) return valid;
  if (isFanoutCardinality(relation.cardinality))
    return unsupported(
      'query.fanout',
      'A regular join could multiply source facts under the declared cardinality.',
      ['Use a semijoin or pre-aggregate the many-side facts before joining.'],
      ['joins', index],
    );
  const right = rightEntity(catalog, spec.rightEntity);
  if (right === undefined) return failure('query.entity', `Entity ${spec.rightEntity} is not declared.`);
  const where = validateRelationWhere(spec.where, scanSchema(right), registry, ['joins', index, 'where']);
  if (!where.ok) return where;
  const scans = addRelationScans(prepared.state, right, limits);
  if (!scans.ok) return scans;
  const keys = relation.keys.map((key) => ({
    left: fieldKey(relation.sourceEntity, key.sourceField),
    right: fieldKey(relation.targetEntity, key.targetField),
  }));
  const output = joinSchema(scans.value.left.output, scans.value.right.output, relation, spec.kind);
  return addNode(
    prepared.state,
    'join',
    output,
    { spec, keys },
    limits,
    [scans.value.left.id, scans.value.right.id],
    Math.min(limits.maxJoinRows, limits.maxRows),
  );
}

function processJoins(prepared: PreparedBuild): QueryOutcome<void> {
  const specs = prepared.context.input.joins ?? [];
  for (let index = 0; index < specs.length; index += 1) {
    const result = addJoin(prepared, index);
    if (!result.ok) return result;
  }
  return { ok: true, value: undefined };
}

function processRelationships(prepared: PreparedBuild): QueryOutcome<void> {
  const semijoins = processSemiJoins(prepared);
  if (!semijoins.ok) return semijoins;
  return processJoins(prepared);
}

function addFilter(prepared: PreparedBuild): QueryOutcome<void> {
  const { input, registry, limits } = prepared.context;
  if (input.filter === undefined) return { ok: true, value: undefined };
  const checked = validatePredicate(input.filter, prepared.state.schema, registry);
  if (!checked.ok) return checked;
  return addNode(
    prepared.state,
    'filter',
    prepared.state.schema,
    { predicate: input.filter },
    limits,
    [prepared.state.current],
    prepared.state.cost.estimatedRows,
  );
}

function addTimeBuckets(prepared: PreparedBuild): QueryOutcome<void> {
  const items = prepared.context.input.timeBuckets ?? [];
  if (items.length === 0) return { ok: true, value: undefined };
  const output = timeBucketSchema(prepared.state.schema, items, prepared.context.registry);
  if (!output.ok) return output;
  return addNode(
    prepared.state,
    'time-bucket',
    output.value,
    { items },
    prepared.context.limits,
    [prepared.state.current],
    prepared.state.cost.estimatedRows,
  );
}

function addDerives(prepared: PreparedBuild): QueryOutcome<void> {
  const items = prepared.context.input.derives ?? [];
  if (items.length === 0) return { ok: true, value: undefined };
  const output = appendSchema(prepared.state.schema, items, prepared.context.registry);
  if (!output.ok) return output;
  return addNode(
    prepared.state,
    'derive',
    output.value,
    { items },
    prepared.context.limits,
    [prepared.state.current],
    prepared.state.cost.estimatedRows,
  );
}

function addWindows(prepared: PreparedBuild): QueryOutcome<void> {
  const items = prepared.context.input.windows ?? [];
  if (items.length === 0) return { ok: true, value: undefined };
  const output = windowSchema(prepared.state.schema, items, prepared.context.registry);
  if (!output.ok) return output;
  return addNode(
    prepared.state,
    'window',
    output.value,
    { items },
    prepared.context.limits,
    [prepared.state.current],
    prepared.state.cost.estimatedRows,
  );
}

function addGroups(prepared: PreparedBuild): QueryOutcome<void> {
  const { state } = prepared;
  const { input, registry, limits } = prepared.context;
  const aggregates = input.aggregates ?? [];
  const groupBy = input.groupBy ?? [];
  if (aggregates.length === 0 && groupBy.length === 0) return { ok: true, value: undefined };
  const preGroupSchema = state.schema;
  const grouped = groupSchema(state.schema, groupBy, registry);
  if (!grouped.ok) return grouped;
  const groupNode = addNode(
    state,
    'group',
    grouped.value,
    { keys: groupBy },
    limits,
    [state.current],
    state.cost.estimatedRows,
  );
  if (!groupNode.ok) return groupNode;
  if (aggregates.length === 0) return { ok: true, value: undefined };
  const output = aggregateSchema(preGroupSchema, grouped.value, aggregates, registry);
  if (!output.ok) return output;
  return addNode(
    state,
    'aggregate',
    output.value,
    { items: aggregates },
    limits,
    [state.current],
    Math.min(state.cost.estimatedRows, limits.maxRows),
  );
}

function processPreProjection(prepared: PreparedBuild): QueryOutcome<void> {
  for (const operation of [addFilter, addTimeBuckets, addDerives, addWindows, addGroups]) {
    const result = operation(prepared);
    if (!result.ok) return result;
  }
  return { ok: true, value: undefined };
}

function addSortBeforeProjection(prepared: PreparedBuild): QueryOutcome<boolean> {
  const { state } = prepared;
  const { input, registry, limits } = prepared.context;
  const orderBy = input.orderBy ?? [];
  if (orderBy.length === 0) return { ok: true, value: false };
  for (const item of orderBy) {
    const checked = resolveExpression(item.expression, state.schema, registry);
    if (!checked.ok) return { ok: true, value: false };
  }
  const sorted = addNode(
    state,
    'sort',
    state.schema,
    { items: orderBy },
    limits,
    [state.current],
    state.cost.estimatedRows,
  );
  if (!sorted.ok) return sorted;
  return { ok: true, value: true };
}

function addProjection(prepared: PreparedBuild): QueryOutcome<void> {
  const { state } = prepared;
  const { input, registry, limits } = prepared.context;
  const output = projectSchema(state.schema, input.select, registry);
  if (!output.ok) return output;
  return addNode(
    state,
    'project',
    output.value,
    { items: input.select },
    limits,
    [state.current],
    state.cost.estimatedRows,
  );
}

function addSortAfterProjection(prepared: PreparedBuild): QueryOutcome<void> {
  const { state } = prepared;
  const { input, registry, limits } = prepared.context;
  const orderBy = input.orderBy ?? [];
  if (orderBy.length === 0) return { ok: true, value: undefined };
  for (const item of orderBy) {
    const checked = resolveExpression(item.expression, state.schema, registry);
    if (!checked.ok) return checked;
  }
  return addNode(state, 'sort', state.schema, { items: orderBy }, limits, [state.current], state.cost.estimatedRows);
}

function processSelection(prepared: PreparedBuild): QueryOutcome<void> {
  const sorted = addSortBeforeProjection(prepared);
  if (!sorted.ok) return sorted;
  const projection = addProjection(prepared);
  if (!projection.ok) return projection;
  if (sorted.value) return { ok: true, value: undefined };
  return addSortAfterProjection(prepared);
}

function addTopK(prepared: PreparedBuild): QueryOutcome<void> {
  const { input, limits } = prepared.context;
  if (input.topK === undefined) return { ok: true, value: undefined };
  if (!safePositive(input.topK) || input.topK > limits.maxRows)
    return failure('query.budget', 'Top-K must be a bounded positive safe integer.', ['topK']);
  return addNode(
    prepared.state,
    'top-k',
    prepared.state.schema,
    { limit: input.topK },
    limits,
    [prepared.state.current],
    Math.min(prepared.state.cost.estimatedRows, input.topK),
  );
}

function processDelivery(prepared: PreparedBuild): QueryOutcome<void> {
  return addTopK(prepared);
}

export function buildPlan(
  input: RelationalQuery,
  catalog: Catalog,
  registry: FunctionRegistry,
  limits: QueryLimits = DEFAULT_LIMITS,
): QueryOutcome<LogicalPlan> {
  const prepared = prepareBuild(input, catalog, registry, limits);
  if (!prepared.ok) return prepared;
  const steps: readonly BuildStep[] = [
    addInitialScan,
    processRelationships,
    processPreProjection,
    processSelection,
    processDelivery,
  ];
  for (const step of steps) {
    const result = step(prepared.value);
    if (!result.ok) return result;
  }
  return finishPlan(prepared.value);
}
