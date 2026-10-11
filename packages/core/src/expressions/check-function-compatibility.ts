import type { SemanticType } from '../contracts/types.js';
import { SCALAR_TYPE_VALUES } from '../contracts/scalars.js';
import { grainOf, sameStringSet } from '../semantics/type-utils.js';
import type { TypedExpression } from './types.js';

export function sameOrBroadcastGrain(left: TypedExpression, right: TypedExpression): boolean {
  return (
    sameStringSet(grainOf(left.type), grainOf(right.type)) || isBroadcastLiteral(left) || isBroadcastLiteral(right)
  );
}

export function isDimensionlessLiteral(argument: TypedExpression): boolean {
  return (
    argument.expression.kind === 'literal' &&
    argument.type.unit === undefined &&
    grainOf(argument.type).length === 0 &&
    argument.expression.value !== null
  );
}

export function scalarMultiplyUnitsAreSafe(left: TypedExpression, right: TypedExpression): boolean {
  const leftUnit = left.type.unit;
  const rightUnit = right.type.unit;
  if (leftUnit === undefined && rightUnit === undefined) return true;
  if (leftUnit !== undefined && rightUnit !== undefined) return false;
  const scalar = leftUnit === undefined ? left : right;
  return isDimensionlessLiteral(scalar);
}

export function sameComparisonValueKind(left: SemanticType, right: SemanticType): boolean {
  if (left.value !== right.value) return false;
  return SCALAR_TYPE_VALUES.has(left.value);
}

export function isConditionalScalar(argument: TypedExpression): boolean {
  return argument.expression.kind === 'literal' && grainOf(argument.type).length === 0;
}

function isBroadcastLiteral(argument: TypedExpression): boolean {
  return (
    argument.expression.kind === 'literal' && grainOf(argument.type).length === 0 && argument.expression.value !== null
  );
}
