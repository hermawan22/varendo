import type { Outcome } from '../contracts/types.js';
import { sameTemporal, sameUnit } from '../semantics/type-utils.js';
import { semanticFailure } from '../semantics/errors.js';
import type { FunctionSignature, TypedExpression } from './types.js';
import { expressionReferenceKey } from './check-reference.js';
import {
  isConditionalScalar,
  sameComparisonValueKind,
  sameOrBroadcastGrain,
  scalarMultiplyUnitsAreSafe,
} from './check-function-compatibility.js';

export function validateFunctionOperation(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  switch (signature.operation) {
    case 'arithmetic':
      return validateArithmetic(signature, args, path);
    case 'divide':
      return validateDivision(signature, args, path);
    case 'ratio-of-sums':
      return validateRatioOfSums(args, path);
    case 'mean-of-rates':
      return validateMeanOfRates(args, path);
    case 'comparison':
      return validateComparison(args, path);
    case 'conditional':
      return validateConditional(args, path);
    default:
      return undefined;
  }
}

function validateArithmetic(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length < 2) return undefined;
  const left = args[0]!;
  const right = args[1]!;
  if (!sameOrBroadcastGrain(left, right)) return functionGrainFailure(signature, path, 1);
  const unitRule = signature.unitRule ?? 'same';
  if (unitRule === 'same' && !sameUnit(left.type, right.type))
    return semanticFailure(
      'semantic.unit-mismatch',
      `Function ${expressionReferenceKey(signature.ref)} received incompatible units.`,
      [...path, 'arguments', 1],
    );
  if (unitRule === 'scalar-multiply' && !hasExplicitOutput(signature) && !scalarMultiplyUnitsAreSafe(left, right))
    return semanticFailure(
      'semantic.unit-multiply',
      'Multiplication of unit-bearing values requires a dimensionless literal scalar or an explicit registered output unit.',
      [...path, 'function'],
    );
  return undefined;
}

function validateDivision(
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length < 2 || sameOrBroadcastGrain(args[0]!, args[1]!)) return undefined;
  return functionGrainFailure(signature, path, 1);
}

function validateRatioOfSums(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length !== 2) return undefined;
  if (!sameOrBroadcastGrain(args[0]!, args[1]!))
    return semanticFailure(
      'semantic.grain-mismatch',
      'Ratio-of-sums requires numerator and denominator at the same grain.',
      [...path, 'arguments', 1],
    );
  if (!sameUnit(args[0]!.type, args[1]!.type))
    return semanticFailure(
      'semantic.unit-mismatch',
      'Ratio-of-sums requires numerator and denominator in the same registered unit.',
      [...path, 'arguments', 1],
    );
  return undefined;
}

function validateMeanOfRates(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length === 0)
    return semanticFailure('semantic.arity', 'Mean-of-rates requires at least one rate.', [...path, 'arguments']);
  for (let index = 1; index < args.length; index += 1) {
    const failure = validateRatePair(args[0]!, args[index]!, index, path);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function validateRatePair(
  first: TypedExpression,
  current: TypedExpression,
  index: number,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (!sameUnit(first.type, current.type))
    return semanticFailure('semantic.unit-mismatch', 'Mean-of-rates requires rates in the same registered unit.', [
      ...path,
      'arguments',
      index,
    ]);
  if (!sameOrBroadcastGrain(first, current))
    return semanticFailure('semantic.grain-mismatch', 'Mean-of-rates requires rates at the same grain.', [
      ...path,
      'arguments',
      index,
    ]);
  return undefined;
}

function validateComparison(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length < 2) return undefined;
  for (let index = 1; index < args.length; index += 1) {
    const failure = validateComparisonPair(args[0]!, args[index]!, index, path);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function validateComparisonPair(
  left: TypedExpression,
  right: TypedExpression,
  index: number,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (!sameComparisonValueKind(left.type, right.type))
    return semanticFailure('semantic.type-mismatch', 'Comparison requires values of the same semantic type family.', [
      ...path,
      'arguments',
      index,
    ]);
  if (!sameUnit(left.type, right.type))
    return semanticFailure('semantic.unit-mismatch', 'Comparison requires the same registered unit.', [
      ...path,
      'arguments',
      index,
    ]);
  if (!sameOrBroadcastGrain(left, right))
    return semanticFailure('semantic.grain-mismatch', 'Comparison requires the same grain.', [
      ...path,
      'arguments',
      index,
    ]);
  if (!sameTemporal(left.type, right.type))
    return semanticFailure(
      'semantic.temporal-mismatch',
      'Comparison requires compatible calendar, timezone and temporal grain.',
      [...path, 'arguments', index],
    );
  return undefined;
}

function validateConditional(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (args.length !== 3 || args[0]!.type.value !== 'boolean')
    return semanticFailure(
      'semantic.conditional-shape',
      'Conditional expressions require a boolean condition and two branches.',
      [...path, 'arguments'],
    );
  const branchFailure = validateConditionalBranches(args[1]!, args[2]!, path);
  if (branchFailure !== undefined) return branchFailure;
  return validateConditionalGrains(args, path);
}

function validateConditionalBranches(
  thenBranch: TypedExpression,
  elseBranch: TypedExpression,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (thenBranch.type.value !== elseBranch.type.value)
    return semanticFailure('semantic.type-mismatch', 'Conditional branches require the same value type.', [
      ...path,
      'arguments',
      2,
    ]);
  if (!sameUnit(thenBranch.type, elseBranch.type))
    return semanticFailure('semantic.unit-mismatch', 'Conditional branches require the same registered unit.', [
      ...path,
      'arguments',
      2,
    ]);
  if (!sameTemporal(thenBranch.type, elseBranch.type))
    return semanticFailure('semantic.temporal-mismatch', 'Conditional branches require the same temporal policy.', [
      ...path,
      'arguments',
      2,
    ]);
  return undefined;
}

function validateConditionalGrains(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  for (let index = 0; index < args.length; index += 1) {
    for (let other = index + 1; other < args.length; other += 1) {
      if (!conditionalGrainsMatch(args[index]!, args[other]!))
        return semanticFailure('semantic.grain-mismatch', 'Conditional arguments require compatible grains.', [
          ...path,
          'arguments',
          other,
        ]);
    }
  }
  return undefined;
}

function conditionalGrainsMatch(left: TypedExpression, right: TypedExpression): boolean {
  return sameOrBroadcastGrain(left, right) || isConditionalScalar(left) || isConditionalScalar(right);
}

function hasExplicitOutput(signature: FunctionSignature): boolean {
  const output = signature.output;
  return 'value' in output || (output.kind === 'numeric' && output.unit !== undefined);
}

function functionGrainFailure(
  signature: FunctionSignature,
  path: readonly (string | number)[],
  argumentIndex: number,
): Outcome<never> {
  return semanticFailure(
    'semantic.grain-mismatch',
    `Function ${expressionReferenceKey(signature.ref)} received incompatible grains.`,
    [...path, 'arguments', argumentIndex],
  );
}
