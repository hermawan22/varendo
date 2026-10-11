import { scalarInstantParts } from '../../contracts/scalars.js';
import type { QueryOutcome, QueryRow, QuerySchema, QueryValue, SortSpec, TimeBucketSpec } from '../types.js';
import { failure, type EvalState } from './shared.js';
import { tick } from './execution-budget.js';
import { evaluateExpression } from './expression-runtime.js';
import { expressionValueType, sourceField } from './expression-semantics.js';
import { compareValue, validDate } from './value-utils.js';

function compareNullPlacement(
  left: QueryValue | undefined,
  right: QueryValue | undefined,
  placement: SortSpec['nulls'],
): number | undefined {
  const leftNull = left === null || left === undefined;
  const rightNull = right === null || right === undefined;
  if (!leftNull && !rightNull) return undefined;
  if (leftNull && rightNull) return 0;
  if (placement === 'first') return leftNull ? -1 : 1;
  return leftNull ? 1 : -1;
}

function compareSortSpec(
  left: QueryRow,
  right: QueryRow,
  schema: QuerySchema,
  spec: SortSpec,
  state: EvalState,
): QueryOutcome<number> {
  const a = evaluateExpression(state, spec.expression, left, schema);
  if (!a.ok) return a;
  const b = evaluateExpression(state, spec.expression, right, schema);
  if (!b.ok) return b;
  const nullOrder = compareNullPlacement(a.value, b.value, spec.nulls);
  if (nullOrder !== undefined) return { ok: true, value: nullOrder };
  const field = spec.expression.kind === 'field' ? sourceField(schema, spec.expression) : undefined;
  const type = field?.type.value ?? expressionValueType(spec.expression, schema, state.registry) ?? 'text';
  const compared = compareValue(a.value, b.value, type) ?? 0;
  if (compared === 0 || spec.direction === 'asc') return { ok: true, value: compared };
  return { ok: true, value: -compared };
}

function compareIdentity(left: QueryRow, right: QueryRow, schema: QuerySchema): QueryOutcome<number | undefined> {
  for (const identity of schema.identity) {
    const type = schema.fields.find((field) => field.id === identity)?.type.value ?? 'text';
    const compared = compareValue(left[identity], right[identity], type);
    if (compared !== undefined && compared !== 0) return { ok: true, value: compared };
  }
  return { ok: true, value: undefined };
}

export function compareRows(
  left: QueryRow,
  right: QueryRow,
  schema: QuerySchema,
  specs: readonly SortSpec[],
  state: EvalState,
  appendIdentity = true,
): QueryOutcome<number> {
  const step = tick(state);
  if (!step.ok) return step;
  for (const spec of specs) {
    const compared = compareSortSpec(left, right, schema, spec, state);
    if (!compared.ok) return compared;
    if (compared.value !== 0) return compared;
  }
  if (!appendIdentity) return { ok: true, value: 0 };
  const identity = compareIdentity(left, right, schema);
  if (!identity.ok) return identity;
  return { ok: true, value: identity.value ?? 0 };
}

function gregorianWeekday(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  const adjustedYear = month < 3 ? year - 1 : year;
  const weekday =
    adjustedYear +
    Math.floor(adjustedYear / 4) -
    Math.floor(adjustedYear / 100) +
    Math.floor(adjustedYear / 400) +
    offsets[month - 1]! +
    day;
  return ((weekday % 7) + 7) % 7;
}

function shiftGregorianDate(
  year: number,
  month: number,
  day: number,
  delta: number,
): { readonly year: number; readonly month: number; readonly day: number } | undefined {
  const shifted = new Date(0);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCFullYear(year, month - 1, day);
  shifted.setUTCDate(shifted.getUTCDate() + delta);
  const shiftedYear = shifted.getUTCFullYear();
  if (shiftedYear < 0 || shiftedYear > 9999) return undefined;
  return { year: shiftedYear, month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function dateFromValue(value: string): QueryOutcome<string> {
  if (validDate(value)) return { ok: true, value };
  if (scalarInstantParts(value) === undefined)
    return failure('query.temporal-value', 'Time bucket input is not a valid bounded date or instant.');
  return { ok: true, value: new Date(value).toISOString().slice(0, 10) };
}

function bucketedDate(date: string, item: TimeBucketSpec): QueryOutcome<string> {
  const [yearText, monthText, dayText] = date.split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  let day = Number(dayText);
  switch (item.grain) {
    case 'year':
      month = 1;
      day = 1;
      break;
    case 'quarter':
      month = Math.floor((month - 1) / 3) * 3 + 1;
      day = 1;
      break;
    case 'month':
      day = 1;
      break;
    case 'week': {
      const weekday = gregorianWeekday(year, month, day);
      const starts = item.weekStartsOn ?? 1;
      const delta = (weekday - starts + 7) % 7;
      const start = shiftGregorianDate(year, month, day, -delta);
      if (start === undefined)
        return failure(
          'query.temporal-range',
          'Weekly time bucket starts outside the supported four-digit date range.',
        );
      year = start.year;
      month = start.month;
      day = start.day;
      break;
    }
    case 'day':
      break;
  }
  return {
    ok: true,
    value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export function bucket(value: QueryValue | undefined, item: TimeBucketSpec): QueryOutcome<QueryValue | undefined> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string')
    return failure('query.temporal-type', 'Time bucket input must be a date or instant string.');
  const date = dateFromValue(value);
  if (!date.ok) return date;
  return bucketedDate(date.value, item);
}
