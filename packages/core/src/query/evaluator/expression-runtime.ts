import type { Expression, Outcome, SemanticType } from '../../contracts/types.js';
import type { FunctionRegistry, FunctionSignature } from '../../expressions/types.js';
import { queryFunctionSignaturesV2, standardFunctionSignatures } from '../../expressions/registry.js';
import { isAggregateOperation } from '../../expressions/standard-signatures.js';
import type { PredicateSpec, QueryOutcome, QueryRow, QuerySchema, QueryValue } from '../types.js';
import { failure, relationKey, stable, unsupported, type EvalState } from './shared.js';
import { tick } from './execution-budget.js';
import { expressionSemanticType, expressionValueType, sourceField } from './expression-semantics.js';
import {
  compareValue,
  decimalAdd,
  decimalIsZero,
  decimalMultiply,
  inferredRuntimeType,
  isDecimal,
} from './value-utils.js';

const TRUSTED_LOCAL_SIGNATURES = new Map<string, FunctionSignature>(
  [...standardFunctionSignatures, ...queryFunctionSignaturesV2].map((signature) => [
    relationKey(signature.ref),
    signature,
  ]),
);

export function trustedLocalSignature(candidate: FunctionSignature): Outcome<FunctionSignature> {
  const expected = TRUSTED_LOCAL_SIGNATURES.get(relationKey(candidate.ref));
  if (expected === undefined)
    return unsupported(
      'function-runtime',
      `No trusted local implementation exists for ${candidate.ref.id}@${candidate.ref.revision}.`,
    );
  if (stable(candidate) !== stable(expected) || (candidate.realization !== 'local' && candidate.realization !== 'both'))
    return unsupported(
      'function-runtime',
      `The supplied registry signature for ${candidate.ref.id}@${candidate.ref.revision} is not the reviewed local realization.`,
    );
  return { ok: true, value: expected };
}

function rowValue(
  expression: Extract<Expression, { kind: 'field' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<QueryValue | undefined> {
  const field = sourceField(schema, expression);
  if (field === undefined) return failure('query.field', 'Field reference is unknown or ambiguous during evaluation.');
  return { ok: true, value: row[field.id] };
}

type ExpressionEvaluator = (expression: Expression) => QueryOutcome<QueryValue | undefined>;

export function evaluateConditional(
  state: EvalState,
  arguments_: readonly Expression[],
  evaluate: ExpressionEvaluator,
): QueryOutcome<QueryValue | undefined> {
  const charged = tick(state);
  if (!charged.ok) return charged;
  const [conditionExpression, whenTrue, whenFalse] = arguments_;
  if (conditionExpression === undefined || whenTrue === undefined || whenFalse === undefined)
    return failure('query.conditional-shape', 'Conditional expressions require a condition and two branches.');
  const condition = evaluate(conditionExpression);
  if (!condition.ok) return condition;
  if (condition.value === null || condition.value === undefined) return { ok: true, value: null };
  if (typeof condition.value !== 'boolean')
    return failure('query.conditional-type', 'Conditional condition did not evaluate to a boolean.');
  return evaluate(condition.value ? whenTrue : whenFalse);
}

function resolveExpressionSignature(
  expression: Extract<Expression, { kind: 'call' }>,
  registry: FunctionRegistry,
): Outcome<FunctionSignature> {
  const supplied = registry.resolve(expression.function);
  if (supplied === undefined)
    return failure('query.function', `Function ${relationKey(expression.function)} is not registered.`);
  return trustedLocalSignature(supplied);
}

function callArguments(
  state: EvalState,
  expression: Extract<Expression, { kind: 'call' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<QueryValue[]> {
  const values: QueryValue[] = [];
  for (const argument of expression.arguments) {
    const value = evaluateExpression(state, argument, row, schema);
    if (!value.ok) return value;
    values.push(value.value === undefined ? null : value.value);
  }
  return { ok: true, value: values };
}

function evaluateCallExpression(
  state: EvalState,
  expression: Extract<Expression, { kind: 'call' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<QueryValue | undefined> {
  const resolved = resolveExpressionSignature(expression, state.registry);
  if (!resolved.ok) return resolved;
  const signature = resolved.value;
  if (signature.ref.id === 'core.if')
    return evaluateConditional(state, expression.arguments, (child) => evaluateExpression(state, child, row, schema));
  if (isAggregateFunction(signature))
    return unsupported('aggregate-context', 'Aggregate functions require a group evaluation context.');
  const arguments_ = callArguments(state, expression, row, schema);
  if (!arguments_.ok) return arguments_;
  const types = expression.arguments.map((argument) => expressionSemanticType(argument, schema, state.registry));
  return evaluateCall(state, signature, arguments_.value, types);
}

function isAggregateFunction(signature: FunctionSignature): boolean {
  return isAggregateOperation(signature.operation);
}

export function evaluateExpression(
  state: EvalState,
  expression: Expression,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<QueryValue | undefined> {
  if (expression.kind === 'literal' || expression.kind === 'field') {
    const step = tick(state);
    if (!step.ok) return step;
  }
  switch (expression.kind) {
    case 'literal':
      return { ok: true, value: expression.value };
    case 'field':
      return rowValue(expression, row, schema);
    case 'definition':
      return unsupported(
        'definition-expression',
        'Definition expressions must be expanded by the authorized host before local evaluation.',
      );
    case 'call':
      return evaluateCallExpression(state, expression, row, schema);
  }
}

interface CallContext {
  readonly state: EvalState;
  readonly signature: FunctionSignature;
  readonly args: readonly QueryValue[];
  readonly argumentTypes: readonly (SemanticType | undefined)[];
}

type CallHandler = (context: CallContext) => QueryOutcome<QueryValue | undefined>;

function evaluateNullTest({ args }: CallContext): QueryOutcome<QueryValue | undefined> {
  return { ok: true, value: args[0] === null };
}

function evaluateCoalesce({ args }: CallContext): QueryOutcome<QueryValue | undefined> {
  return { ok: true, value: args.find((value) => value !== null) ?? null };
}

function evaluateEquality({ args, argumentTypes }: CallContext): QueryOutcome<QueryValue | undefined> {
  const [left, right] = args;
  if (left === null || right === null || left === undefined || right === undefined) return { ok: true, value: null };
  const type = argumentTypes[0] ?? argumentTypes[1] ?? inferredRuntimeType(left);
  const compared = compareValue(left, right, type);
  if (compared !== undefined) return { ok: true, value: compared === 0 };
  return failure('query.equal-type', 'Equality received incompatible runtime values.');
}

function evaluateTextIncludes({ args }: CallContext): QueryOutcome<QueryValue | undefined> {
  const [haystack, needle] = args;
  if (haystack === null || needle === null || haystack === undefined || needle === undefined)
    return { ok: true, value: null };
  if (typeof haystack !== 'string' || typeof needle !== 'string')
    return failure('query.search-type', 'Text search received a non-text value.');
  const normalizedHaystack = haystack.normalize('NFKC').toLowerCase();
  const normalizedNeedle = needle.normalize('NFKC').toLowerCase();
  return { ok: true, value: normalizedHaystack.includes(normalizedNeedle) };
}

function promoteInteger(value: Exclude<QueryValue, null>, type: SemanticType | undefined): Exclude<QueryValue, null> {
  if (isDecimal(value) || typeof value !== 'number' || type?.value !== 'integer' || !Number.isSafeInteger(value))
    return value;
  return { decimal: String(value) };
}

type DecimalOperand = { readonly decimal: string };
type DecimalOperator = (left: DecimalOperand, right: DecimalOperand) => DecimalOperand | undefined;

const DECIMAL_OPERATORS: Readonly<Record<string, DecimalOperator>> = {
  'core.multiply': decimalMultiply,
  'core.subtract': (left, right) => decimalAdd(left, right, -1n),
};

function evaluateDecimalArithmetic(
  id: string,
  left: DecimalOperand,
  right: DecimalOperand,
): QueryOutcome<QueryValue | undefined> {
  const operator = DECIMAL_OPERATORS[id] ?? decimalAdd;
  const result = operator(left, right);
  if (result !== undefined) return { ok: true, value: result };
  return failure('query.numeric-overflow', 'Decimal operation exceeded the bounded exact representation.');
}

function numberResult(context: CallContext, left: number, right: number): QueryOutcome<QueryValue | undefined> {
  const { state, signature, argumentTypes } = context;
  let result: number;
  switch (signature.ref.id) {
    case 'core.add':
      result = left + right;
      break;
    case 'core.subtract':
      result = left - right;
      break;
    default:
      result = left * right;
  }
  if (!Number.isFinite(result))
    return failure('query.numeric-overflow', 'Numeric operation produced a non-finite result.');
  const integerInputs = argumentTypes.length === 2 && argumentTypes.every((type) => type?.value === 'integer');
  if (integerInputs && !Number.isSafeInteger(result))
    return failure('query.numeric-overflow', 'Integer operation exceeded the exact safe integer representation.');
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(result))
    state.approximate = true;
  return { ok: true, value: result };
}

function evaluateNumericArithmetic(context: CallContext): QueryOutcome<QueryValue | undefined> {
  const [rawLeft, rawRight] = context.args;
  if (rawLeft === null || rawRight === null || rawLeft === undefined || rawRight === undefined)
    return { ok: true, value: null };
  let left: Exclude<QueryValue, null> = rawLeft;
  let right: Exclude<QueryValue, null> = rawRight;
  if (isDecimal(left)) right = promoteInteger(right, context.argumentTypes[1]);
  if (isDecimal(right)) left = promoteInteger(left, context.argumentTypes[0]);
  if (isDecimal(left) && isDecimal(right)) return evaluateDecimalArithmetic(context.signature.ref.id, left, right);
  if (typeof left === 'number' && typeof right === 'number') return numberResult(context, left, right);
  return failure('query.numeric-type', 'Numeric operation received incompatible runtime values.');
}

function zeroDenominator(state: EvalState, signature: FunctionSignature): QueryOutcome<QueryValue | undefined> {
  if (signature.zeroDenominator === 'error') return failure('query.zero-denominator', 'Division denominator is zero.');
  if (signature.zeroDenominator === 'unknown') {
    state.unknown.push({ field: 'division', reason: 'zero denominator' });
    return { ok: true, value: null };
  }
  return { ok: true, value: null };
}

function divisionOperands(left: QueryValue, right: QueryValue): readonly [number, number] | undefined {
  const numerator = isDecimal(left) ? Number(left.decimal) : left;
  const denominator = isDecimal(right) ? Number(right.decimal) : right;
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return undefined;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return undefined;
  return [numerator, denominator];
}

function evaluateDivision(context: CallContext): QueryOutcome<QueryValue | undefined> {
  const [left, right] = context.args;
  if (left === null || right === null || left === undefined || right === undefined) return { ok: true, value: null };
  const denominatorIsZero = isDecimal(right) ? decimalIsZero(right) : right === 0;
  if (denominatorIsZero) return zeroDenominator(context.state, context.signature);
  const operands = divisionOperands(left, right);
  if (operands === undefined) return failure('query.numeric-type', 'Division received incompatible runtime values.');
  const result = operands[0] / operands[1];
  if (!Number.isFinite(result)) return failure('query.numeric-overflow', 'Division produced a non-finite result.');
  context.state.approximate = true;
  return { ok: true, value: result };
}

const CALL_HANDLERS: Readonly<Record<string, CallHandler>> = {
  'core.is-null': evaluateNullTest,
  'core.coalesce': evaluateCoalesce,
  'core.equal': evaluateEquality,
  'core.text.includes-casefold': evaluateTextIncludes,
  'core.add': evaluateNumericArithmetic,
  'core.subtract': evaluateNumericArithmetic,
  'core.multiply': evaluateNumericArithmetic,
};

export function evaluateCall(
  state: EvalState,
  signature: FunctionSignature,
  args: readonly QueryValue[],
  argumentTypes: readonly (SemanticType | undefined)[] = [],
): QueryOutcome<QueryValue | undefined> {
  const charged = tick(state);
  if (!charged.ok) return charged;
  const context = { state, signature, args, argumentTypes };
  const handler = CALL_HANDLERS[signature.ref.id];
  if (handler !== undefined) return handler(context);
  if (signature.ref.id.startsWith('core.divide')) return evaluateDivision(context);
  return unsupported(
    'function-runtime',
    `No trusted local implementation exists for ${signature.ref.id}@${signature.ref.revision}.`,
  );
}

type Truth = 'true' | 'false' | 'unknown';

function evaluateLogicalGroup(
  state: EvalState,
  predicate: Extract<PredicateSpec, { op: 'and' | 'or' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const values: Truth[] = [];
  for (const child of predicate.predicates) {
    const value = evaluatePredicate(state, child, row, schema);
    if (!value.ok) return value;
    values.push(value.value);
  }
  if (predicate.op === 'and') {
    if (values.includes('false')) return { ok: true, value: 'false' };
    return { ok: true, value: values.includes('unknown') ? 'unknown' : 'true' };
  }
  if (values.includes('true')) return { ok: true, value: 'true' };
  return { ok: true, value: values.includes('unknown') ? 'unknown' : 'false' };
}

function evaluateNegation(
  state: EvalState,
  predicate: Extract<PredicateSpec, { op: 'not' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const result = evaluatePredicate(state, predicate.predicate, row, schema);
  if (!result.ok) return result;
  if (result.value === 'true') return { ok: true, value: 'false' };
  if (result.value === 'false') return { ok: true, value: 'true' };
  return { ok: true, value: 'unknown' };
}

function evaluateNullPredicate(
  state: EvalState,
  predicate: Extract<PredicateSpec, { op: 'is-null' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const value = evaluateExpression(state, predicate.expression, row, schema);
  if (!value.ok) return value;
  const isNull = value.value === null || value.value === undefined;
  const matches = predicate.negate ? !isNull : isNull;
  return { ok: true, value: matches ? 'true' : 'false' };
}

function comparisonType(
  expression: Expression,
  value: QueryValue,
  schema: QuerySchema,
  registry: FunctionRegistry,
): SemanticType | SemanticType['value'] {
  if (expression.kind === 'field') {
    const field = sourceField(schema, expression);
    if (field !== undefined) return field.type.value;
  }
  const expressionType = expressionValueType(expression, schema, registry);
  if (expressionType !== undefined) return expressionType;
  return inferredRuntimeType(value).value;
}

function comparisonResult(operator: Extract<PredicateSpec, { op: 'compare' }>['comparison'], value: number): boolean {
  switch (operator) {
    case 'eq':
      return value === 0;
    case 'ne':
      return value !== 0;
    case 'lt':
      return value < 0;
    case 'lte':
      return value <= 0;
    case 'gt':
      return value > 0;
    case 'gte':
      return value >= 0;
  }
}

function evaluateComparisonPredicate(
  state: EvalState,
  predicate: Extract<PredicateSpec, { op: 'compare' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const left = evaluateExpression(state, predicate.left, row, schema);
  if (!left.ok) return left;
  if (left.value === null || left.value === undefined) return { ok: true, value: 'unknown' };
  const right = evaluateExpression(state, predicate.right, row, schema);
  if (!right.ok) return right;
  const type = comparisonType(predicate.left, left.value, schema, state.registry);
  const compared = compareValue(left.value, right.value, type);
  if (compared === undefined) return { ok: true, value: 'unknown' };
  return { ok: true, value: comparisonResult(predicate.comparison, compared) ? 'true' : 'false' };
}

function evaluateInPredicate(
  state: EvalState,
  predicate: Extract<PredicateSpec, { op: 'in' }>,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const value = evaluateExpression(state, predicate.expression, row, schema);
  if (!value.ok) return value;
  if (value.value === null || value.value === undefined) return { ok: true, value: 'unknown' };
  const type =
    expressionValueType(predicate.expression, schema, state.registry) ?? inferredRuntimeType(value.value).value;
  let unknown = false;
  for (const candidate of predicate.values) {
    const right = evaluateExpression(state, candidate, row, schema);
    if (!right.ok) return right;
    if (right.value === null || right.value === undefined) {
      unknown = true;
      continue;
    }
    const compared = compareValue(value.value, right.value, type);
    if (compared === 0) return { ok: true, value: 'true' };
    if (compared === undefined) unknown = true;
  }
  return { ok: true, value: unknown ? 'unknown' : 'false' };
}

export function evaluatePredicate(
  state: EvalState,
  predicate: PredicateSpec,
  row: QueryRow,
  schema: QuerySchema,
): QueryOutcome<Truth> {
  const step = tick(state);
  if (!step.ok) return step;
  switch (predicate.op) {
    case 'and':
    case 'or':
      return evaluateLogicalGroup(state, predicate, row, schema);
    case 'not':
      return evaluateNegation(state, predicate, row, schema);
    case 'is-null':
      return evaluateNullPredicate(state, predicate, row, schema);
    case 'compare':
      return evaluateComparisonPredicate(state, predicate, row, schema);
    case 'in':
      return evaluateInPredicate(state, predicate, row, schema);
  }
}
