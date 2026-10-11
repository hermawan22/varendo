import type { Expression, Outcome } from '../contracts/types.js';
import { semanticFailure } from '../semantics/errors.js';
import type { EvaluationContext } from '../semantics/types.js';
import { expressionReferenceKey } from './check-reference.js';
import { validateFunctionArity, validateFunctionArguments } from './check-function-constraints.js';
import { validateFunctionOperation } from './check-function-operations.js';
import { createCheckedCallResult, resolveFunctionOutput } from './check-function-output.js';
import type { FunctionSignature, TypedExpression } from './types.js';

export function checkCall(
  node: Extract<Expression, { kind: 'call' }>,
  signature: FunctionSignature,
  args: readonly TypedExpression[],
  path: readonly (string | number)[],
  requestedContext?: EvaluationContext,
): Outcome<TypedExpression> {
  const arity = validateFunctionArity(signature, args, path);
  if (arity !== undefined) return arity;
  const context = requestedContext ?? defaultContext(signature);
  if (!signature.contexts.includes(context))
    return semanticFailure(
      'semantic.function-context',
      `Function ${expressionReferenceKey(signature.ref)} is not registered for ${context} evaluation.`,
      [...path, 'function'],
    );
  const argumentCheck = validateFunctionArguments(signature, args, path);
  if (argumentCheck !== undefined) return argumentCheck;
  const operationCheck = validateFunctionOperation(signature, args, path);
  if (operationCheck !== undefined) return operationCheck;
  const output = resolveFunctionOutput(signature.output, signature, args, path);
  if (!output.ok) return output;
  return createCheckedCallResult(node, signature, args, context, output.value, path);
}

function defaultContext(signature: FunctionSignature): EvaluationContext {
  if (signature.operation === 'aggregate' && signature.contexts.includes('group')) return 'group';
  if (signature.contexts.includes('row')) return 'row';
  return signature.contexts[0] ?? 'row';
}
