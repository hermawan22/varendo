import type {
  Catalog,
  Expression,
  MeaningDefinition,
  Outcome,
  SemanticType,
  VersionRef,
} from '../../contracts/types.js';
import { sameTemporal, sameUnit, validateSemanticType } from '../../semantics/type-utils.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { GroupKeySpec, PredicateSpec, QuerySchema } from '../types.js';
import { sourceField } from './expression-semantics.js';
import { entity, failure, isRecord, planId, relationKey, stable, type PlanRecord } from './shared.js';
import { scanSchema } from '../planner/shared.js';

const FIELD_ROLES = new Set(['identity', 'attribute', 'dimension', 'measure', 'time']);
const AGGREGATE_BINDING_ERROR = 'Invalid.';

export function catalogSchema(catalog: Catalog, entityId: string): QuerySchema | undefined {
  const definition = entity(catalog, entityId);
  return definition === undefined ? undefined : scanSchema(definition);
}

function validFieldSource(source: unknown, catalog: Catalog): boolean {
  if (source === undefined) return true;
  if (!isRecord(source) || !planId(source.entity) || !planId(source.field)) return false;
  const definition = entity(catalog, source.entity);
  return definition !== undefined && definition.fields.some((field) => field.id === source.field);
}

function validSchemaField(
  candidate: unknown,
  catalog: Catalog,
  ids: Set<string>,
): candidate is Record<string, unknown> {
  if (
    !isRecord(candidate) ||
    !planId(candidate.id) ||
    ids.has(candidate.id) ||
    typeof candidate.label !== 'string' ||
    !isRecord(candidate.type) ||
    !FIELD_ROLES.has(String(candidate.role)) ||
    !validateSemanticType(candidate.type as SemanticType).ok ||
    !validFieldSource(candidate.source, catalog)
  )
    return false;
  ids.add(candidate.id);
  return true;
}

function fieldsAreDeclared(values: readonly unknown[], ids: ReadonlySet<string>): boolean {
  return values.every((id) => typeof id === 'string' && ids.has(id));
}

export function validQuerySchema(value: unknown, catalog: Catalog): value is QuerySchema {
  if (!isRecord(value) || !Array.isArray(value.fields) || !Array.isArray(value.identity) || !Array.isArray(value.grain))
    return false;
  const ids = new Set<string>();
  if (!value.fields.every((field) => validSchemaField(field, catalog, ids))) return false;
  return fieldsAreDeclared(value.identity, ids) && fieldsAreDeclared(value.grain, ids);
}

export function planFields(schema: QuerySchema): Set<string> {
  return new Set(schema.fields.map((field) => field.id));
}

export function compatibleSemanticTypes(left: SemanticType, right: SemanticType): boolean {
  return left.value === right.value && sameUnit(left, right) && sameTemporal(left, right);
}

function validateFieldExpression(
  schema: QuerySchema,
  expression: Extract<Expression, { kind: 'field' }>,
): Outcome<void> {
  if (sourceField(schema, expression) !== undefined) return { ok: true, value: undefined };
  return failure('query.plan', 'Plan contains an unknown or ambiguous field expression.');
}

function validateCallExpression(
  schema: QuerySchema,
  expression: Extract<Expression, { kind: 'call' }>,
  registry: FunctionRegistry,
  depth: number,
): Outcome<void> {
  if (
    !planId(expression.function.id) ||
    !planId(expression.function.revision) ||
    registry.resolve(expression.function) === undefined
  )
    return failure('query.plan', `Plan references an unregistered function ${relationKey(expression.function)}.`);
  for (const argument of expression.arguments) {
    const checked = expressionFields(schema, argument, registry, depth + 1);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

export function expressionFields(
  schema: QuerySchema,
  expression: Expression,
  registry: FunctionRegistry,
  depth = 0,
): Outcome<void> {
  if (depth > 64) return failure('query.plan', 'Plan expression depth exceeds the bounded evaluator limit.');
  switch (expression.kind) {
    case 'field':
      return validateFieldExpression(schema, expression);
    case 'literal':
      return validateSemanticType(expression.type).ok
        ? { ok: true, value: undefined }
        : failure('query.plan', 'Plan contains an invalid literal type.');
    case 'definition':
      return failure('query.plan', 'Definition expressions must be expanded before execution.');
    case 'call':
      return validateCallExpression(schema, expression, registry, depth);
  }
}

function sameExpression(schema: QuerySchema, left: Expression, right: Expression, depth = 0): boolean {
  if (depth > 64 || left.kind !== right.kind) return false;
  if (left.kind === 'field' && right.kind === 'field') {
    const leftField = sourceField(schema, left);
    const rightField = sourceField(schema, right);
    return leftField !== undefined && leftField.id === rightField?.id;
  }
  if (left.kind !== 'call' || right.kind !== 'call') return stable(left) === stable(right);
  return (
    relationKey(left.function) === relationKey(right.function) &&
    left.arguments.length === right.arguments.length &&
    left.arguments.every((argument, index) => sameExpression(schema, argument, right.arguments[index]!, depth + 1))
  );
}

function matchesMeaningExpression(item: PlanRecord, meaning: MeaningDefinition, schema: QuerySchema): boolean {
  if (meaning.implementation.kind !== 'expression') return false;
  const actual: Expression = {
    kind: 'call',
    function: item.function as VersionRef,
    arguments: item.arguments as Expression[],
  };
  return sameExpression(schema, meaning.implementation.expression, actual);
}

function semanticMeaning(binding: PlanRecord, meanings: readonly MeaningDefinition[]): MeaningDefinition | undefined {
  if (
    Object.keys(binding).length !== (binding.timeExpression === undefined ? 5 : 6) ||
    !isRecord(binding.meaning) ||
    !planId(binding.meaning.id) ||
    !planId(binding.meaning.revision) ||
    !Array.isArray(binding.aggregationDimensions) ||
    !binding.aggregationDimensions.every(planId)
  )
    return undefined;
  return meanings.find((candidate) => relationKey(candidate) === relationKey(binding.meaning as VersionRef));
}

function matchesSemanticBinding(
  item: PlanRecord,
  binding: PlanRecord,
  meaning: MeaningDefinition,
  schema: QuerySchema,
): boolean {
  return (
    item.id === meaning.id &&
    matchesMeaningExpression(item, meaning, schema) &&
    binding.aggregation === meaning.aggregation &&
    stable(binding.aggregationDimensions) === stable(meaning.aggregationDimensions) &&
    binding.missingPolicy === meaning.missingPolicy &&
    stable(binding.output) === stable(meaning.output)
  );
}

function validateSemanticTime(
  binding: PlanRecord,
  meaning: MeaningDefinition,
  schema: QuerySchema,
  groupKeys: readonly GroupKeySpec[],
): Outcome<void> {
  if (meaning.aggregation !== 'semi-additive')
    return binding.timeExpression === undefined
      ? { ok: true, value: undefined }
      : failure('query.plan', AGGREGATE_BINDING_ERROR);
  const timeExpression = binding.timeExpression;
  const timeField =
    isRecord(timeExpression) && timeExpression.kind === 'field'
      ? sourceField(schema, timeExpression as Extract<Expression, { kind: 'field' }>)
      : undefined;
  if (timeField === undefined || !['date', 'instant'].includes(timeField.type.value))
    return failure('query.plan', AGGREGATE_BINDING_ERROR);
  if (
    !groupKeys.some(
      (key) => key.expression.kind === 'field' && sameExpression(schema, key.expression, timeExpression as Expression),
    )
  )
    return failure('query.plan', AGGREGATE_BINDING_ERROR);
  return { ok: true, value: undefined };
}

function validateAggregationDimensions(
  meaning: MeaningDefinition,
  schema: QuerySchema,
  groupKeys: readonly GroupKeySpec[],
): Outcome<void> {
  const represented = meaning.aggregationDimensions.every((dimension) =>
    groupKeys.some((key) => {
      if (key.id !== dimension || key.expression.kind !== 'field') return false;
      return sourceField(schema, key.expression)?.source?.field === dimension;
    }),
  );
  return represented ? { ok: true, value: undefined } : failure('query.plan', AGGREGATE_BINDING_ERROR);
}

export function validateAggregateSemantics(
  item: PlanRecord,
  schema: QuerySchema,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  groupKeys: readonly GroupKeySpec[],
): Outcome<void> {
  if (
    Object.hasOwn(item, 'aggregation') ||
    Object.hasOwn(item, 'missingPolicy') ||
    Object.hasOwn(item, 'timeExpression')
  )
    return failure('query.plan', AGGREGATE_BINDING_ERROR);
  const meanings = [...catalog.meanings, ...definitions];
  if (item.semantics === undefined) {
    return meanings.some((meaning) => matchesMeaningExpression(item, meaning, schema))
      ? failure('query.plan', AGGREGATE_BINDING_ERROR)
      : { ok: true, value: undefined };
  }
  if (!isRecord(item.semantics)) return failure('query.plan', AGGREGATE_BINDING_ERROR);
  const binding = item.semantics;
  const meaning = semanticMeaning(binding, meanings);
  if (meaning === undefined || !matchesSemanticBinding(item, binding, meaning, schema))
    return failure('query.plan', AGGREGATE_BINDING_ERROR);
  const time = validateSemanticTime(binding, meaning, schema, groupKeys);
  if (!time.ok) return time;
  return validateAggregationDimensions(meaning, schema, groupKeys);
}

function validatePredicateChildren(
  schema: QuerySchema,
  predicates: readonly PredicateSpec[],
  registry: FunctionRegistry,
  depth: number,
): Outcome<void> {
  for (const predicate of predicates) {
    const checked = predicateFields(schema, predicate, registry, depth + 1);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validatePredicateExpressions(
  schema: QuerySchema,
  expressions: readonly Expression[],
  registry: FunctionRegistry,
  depth: number,
): Outcome<void> {
  for (const expression of expressions) {
    const checked = expressionFields(schema, expression, registry, depth + 1);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

export function predicateFields(
  schema: QuerySchema,
  predicate: PredicateSpec,
  registry: FunctionRegistry,
  depth = 0,
): Outcome<void> {
  if (depth > 64) return failure('query.plan', 'Plan predicate depth exceeds the bounded evaluator limit.');
  switch (predicate.op) {
    case 'and':
    case 'or':
      return validatePredicateChildren(schema, predicate.predicates, registry, depth);
    case 'not':
      return predicateFields(schema, predicate.predicate, registry, depth + 1);
    case 'compare':
      return validatePredicateExpressions(schema, [predicate.left, predicate.right], registry, depth);
    case 'is-null':
      return expressionFields(schema, predicate.expression, registry, depth + 1);
    case 'in':
      return validatePredicateExpressions(schema, [predicate.expression, ...predicate.values], registry, depth);
  }
}
