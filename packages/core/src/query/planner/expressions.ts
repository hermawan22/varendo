import type { Expression, SemanticType } from '../../contracts/types.js';
import { checkExpression } from '../../expressions/check.js';
import type { FunctionRegistry, TypedExpression } from '../../expressions/types.js';
import { sameTemporal, sameUnit } from '../../semantics/type-utils.js';
import type { PredicateSpec, QueryField, QueryOutcome, QuerySchema } from '../types.js';
import { failure, findField, PLAN_ENTITY, syntheticCatalog, syntheticId, unsupported } from './shared.js';

export interface ResolvedExpression {
  readonly original: Expression;
  readonly local: Expression;
  readonly typed: TypedExpression;
  readonly field?: QueryField;
}

export function fieldExpression(entity: string, field: string): Expression {
  return { kind: 'field', entity, ref: field };
}

export function literalExpression(value: unknown, type: SemanticType): Expression {
  return { kind: 'literal', value: value as never, type };
}

function mapExpression(
  expression: Expression,
  schema: QuerySchema,
  path: readonly (string | number)[] = [],
): QueryOutcome<{ readonly expression: Expression; readonly field?: QueryField }> {
  switch (expression.kind) {
    case 'field': {
      const field = findField(schema, expression);
      if (field === undefined)
        return failure('query.field', 'Field reference is unknown or ambiguous in the current relation.', path);
      const index = schema.fields.findIndex((candidate) => candidate.id === field.id);
      return {
        ok: true,
        value: { expression: { kind: 'field', ref: syntheticId(index), entity: PLAN_ENTITY }, field },
      };
    }
    case 'literal':
      return { ok: true, value: { expression } };
    case 'definition':
      return unsupported(
        'definition-expression',
        'Meaning definitions must be resolved by the authorized planner before local evaluation.',
        ['Register a concrete expression definition.'],
        path,
      );
    case 'call': {
      const args: Expression[] = [];
      for (let index = 0; index < expression.arguments.length; index += 1) {
        const mapped = mapExpression(expression.arguments[index]!, schema, [...path, 'arguments', index]);
        if (!mapped.ok) return mapped;
        args.push(mapped.value.expression);
      }
      return { ok: true, value: { expression: { kind: 'call', function: expression.function, arguments: args } } };
    }
  }
}

export function resolveExpression(
  expression: Expression,
  schema: QuerySchema,
  registry: FunctionRegistry,
  context: 'row' | 'group' | 'window' = 'row',
): QueryOutcome<ResolvedExpression> {
  const mapped = mapExpression(expression, schema);
  if (!mapped.ok) return mapped;
  const catalog = syntheticCatalog(schema, registry);
  const checked = checkExpression(mapped.value.expression, {
    catalog,
    registry,
    entityId: PLAN_ENTITY,
    evaluationContext: context,
  });
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: {
      original: expression,
      local: mapped.value.expression,
      typed: checked.value,
      ...(mapped.value.field === undefined ? {} : { field: mapped.value.field }),
    },
  };
}

export function sameTypeFamily(left: SemanticType, right: SemanticType): boolean {
  return left.value === right.value && sameUnit(left, right) && sameTemporal(left, right);
}

function validatePredicateGroup(
  predicates: readonly PredicateSpec[],
  schema: QuerySchema,
  registry: FunctionRegistry,
  path: readonly (string | number)[],
): QueryOutcome<void> {
  for (let index = 0; index < predicates.length; index += 1) {
    const checked = validatePredicate(predicates[index]!, schema, registry, [...path, 'predicates', index]);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateComparisonPredicate(
  predicate: Extract<PredicateSpec, { op: 'compare' }>,
  schema: QuerySchema,
  registry: FunctionRegistry,
  path: readonly (string | number)[],
): QueryOutcome<void> {
  const left = resolveExpression(predicate.left, schema, registry);
  if (!left.ok) return left;
  const right = resolveExpression(predicate.right, schema, registry);
  if (!right.ok) return right;
  if (sameTypeFamily(left.value.typed.type, right.value.typed.type)) return { ok: true, value: undefined };
  return failure('query.predicate-type', 'Comparison operands must have the same semantic type and unit.', [
    ...path,
    'right',
  ]);
}

function validateMembershipPredicate(
  predicate: Extract<PredicateSpec, { op: 'in' }>,
  schema: QuerySchema,
  registry: FunctionRegistry,
  path: readonly (string | number)[],
): QueryOutcome<void> {
  const left = resolveExpression(predicate.expression, schema, registry);
  if (!left.ok) return left;
  for (let index = 0; index < predicate.values.length; index += 1) {
    const value = resolveExpression(predicate.values[index]!, schema, registry);
    if (!value.ok) return value;
    if (!sameTypeFamily(left.value.typed.type, value.value.typed.type))
      return failure('query.predicate-type', 'Membership values must have the same semantic type and unit.', [
        ...path,
        'values',
        index,
      ]);
  }
  return { ok: true, value: undefined };
}

export function validatePredicate(
  predicate: PredicateSpec,
  schema: QuerySchema,
  registry: FunctionRegistry,
  path: readonly (string | number)[] = [],
): QueryOutcome<void> {
  switch (predicate.op) {
    case 'and':
    case 'or':
      return validatePredicateGroup(predicate.predicates, schema, registry, path);
    case 'not':
      return validatePredicate(predicate.predicate, schema, registry, [...path, 'predicate']);
    case 'compare':
      return validateComparisonPredicate(predicate, schema, registry, path);
    case 'is-null': {
      const checked = resolveExpression(predicate.expression, schema, registry);
      return checked.ok ? { ok: true, value: undefined } : checked;
    }
    case 'in':
      return validateMembershipPredicate(predicate, schema, registry, path);
  }
}
