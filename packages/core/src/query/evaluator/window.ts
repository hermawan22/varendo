import type { Outcome } from '../../contracts/types.js';
import type { FunctionSignature } from '../../expressions/types.js';
import type { QueryOutcome, QueryRow, QueryValue, QuerySchema, WindowSpec } from '../types.js';
import { failure, relationKey, unsupported, type EvalRelation, type EvalState } from './shared.js';
import { outputBytes, outputValue, tick } from './execution-budget.js';
import { evaluateExpression, trustedLocalSignature } from './expression-runtime.js';
import { expressionSemanticType, expressionValueType, sourceField } from './expression-semantics.js';
import { compareRows } from './ordering.js';
import { scalarKey } from './value-utils.js';
import { sumValues } from './aggregation.js';

interface WindowRuntimeContext {
  readonly state: EvalState;
  readonly item: WindowSpec;
  readonly signature: FunctionSignature;
  readonly rows: readonly QueryRow[];
  readonly indexes: readonly number[];
  readonly position: number;
  readonly schema: QuerySchema;
}

type WindowEvaluator = (context: WindowRuntimeContext) => QueryOutcome<QueryValue | undefined>;

function cloneRows(rows: readonly QueryRow[], state: EvalState): Outcome<Record<string, QueryValue>[]> {
  const output: Record<string, QueryValue>[] = [];
  for (const row of rows) {
    const step = tick(state);
    if (!step.ok) return step;
    output.push({ ...row });
  }
  return { ok: true, value: output };
}

function validateWindowFrame(item: WindowSpec): Outcome<void> {
  if (item.frame.preceding < 0 || item.frame.following < 0)
    return failure('query.window-frame', 'Window frame bounds must be nonnegative.');
  if (item.function.id === 'core.window.lag' && item.frame.preceding < 1)
    return failure('query.window-frame', 'lag requires at least one preceding row.');
  return { ok: true, value: undefined };
}

function trustedWindowFunction(state: EvalState, item: WindowSpec): Outcome<FunctionSignature> {
  const supplied = state.registry.resolve(item.function);
  if (supplied === undefined)
    return failure('query.function', `Window function ${relationKey(item.function)} is not registered.`);
  const trusted = trustedLocalSignature(supplied);
  if (!trusted.ok) return trusted;
  if (trusted.value.contexts.includes('window')) return trusted;
  return failure(
    'query.window-context',
    `Function ${relationKey(item.function)} is not registered for window evaluation.`,
  );
}

function partitionKey(
  values: readonly QueryValue[],
  expressions: readonly WindowSpec['partitionBy'][number][],
  schema: QuerySchema,
  state: EvalState,
): string {
  return values
    .map((value, index) => scalarKey(value, expressionValueType(expressions[index]!, schema, state.registry)))
    .join('|');
}

function partitionRows(
  item: WindowSpec,
  rows: readonly QueryRow[],
  schema: QuerySchema,
  state: EvalState,
): Outcome<Map<string, number[]>> {
  const partitions = new Map<string, number[]>();
  for (let index = 0; index < rows.length; index += 1) {
    const step = tick(state);
    if (!step.ok) return step;
    const values: QueryValue[] = [];
    for (const expression of item.partitionBy) {
      const value = evaluateExpression(state, expression, rows[index]!, schema);
      if (!value.ok) return value;
      values.push(value.value ?? null);
    }
    const key = partitionKey(values, item.partitionBy, schema, state);
    const indexes = partitions.get(key) ?? [];
    indexes.push(index);
    partitions.set(key, indexes);
  }
  return { ok: true, value: partitions };
}

function validateWindowIdentityOrder(item: WindowSpec, schema: QuerySchema): Outcome<void> {
  const identity = new Set(schema.identity);
  for (const spec of item.orderBy) {
    if (spec.expression.kind !== 'field') continue;
    const field = sourceField(schema, spec.expression);
    if (field !== undefined) identity.delete(field.id);
  }
  if (identity.size === 0) return { ok: true, value: undefined };
  return failure('query.window-order', 'Window order must include every stable identity field.');
}

function sortPartition(
  indexes: number[],
  rows: readonly QueryRow[],
  item: WindowSpec,
  schema: QuerySchema,
  state: EvalState,
): Outcome<void> {
  let sortError: Extract<Outcome<number>, { ok: false }> | undefined;
  indexes.sort((left, right) => {
    if (sortError !== undefined) return 0;
    const compared = compareRows(rows[left]!, rows[right]!, schema, item.orderBy, state);
    if (!compared.ok) {
      sortError = compared;
      return 0;
    }
    return compared.value;
  });
  return sortError ?? { ok: true, value: undefined };
}

function rankSpecs(item: WindowSpec, schema: QuerySchema): WindowSpec['orderBy'] {
  return item.orderBy.filter((spec) => {
    if (spec.expression.kind !== 'field') return true;
    const field = sourceField(schema, spec.expression);
    return field === undefined || !schema.identity.includes(field.id);
  });
}

function evaluateRank(context: WindowRuntimeContext): QueryOutcome<QueryValue | undefined> {
  const rowIndex = context.indexes[context.position]!;
  const row = context.rows[rowIndex]!;
  const specs = rankSpecs(context.item, context.schema);
  let rank = 1;
  for (let prior = 0; prior < context.position; prior += 1) {
    const previous = context.rows[context.indexes[prior]!]!;
    const compared = compareRows(previous, row, context.schema, specs, context.state, false);
    if (!compared.ok) return compared;
    if (compared.value !== 0) rank = prior + 2;
  }
  return { ok: true, value: rank };
}

function evaluateLag(context: WindowRuntimeContext): QueryOutcome<QueryValue | undefined> {
  const prior = context.position - 1;
  if (prior < 0) return { ok: true, value: null };
  const expression = context.item.arguments[0];
  if (expression === undefined) return failure('query.window-argument', 'lag requires an argument expression.');
  const previous = context.rows[context.indexes[prior]!]!;
  const value = evaluateExpression(context.state, expression, previous, context.schema);
  if (!value.ok) return value;
  return { ok: true, value: value.value ?? null };
}

function evaluateWindowSum(context: WindowRuntimeContext): QueryOutcome<QueryValue | undefined> {
  const { state, item, rows, indexes, position, schema, signature } = context;
  const expression = item.arguments[0];
  if (expression === undefined) return failure('query.window-argument', 'sum requires an argument expression.');
  const first = Math.max(0, position - item.frame.preceding);
  const last = Math.min(indexes.length - 1, position + item.frame.following);
  const values: QueryValue[] = [];
  let hasNull = false;
  for (let offset = first; offset <= last; offset += 1) {
    const value = evaluateExpression(state, expression, rows[indexes[offset]!]!, schema);
    if (!value.ok) return value;
    if (value.value === null || value.value === undefined) hasNull = true;
    else values.push(value.value);
  }
  if (hasNull && signature.nullPolicy === 'propagate') return { ok: true, value: null };
  return sumValues(state, values, expressionSemanticType(expression, schema, state.registry));
}

function unsupportedWindow(context: WindowRuntimeContext): QueryOutcome<QueryValue | undefined> {
  const { item } = context;
  return unsupported(
    'window-runtime',
    `No trusted local implementation exists for ${item.function.id}@${item.function.revision}.`,
  );
}

const WINDOW_EVALUATORS: Readonly<Record<string, WindowEvaluator>> = {
  'core.window.rank': evaluateRank,
  'core.window.lag': evaluateLag,
  'core.window.sum': evaluateWindowSum,
};

function evaluateWindowValue(context: WindowRuntimeContext): QueryOutcome<QueryValue | undefined> {
  const evaluator = WINDOW_EVALUATORS[context.item.function.id];
  if (evaluator !== undefined) return evaluator(context);
  return unsupportedWindow(context);
}

function writeWindowValue(
  rows: Record<string, QueryValue>[],
  rowSizes: number[],
  rowIndex: number,
  item: WindowSpec,
  value: QueryValue | undefined,
  output: QuerySchema,
  totalBytes: number,
  state: EvalState,
): Outcome<number> {
  const checked = outputValue(
    value,
    output.fields.find((field) => field.id === item.id),
  );
  if (!checked.ok) return checked;
  rows[rowIndex]![item.id] = checked.value;
  const bytes = outputBytes([rows[rowIndex]!]);
  const nextBytes = totalBytes + bytes - rowSizes[rowIndex]!;
  rowSizes[rowIndex] = bytes;
  if (nextBytes > state.context.maxBytes!)
    return failure('query.budget', 'Window output exceeds the effective byte budget.');
  return { ok: true, value: nextBytes };
}

function evaluateWindowPartition(
  indexes: readonly number[],
  item: WindowSpec,
  signature: FunctionSignature,
  rows: Record<string, QueryValue>[],
  schema: QuerySchema,
  output: QuerySchema,
  rowSizes: number[],
  totalBytes: number,
  state: EvalState,
): Outcome<number> {
  const mutableIndexes = [...indexes];
  const sorted = sortPartition(mutableIndexes, rows, item, schema, state);
  if (!sorted.ok) return sorted;
  let currentBytes = totalBytes;
  for (let position = 0; position < mutableIndexes.length; position += 1) {
    const step = tick(state);
    if (!step.ok) return step;
    const rowIndex = mutableIndexes[position]!;
    const context: WindowRuntimeContext = {
      state,
      item,
      signature,
      rows,
      indexes: mutableIndexes,
      position,
      schema,
    };
    const value = evaluateWindowValue(context);
    if (!value.ok) return value;
    const written = writeWindowValue(rows, rowSizes, rowIndex, item, value.value, output, currentBytes, state);
    if (!written.ok) return written;
    currentBytes = written.value;
  }
  return { ok: true, value: currentBytes };
}

function applyWindowItem(
  item: WindowSpec,
  rows: Record<string, QueryValue>[],
  schema: QuerySchema,
  output: QuerySchema,
  rowSizes: number[],
  totalBytes: number,
  state: EvalState,
): Outcome<number> {
  const functionSignature = trustedWindowFunction(state, item);
  if (!functionSignature.ok) return functionSignature;
  const frame = validateWindowFrame(item);
  if (!frame.ok) return frame;
  const order = validateWindowIdentityOrder(item, schema);
  if (!order.ok) return order;
  const partitions = partitionRows(item, rows, schema, state);
  if (!partitions.ok) return partitions;
  let currentBytes = totalBytes;
  for (const indexes of partitions.value.values()) {
    const partition = evaluateWindowPartition(
      indexes,
      item,
      functionSignature.value,
      rows,
      schema,
      output,
      rowSizes,
      currentBytes,
      state,
    );
    if (!partition.ok) return partition;
    currentBytes = partition.value;
  }
  return { ok: true, value: currentBytes };
}

export function executeWindow(
  state: EvalState,
  input: EvalRelation,
  items: readonly WindowSpec[],
  output: QuerySchema,
): Outcome<EvalRelation> {
  const cloned = cloneRows(input.rows, state);
  if (!cloned.ok) return cloned;
  const rows = cloned.value;
  const rowSizes = rows.map((row) => outputBytes([row]));
  let totalBytes = rowSizes.reduce((sum, bytes) => sum + bytes, 0);
  for (const item of items) {
    const result = applyWindowItem(item, rows, input.schema, output, rowSizes, totalBytes, state);
    if (!result.ok) return result;
    totalBytes = result.value;
  }
  const resultRows = rows.map((row) => Object.freeze(row));
  return { ok: true, value: { schema: output, rows: resultRows, complete: input.complete } };
}
