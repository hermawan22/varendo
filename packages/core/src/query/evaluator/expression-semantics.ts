import type { Expression, SemanticType } from '../../contracts/types.js';
import type { FunctionOutput, FunctionRegistry, FunctionSignature } from '../../expressions/types.js';
import { isFractionalOperation } from '../../expressions/standard-signatures.js';
import type { QueryField, QuerySchema } from '../types.js';

export function sourceField(
  schema: QuerySchema,
  expression: Extract<Expression, { kind: 'field' }>,
): QueryField | undefined {
  const candidates = schema.fields.filter((field) => {
    if (expression.entity === undefined) return field.id === expression.ref || field.source?.field === expression.ref;
    return field.source?.entity === expression.entity && field.source.field === expression.ref;
  });
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

function firstSemanticType(arguments_: readonly (SemanticType | undefined)[]): SemanticType | undefined {
  return arguments_.find((argument): argument is SemanticType => argument !== undefined);
}

function compoundValueType(
  signature: FunctionSignature,
  arguments_: readonly (SemanticType | undefined)[],
): SemanticType['value'] {
  const outputForcesFloat =
    !('value' in signature.output) && signature.output.kind === 'numeric' && signature.output.forceFloat === true;
  const forcesFloat =
    outputForcesFloat ||
    isFractionalOperation(signature.operation) ||
    arguments_.some((argument) => argument?.value === 'float');
  if (forcesFloat) return 'float';
  if (arguments_.some((argument) => argument?.value === 'decimal')) return 'decimal';
  return 'integer';
}

function compoundSemanticType(
  signature: FunctionSignature,
  arguments_: readonly (SemanticType | undefined)[],
): SemanticType {
  const first = firstSemanticType(arguments_);
  const unit = outputUnit(signature.output) ?? first?.unit;
  return {
    value: compoundValueType(signature, arguments_),
    nullable: arguments_.some((argument) => argument?.nullable),
    ...(unit === undefined ? {} : { unit }),
  };
}

function outputUnit(output: FunctionOutput): SemanticType['unit'] | undefined {
  if ('value' in output) return output.unit;
  if (output.kind === 'numeric') return output.unit;
  return undefined;
}

function callSemanticType(
  expression: Extract<Expression, { kind: 'call' }>,
  schema: QuerySchema,
  registry: FunctionRegistry,
): SemanticType | undefined {
  const signature = registry.resolve(expression.function);
  if (signature === undefined) return undefined;
  const arguments_ = expression.arguments.map((argument) => expressionSemanticType(argument, schema, registry));
  if ('value' in signature.output) {
    return {
      ...signature.output,
      nullable:
        signature.nullResult === 'non-null'
          ? false
          : signature.output.nullable || arguments_.some((argument) => argument?.nullable),
    };
  }
  if (signature.output.kind === 'same-as' || signature.output.kind === 'nullable-same-as') {
    const source = arguments_[signature.output.argument];
    if (source === undefined) return undefined;
    const nullable = signature.output.kind === 'nullable-same-as' ? true : source.nullable;
    return { ...source, nullable };
  }
  return compoundSemanticType(signature, arguments_);
}

export function expressionSemanticType(
  expression: Expression,
  schema: QuerySchema,
  registry: FunctionRegistry,
): SemanticType | undefined {
  switch (expression.kind) {
    case 'field':
      return sourceField(schema, expression)?.type;
    case 'literal':
      return expression.type;
    case 'definition':
      return undefined;
    case 'call':
      return callSemanticType(expression, schema, registry);
  }
}

export function expressionValueType(
  expression: Expression,
  schema: QuerySchema,
  registry: FunctionRegistry,
): SemanticType['value'] | undefined {
  return expressionSemanticType(expression, schema, registry)?.value;
}
