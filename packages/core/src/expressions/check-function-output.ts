import type { Expression, Outcome, SemanticType } from '../contracts/types.js';
import { grainOf, numericOutput, sameUnit, validateSemanticType } from '../semantics/type-utils.js';
import { semanticFailure } from '../semantics/errors.js';
import type { EvaluationContext } from '../semantics/types.js';
import type { FunctionOutput, FunctionSignature, TypedExpression } from './types.js';
import { isDimensionlessLiteral } from './check-function-compatibility.js';
import { isAggregateOperation, isFractionalOperation } from './standard-signatures.js';

export function resolveFunctionOutput(
  output: FunctionOutput,
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<SemanticType> {
  if ('value' in output) return resolveExplicitOutput(output, signature.nullResult, args);
  if (output.kind === 'same-as' || output.kind === 'nullable-same-as')
    return resolveSameAsOutput(output, signature.nullResult, args);
  return resolveNumericOutput(output, signature, args, path);
}

export function createCheckedCallResult(
  node: Extract<Expression, { kind: 'call' }>,
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  context: EvaluationContext,
  output: SemanticType,
  path: readonly (string | number)[],
): Outcome<TypedExpression> {
  const outputCheck = validateSemanticType(output, path);
  if (!outputCheck.ok) return outputCheck;
  const entityId = resolveEntityId(args, path);
  if (!entityId.ok) return entityId;
  const resultType = adjustResultType(output, signature, args);
  const reducesGroup = reducesGroupGrain(signature.operation, context);
  const mayReturnNull = operationMayReturnNull(signature, reducesGroup);
  return {
    ok: true,
    value: {
      expression: node,
      type: {
        ...resultType,
        ...(reducesGroup ? { grain: [] } : {}),
        ...(mayReturnNull ? { nullable: true } : {}),
      },
      context,
      ...(entityId.value === undefined ? {} : { entityId: entityId.value }),
      aggregation: resultAggregation(signature),
      operation: signature.operation,
    },
  };
}

function resolveExplicitOutput(
  output: SemanticType,
  nullResult: FunctionSignature['nullResult'],
  args: readonly TypedExpression[],
): Outcome<SemanticType> {
  return { ok: true, value: { ...output, nullable: resolveNullability(output.nullable, nullResult, args) } };
}

function resolveSameAsOutput(
  output: Extract<FunctionOutput, { kind: 'same-as' | 'nullable-same-as' }>,
  nullResult: FunctionSignature['nullResult'],
  args: readonly TypedExpression[],
): Outcome<SemanticType> {
  const source: SemanticType = args[output.argument]?.type ?? { value: 'float', nullable: true };
  const nullable = output.kind === 'nullable-same-as' ? true : source.nullable;
  return {
    ok: true,
    value: { ...source, nullable: nullResult === 'non-null' ? false : nullable },
  };
}

function resolveNumericOutput(
  output: Extract<FunctionOutput, { kind: 'numeric' }>,
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<SemanticType> {
  const first = args[0]?.type;
  const second = args[1]?.type;
  if (hasUnspecifiedDivisionUnit(signature, output, first, second))
    return semanticFailure(
      'semantic.unit-division',
      'Division of unequal registered units requires an explicit registered output type.',
      [...path, 'function'],
    );
  const unit = inferredOutputUnit(output, signature.operation, args, first, second);
  const forceFloat = output.forceFloat === true || isFractionalOperation(signature.operation);
  const options = {
    ...(unit === undefined ? {} : { unit }),
    ...(forceFloat ? { forceFloat: true } : {}),
  };
  const result = numericOutput(args, options);
  return { ok: true, value: signature.nullResult === 'non-null' ? { ...result, nullable: false } : result };
}

function hasUnspecifiedDivisionUnit(
  signature: FunctionSignature,
  output: Extract<FunctionOutput, { kind: 'numeric' }>,
  first: SemanticType | undefined,
  second: SemanticType | undefined,
): boolean {
  return (
    signature.operation === 'divide' &&
    first !== undefined &&
    second !== undefined &&
    !sameUnit(first, second) &&
    output.unit === undefined
  );
}

function inferredOutputUnit(
  output: Extract<FunctionOutput, { kind: 'numeric' }>,
  operation: FunctionSignature['operation'],
  args: readonly TypedExpression[],
  first: SemanticType | undefined,
  second: SemanticType | undefined,
): SemanticType['unit'] | undefined {
  if (output.unit !== undefined) return output.unit;
  if (operation === 'divide' && second !== undefined && isDimensionlessLiteral(args[1]!)) return first?.unit;
  if (operation === 'divide' || operation === 'ratio-of-sums') return undefined;
  return args.find((argument) => argument.type.unit !== undefined)?.type.unit;
}

function resolveNullability(
  outputNullable: boolean,
  nullResult: FunctionSignature['nullResult'],
  args: readonly TypedExpression[],
): boolean {
  if (nullResult === 'non-null') return false;
  if (nullResult === 'preserve') return outputNullable;
  return outputNullable || args.some((argument) => argument.type.nullable);
}

function adjustResultType(
  output: SemanticType,
  signature: FunctionSignature,
  args: readonly TypedExpression[],
): SemanticType {
  switch (signature.operation) {
    case 'conditional': {
      const withGrain = inheritGrain(output, args);
      return { ...withGrain, nullable: resolveNullability(output.nullable, signature.nullResult, args) };
    }
    case 'comparison':
      return inheritGrain(output, args);
    case 'coalesce':
      return { ...output, nullable: args.every((argument) => argument.type.nullable) };
    default:
      return output;
  }
}

function inheritGrain(output: SemanticType, args: readonly TypedExpression[]): SemanticType {
  const inheritedGrain = args.find((argument) => grainOf(argument.type).length > 0)?.type.grain;
  return inheritedGrain === undefined ? output : { ...output, grain: inheritedGrain };
}

function reducesGroupGrain(operation: FunctionSignature['operation'], context: EvaluationContext): boolean {
  return context === 'group' && isAggregateOperation(operation);
}

function operationMayReturnNull(signature: FunctionSignature, reducesGroup: boolean): boolean {
  const hasUnspecifiedNullResult = signature.nullResult !== 'non-null' && signature.nullResult !== 'preserve';
  const nullableOperation =
    reducesGroup || signature.zeroDenominator === 'null' || signature.zeroDenominator === 'unknown';
  return hasUnspecifiedNullResult && nullableOperation;
}

function resolveEntityId(
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
): Outcome<string | undefined> {
  const identities = new Set<string>();
  for (const argument of args) {
    if (argument.entityId !== undefined) identities.add(argument.entityId);
  }
  if (identities.size > 1)
    return semanticFailure(
      'semantic.entity-grain',
      'An expression cannot combine fields from different entity bindings without an explicit registered relation.',
      [...path, 'arguments'],
    );
  return { ok: true, value: identities.values().next().value };
}

const OPERATION_AGGREGATION: Readonly<
  Partial<Record<FunctionSignature['operation'], FunctionSignature['aggregation']['kind']>>
> = {
  'ratio-of-sums': 'ratio-of-sums',
  'mean-of-rates': 'non-additive',
};

function resultAggregation(signature: FunctionSignature): FunctionSignature['aggregation']['kind'] {
  return OPERATION_AGGREGATION[signature.operation] ?? signature.aggregation.kind;
}
