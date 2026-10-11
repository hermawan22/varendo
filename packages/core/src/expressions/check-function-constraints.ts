import type { Outcome, SemanticType } from '../contracts/types.js';
import { compatibleType, isNumericType } from '../semantics/type-utils.js';
import { semanticFailure } from '../semantics/errors.js';
import type { FunctionSignature, TypedExpression, TypeConstraint } from './types.js';
import { expressionReferenceKey } from './check-reference.js';

export function validateFunctionArity(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  const required = signature.parameters.filter((parameter) => !parameter.optional).length;
  const maximum = signature.variadic === undefined ? signature.parameters.length : Number.POSITIVE_INFINITY;
  if (args.length < required || args.length > maximum)
    return semanticFailure(
      'semantic.arity',
      `Function ${expressionReferenceKey(signature.ref)} received ${args.length} arguments; expected ${required}${Number.isFinite(maximum) ? `-${maximum}` : '+'}.`,
      [...path, 'arguments'],
    );
  return undefined;
}

export function validateFunctionArguments(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const parameterFailure = validateFunctionArgument(signature, args, index, path);
    if (parameterFailure !== undefined) return parameterFailure;
  }
  if (hasMixedNumericPrecision(args))
    return semanticFailure(
      'semantic.precision-mismatch',
      'Decimal and floating-point arguments require an explicit registered cast.',
      [...path, 'arguments'],
    );
  return undefined;
}

function validateFunctionArgument(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  index: number,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  const parameter = signature.parameters[index] ?? signature.variadic;
  if (parameter === undefined)
    return semanticFailure('semantic.arity', 'Function argument has no declared parameter.', [
      ...path,
      'arguments',
      index,
    ]);
  const argument = args[index]!;
  if (signature.nullPolicy === 'reject' && argument.type.nullable)
    return semanticFailure(
      'semantic.nullability',
      `Function ${expressionReferenceKey(signature.ref)} rejects nullable arguments.`,
      [...path, 'arguments', index],
    );
  if (!matchesConstraint(argument.type, parameter.constraint, args, index))
    return semanticFailure(
      'semantic.type-mismatch',
      `Argument ${index + 1} is incompatible with function ${expressionReferenceKey(signature.ref)}.`,
      [...path, 'arguments', index],
    );
  return undefined;
}

function matchesConstraint(
  actual: SemanticType,
  constraint: TypeConstraint,
  args: readonly TypedExpression[],
  index: number,
): boolean {
  switch (constraint.kind) {
    case 'any':
      return allowsNull(constraint.allowNull, actual);
    case 'numeric':
      return isNumericType(actual) && allowsNull(constraint.allowNull, actual);
    case 'boolean':
      return actual.value === 'boolean' && allowsNull(constraint.allowNull, actual);
    case 'text':
      return actual.value === 'text' && allowsNull(constraint.allowNull, actual);
    case 'exact':
      return compatibleType(actual, constraint.type);
    case 'same-as': {
      const other = args[constraint.argument];
      return other !== undefined && compatibleType(actual, other.type) && index !== constraint.argument;
    }
  }
}

function allowsNull(allowNull: boolean | undefined, actual: SemanticType): boolean {
  return allowNull !== false || !actual.nullable;
}

function hasMixedNumericPrecision(args: readonly TypedExpression[]): boolean {
  const hasDecimal = args.some((argument) => argument.type.value === 'decimal');
  const hasFloat = args.some((argument) => argument.type.value === 'float');
  return hasDecimal && hasFloat;
}
