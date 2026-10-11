import type { Expression, Outcome, SemanticType } from '../../contracts/types.js';
import type { FunctionSignature } from '../../expressions/types.js';
import { isAggregateOperation } from '../../expressions/standard-signatures.js';
import type { AggregateSpec, QueryOutcome, QueryRow, QueryValue } from '../types.js';
import { failure, relationKey, unsupported, type EvalGroup, type EvalState } from './shared.js';
import { tick } from './execution-budget.js';
import { evaluateCall, evaluateConditional, evaluateExpression, trustedLocalSignature } from './expression-runtime.js';
import { expressionSemanticType, expressionValueType } from './expression-semantics.js';
import { compareValue, isDecimal, scalarKey } from './value-utils.js';

type MissingPolicy = 'propagate' | 'exclude-pair' | 'reject';
const PERIOD_END_ERROR = 'Invalid.';
const MISSING_ERROR = 'Missing.';

interface AggregateContext {
  readonly state: EvalState;
  readonly item: AggregateSpec;
  readonly group: EvalGroup;
  readonly signature: FunctionSignature;
  readonly values: readonly (readonly QueryValue[])[];
  readonly policy: MissingPolicy | undefined;
}

function registeredAggregate(item: AggregateSpec, state: EvalState): Outcome<FunctionSignature> {
  const supplied = state.registry.resolve(item.function);
  if (supplied === undefined)
    return failure('query.function', `Function ${relationKey(item.function)} is not registered.`);
  return trustedLocalSignature(supplied);
}

function isAggregateFunction(signature: FunctionSignature): boolean {
  return isAggregateOperation(signature.operation);
}

function valuesForPolicy(
  values: readonly QueryValue[],
  policy: MissingPolicy | undefined,
): QueryOutcome<readonly QueryValue[] | null> {
  const missing = values.some((value) => value === null);
  if (policy === 'reject' && missing) return failure('query.missing-value', MISSING_ERROR);
  if (policy === 'propagate' && missing) return { ok: true, value: null };
  return { ok: true, value: policy === 'exclude-pair' && missing ? values.filter((value) => value !== null) : values };
}

function evaluateGroupArguments(state: EvalState, item: AggregateSpec, group: EvalGroup): QueryOutcome<QueryValue[][]> {
  const values: QueryValue[][] = item.arguments.map(() => []);
  for (const row of group.rows) {
    for (let index = 0; index < item.arguments.length; index += 1) {
      const expression = item.arguments[index]!;
      const value = evaluateExpression(state, expression, row, group.schema);
      if (!value.ok) return value;
      values[index]!.push(value.value === undefined ? null : value.value);
    }
  }
  return { ok: true, value: values };
}

function evaluateNonAggregateCall(
  state: EvalState,
  item: AggregateSpec,
  group: EvalGroup,
  signature: FunctionSignature,
  inheritedMissingPolicy?: MissingPolicy,
): QueryOutcome<QueryValue | undefined> {
  const arguments_: QueryValue[] = [];
  for (const expression of item.arguments) {
    const value = evaluateAggregateExpression(state, expression, group, inheritedMissingPolicy);
    if (!value.ok) return value;
    arguments_.push(value.value === undefined ? null : value.value);
  }
  const types = item.arguments.map((argument) => expressionSemanticType(argument, group.schema, state.registry));
  return evaluateCall(state, signature, arguments_, types);
}

const DIVIDE_SIGNATURES: Readonly<Record<NonNullable<FunctionSignature['zeroDenominator']>, string>> = {
  error: 'core.divide.error',
  unknown: 'core.divide.unknown',
  null: 'core.divide.null',
};

function resolveDivision(state: EvalState, policy: FunctionSignature['zeroDenominator']): Outcome<FunctionSignature> {
  const id = DIVIDE_SIGNATURES[policy ?? 'null'];
  const candidate = state.registry.resolve({ id, revision: '1' });
  if (candidate === undefined) return failure('query.function', `Function ${id}@1 is not registered.`);
  return trustedLocalSignature(candidate);
}

function ratioOfSums(context: AggregateContext): QueryOutcome<QueryValue | undefined> {
  const { state, values, item, group, signature, policy } = context;
  if (values.length < 2) return failure('query.aggregate', 'Inputs.');
  const numeratorExpression = item.arguments[0];
  const denominatorExpression = item.arguments[1];
  if ([numeratorExpression, denominatorExpression].includes(undefined)) return failure('query.aggregate', 'Inputs.');
  const pairs = values[0]!.map((numerator, index) => [numerator, values[1]?.[index] ?? null] as const);
  const missing = pairs.some(([numerator, denominator]) => numerator === null || denominator === null);
  if (missing) {
    if (policy === 'reject') return failure('query.missing-value', MISSING_ERROR);
    if (policy === 'propagate') return { ok: true, value: null };
  }
  const available =
    policy === 'exclude-pair'
      ? pairs.filter(([numerator, denominator]) => numerator !== null && denominator !== null)
      : pairs;
  const numerator = sumValues(
    state,
    available.map(([value]) => value),
    expressionSemanticType(numeratorExpression!, group.schema, state.registry),
    true,
  );
  const denominator = sumValues(
    state,
    available.map(([, value]) => value),
    expressionSemanticType(denominatorExpression!, group.schema, state.registry),
    true,
  );
  if (!numerator.ok) return numerator;
  if (!denominator.ok) return denominator;
  if (numerator.value === null || denominator.value === null) return { ok: true, value: null };
  const divide = resolveDivision(state, signature.zeroDenominator);
  if (!divide.ok) return divide;
  return evaluateCall(state, divide.value, [numerator.value, denominator.value]);
}

function meanOfRates(state: EvalState, inputs: readonly QueryValue[]): QueryOutcome<QueryValue | undefined> {
  let total = 0;
  let count = 0;
  for (const value of inputs) {
    if (typeof value === 'number') {
      total += value;
      count += 1;
    } else if (isDecimal(value)) {
      const converted = Number(value.decimal);
      if (!Number.isFinite(converted)) return failure('query.numeric-overflow', 'Mean overflow.');
      total += converted;
      count += 1;
    }
  }
  if (count === 0) return { ok: true, value: null };
  state.approximate = true;
  return { ok: true, value: total / count };
}

function unsupportedAggregate(context: AggregateContext): QueryOutcome<QueryValue | undefined> {
  const { signature } = context;
  return unsupported('aggregate-runtime', `No: ${signature.ref.id}@${signature.ref.revision}.`);
}

function periodValue(
  state: EvalState,
  expression: Expression,
  row: QueryRow,
  schema: EvalGroup['schema'],
): QueryOutcome<QueryValue> {
  const evaluated = evaluateExpression(state, expression, row, schema);
  if (!evaluated.ok) return evaluated;
  if (evaluated.value === undefined || evaluated.value === null)
    return failure('query.temporal-value', PERIOD_END_ERROR);
  return { ok: true, value: evaluated.value! };
}

function semiAdditiveGroup(state: EvalState, item: AggregateSpec, group: EvalGroup): QueryOutcome<EvalGroup> {
  const expression = item.semantics?.timeExpression;
  if (expression === undefined) return unsupported('semi-additive-time', 'Time.');
  const type = expressionSemanticType(expression, group.schema, state.registry) ?? 'date';
  let latest: QueryRow[] = [];
  let latestValue: QueryValue | undefined;
  for (const row of group.rows) {
    const evaluated = periodValue(state, expression, row, group.schema);
    if (!evaluated.ok) return evaluated;
    if (latestValue === undefined) {
      latest = [row];
      latestValue = evaluated.value;
      continue;
    }
    const compared = compareValue(evaluated.value, latestValue!, type);
    if (compared === undefined) return failure('query.temporal-value', PERIOD_END_ERROR);
    if (compared === 0) latest.push(row);
    else if (compared > 0) {
      latest = [row];
      latestValue = evaluated.value;
    }
  }
  return {
    ok: true,
    value: { keyRow: group.keyRow, rows: latest, schema: group.schema },
  };
}

function evaluateAggregateResult(context: AggregateContext): QueryOutcome<QueryValue | undefined> {
  const { signature, values, item, group, state } = context;
  if (signature.operation === 'ratio-of-sums') return ratioOfSums(context);
  const inputs = signature.operation === 'mean-of-rates' ? values.flat() : (values[0] ?? []);
  const available = valuesForPolicy(inputs, context.policy);
  if (!available.ok) return available;
  if (available.value === null) return { ok: true, value: null };
  if (signature.operation === 'mean-of-rates') return meanOfRates(state, available.value);
  switch (signature.ref.id) {
    case 'core.aggregate.count':
      return { ok: true, value: available.value.length };
    case 'core.aggregate.count-distinct': {
      const expression = item.arguments[0];
      const type = expression === undefined ? undefined : expressionValueType(expression, group.schema, state.registry);
      return { ok: true, value: new Set(available.value.map((value) => scalarKey(value, type))).size };
    }
    case 'core.aggregate.sum': {
      const expression = item.arguments[0];
      if (expression === undefined) return failure('query.aggregate', 'Input.');
      return sumValues(state, available.value, expressionSemanticType(expression, group.schema, state.registry));
    }
    default:
      return unsupportedAggregate(context);
  }
}

function aggregatePolicy(
  item: AggregateSpec,
  signature: FunctionSignature,
  inherited?: MissingPolicy,
): MissingPolicy | undefined {
  if (item.semantics !== undefined) return item.semantics.missingPolicy;
  if (inherited !== undefined) return inherited;
  if (signature.ref.id === 'core.aggregate.count' || signature.ref.id === 'core.aggregate.count-distinct')
    return 'exclude-pair';
  return signature.nullPolicy;
}

function evaluateResolvedAggregate(
  state: EvalState,
  item: AggregateSpec,
  group: EvalGroup,
  signature: FunctionSignature,
  inheritedMissingPolicy?: MissingPolicy,
): QueryOutcome<QueryValue | undefined> {
  const inheritedPolicy = item.semantics?.missingPolicy ?? inheritedMissingPolicy;
  const policy = aggregatePolicy(item, signature, inheritedMissingPolicy);
  const semiAdditive = item.semantics?.aggregation === 'semi-additive';
  if (signature.ref.id === 'core.if' && !semiAdditive) {
    const expression: Expression = { kind: 'call', function: item.function, arguments: item.arguments };
    return evaluateAggregateExpression(state, expression, group, inheritedPolicy);
  }
  const aggregate = isAggregateFunction(signature);
  if (![aggregate, semiAdditive].includes(true))
    return evaluateNonAggregateCall(state, item, group, signature, inheritedPolicy);
  const charged = tick(state);
  if (!charged.ok) return charged;
  const prepared: QueryOutcome<EvalGroup> = semiAdditive
    ? semiAdditiveGroup(state, item, group)
    : { ok: true, value: group };
  if (!prepared.ok) return prepared;
  if (!aggregate) return evaluateNonAggregateCall(state, item, prepared.value, signature, policy);
  const evaluated = evaluateGroupArguments(state, item, prepared.value);
  if (!evaluated.ok) return evaluated;
  return evaluateAggregateResult({ state, item, group: prepared.value, signature, values: evaluated.value, policy });
}

export function aggregateValues(
  state: EvalState,
  item: AggregateSpec,
  group: EvalGroup,
  inheritedMissingPolicy?: MissingPolicy,
  suppliedSignature?: FunctionSignature,
): QueryOutcome<QueryValue | undefined> {
  const resolved: Outcome<FunctionSignature> =
    suppliedSignature === undefined ? registeredAggregate(item, state) : { ok: true, value: suppliedSignature };
  if (!resolved.ok) return resolved;
  return evaluateResolvedAggregate(state, item, group, resolved.value, inheritedMissingPolicy);
}

function evaluateAggregateExpression(
  state: EvalState,
  expression: Expression,
  group: EvalGroup,
  inheritedMissingPolicy?: MissingPolicy,
): QueryOutcome<QueryValue | undefined> {
  if (expression.kind === 'literal') {
    const step = tick(state);
    if (!step.ok) return step;
    return { ok: true, value: expression.value };
  }
  if (expression.kind !== 'call') {
    if (group.rows.length !== 1)
      return unsupported(
        'aggregate-expression',
        'A non-aggregate expression cannot be evaluated over multiple group rows.',
      );
    return evaluateExpression(state, expression, group.rows[0]!, group.schema);
  }
  const item: AggregateSpec = {
    id: `nested-${expression.function.id}`,
    function: expression.function,
    arguments: expression.arguments,
  };
  const resolved = registeredAggregate(item, state);
  if (!resolved.ok) return resolved;
  if (resolved.value.ref.id === 'core.if')
    return evaluateConditional(state, expression.arguments, (child) =>
      evaluateAggregateExpression(state, child, group, inheritedMissingPolicy),
    );
  return evaluateResolvedAggregate(state, item, group, resolved.value, inheritedMissingPolicy);
}

function validatedAddition(state: EvalState): Outcome<FunctionSignature> {
  const candidate = state.registry.resolve({ id: 'core.add', revision: '1' });
  if (candidate === undefined) return failure('query.function', 'Function core.add@1 is not registered.');
  return trustedLocalSignature(candidate);
}

function sumIntegers(state: EvalState, values: readonly QueryValue[], allowWide: boolean): Outcome<QueryValue | null> {
  let total = 0n;
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      const charged = tick(state);
      if (!charged.ok) return charged;
    }
    const value = values[index];
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      return failure('query.numeric-overflow', 'Integer sum requires exact safe integer inputs.');
    total += BigInt(value);
  }
  if (values.length === 0) return { ok: true, value: null };
  if (total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= BigInt(Number.MIN_SAFE_INTEGER))
    return { ok: true, value: Number(total) };
  if (allowWide) return { ok: true, value: { decimal: String(total) } };
  return failure('query.numeric-overflow', 'Integer sum exceeded the exact safe integer representation.');
}

function sumOtherValues(
  state: EvalState,
  values: readonly QueryValue[],
  type: SemanticType | undefined,
  addition: FunctionSignature | undefined,
): Outcome<QueryValue | null> {
  let total: QueryValue | undefined;
  for (const value of values) {
    if (value === null) return { ok: true, value: null };
    if (typeof value === 'number' && !Number.isSafeInteger(value)) state.approximate = true;
    if (total === undefined) {
      total = value;
      continue;
    }
    if (addition === undefined) return failure('query.function', 'Function core.add@1 is not registered.');
    const added = evaluateCall(state, addition, [total, value], [type, type]);
    if (!added.ok) return added;
    total = added.value;
  }
  return { ok: true, value: total ?? null };
}

export function sumValues(
  state: EvalState,
  values: readonly QueryValue[],
  type: SemanticType | undefined,
  allowWide = false,
): Outcome<QueryValue | null> {
  const addition = values.length > 1 ? validatedAddition(state) : undefined;
  if (addition !== undefined && !addition.ok) return addition;
  const signature = addition?.ok ? addition.value : undefined;
  if (type?.value === 'integer') return sumIntegers(state, values, allowWide);
  return sumOtherValues(state, values, type, signature);
}
