import { parseExpression } from '../contracts/parse.js';
import type { Outcome } from '../contracts/types.js';
import type { TypedExpression } from './types.js';
import { prepareExpressionContext } from './check-context.js';
import type { ExpressionCheckContext } from './check-context.js';
import { checkExpressionTree } from './check-traversal.js';

export type { ExpressionCheckContext } from './check-context.js';

export function checkExpression(input: unknown, context: ExpressionCheckContext): Outcome<TypedExpression> {
  const parsed = parseExpression(input);
  if (!parsed.ok) return parsed;
  const prepared = prepareExpressionContext(context);
  if (!prepared.ok) return prepared;
  return checkExpressionTree(parsed.value, context, prepared.value);
}
