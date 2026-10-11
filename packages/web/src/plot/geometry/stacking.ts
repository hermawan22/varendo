import { compareScalars, scalarIdentity } from '@varendo/core';
import type { Scalar, SemanticType } from '@varendo/core';
import type { GeometryCheck, PlotDatum, PlotSource } from './types.js';
import type { PlotSeries } from './series.js';

interface StackCoordinate {
  readonly baseline: Scalar;
  readonly top: Scalar;
}

export interface StackLayout {
  readonly coordinates: ReadonlyMap<string, StackCoordinate>;
  readonly values: readonly Scalar[];
}

interface StackState {
  readonly offsets: Map<string, { positive: Scalar; negative: Scalar }>;
  readonly coordinates: Map<string, StackCoordinate>;
  readonly values: Scalar[];
}

interface GroupState {
  readonly source: PlotSource;
  readonly zero: Scalar;
  readonly type: SemanticType;
  readonly stack: StackState;
}

function decimalParts(value: string): { readonly coefficient: bigint; readonly scale: number } {
  const [whole, fraction = ''] = value.split('.');
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function decimalText(coefficient: bigint, scale: number): string {
  const negative = coefficient < 0n;
  const absolute = (negative ? -coefficient : coefficient).toString();
  if (scale === 0) return `${negative ? '-' : ''}${absolute}`;
  const padded = absolute.padStart(scale + 1, '0');
  const point = padded.length - scale;
  const fraction = padded.slice(point).replace(/0+$/u, '');
  return `${negative ? '-' : ''}${padded.slice(0, point)}${fraction ? `.${fraction}` : ''}`;
}

function numericValue(value: Scalar): number {
  if (value === null) throw Error('Missing numeric value');
  const number = typeof value === 'object' ? Number(value.decimal) : Number(value);
  if (!Number.isFinite(number)) throw Error('Numeric value is not finite');
  return number;
}

function addNumeric(left: Scalar, right: Scalar, type: SemanticType): Scalar {
  if (type.value === 'decimal') {
    const a = decimalParts((left as { decimal: string }).decimal);
    const b = decimalParts((right as { decimal: string }).decimal);
    const scale = Math.max(a.scale, b.scale);
    const coefficient = a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale);
    return { decimal: decimalText(coefficient, scale) };
  }
  const sum = numericValue(left) + numericValue(right);
  if (!Number.isFinite(sum) || (type.value === 'integer' && !Number.isSafeInteger(sum)))
    throw Error('Stacked area exceeds numeric bounds');
  return sum;
}

function stackDatum(datum: PlotDatum, state: GroupState, seenX: Set<string>): GeometryCheck<void> {
  const { encoding } = state.source.unit;
  const xField = state.source.fields.get(encoding.x.field)!;
  const xIdentity = scalarIdentity(datum.values[encoding.x.field]!, xField.type);
  if (!xIdentity.ok) return { kind: 'error', outcome: xIdentity };
  if (seenX.has(xIdentity.value))
    return { kind: 'data-only', reason: 'Stacked area series must contain one value per temporal grain.' };
  seenX.add(xIdentity.value);
  const value = datum.values[encoding.y.field];
  if (value === null || value === undefined) return { kind: 'ready', value: undefined };
  const sign = compareScalars(value, state.zero, state.type);
  if (!sign.ok) return { kind: 'error', outcome: sign };
  if (sign.value === null)
    return { kind: 'data-only', reason: 'Stacked area magnitudes must be ordered numeric values.' };
  saveStackCoordinate(datum, xIdentity.value, value, sign.value < 0, state);
  return { kind: 'ready', value: undefined };
}

function saveStackCoordinate(
  datum: PlotDatum,
  xIdentity: string,
  value: Scalar,
  negative: boolean,
  state: GroupState,
): void {
  const previous = state.stack.offsets.get(xIdentity) ?? { positive: state.zero, negative: state.zero };
  const baseline = negative ? previous.negative : previous.positive;
  const top = addNumeric(baseline, value, state.type);
  state.stack.coordinates.set(datum.identity, { baseline, top });
  const updated = negative
    ? { positive: previous.positive, negative: top }
    : { positive: top, negative: previous.negative };
  state.stack.offsets.set(xIdentity, updated);
  state.stack.values.push(top);
}

function stackGroup(group: readonly PlotDatum[], state: GroupState): GeometryCheck<ReadonlySet<string>> {
  const seenX = new Set<string>();
  for (const datum of group) {
    const checked = stackDatum(datum, state, seenX);
    if (checked.kind !== 'ready') return checked;
  }
  return { kind: 'ready', value: seenX };
}

function sameCohort(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

export function buildStackLayout(source: PlotSource, series: PlotSeries): GeometryCheck<StackLayout> {
  const { unit, options } = source;
  if (unit.mark !== 'area' || options.stack !== 'zero')
    return { kind: 'ready', value: { coordinates: new Map(), values: [] } };
  if (unit.encoding.series === undefined)
    return { kind: 'data-only', reason: 'Stacked areas require an explicit series dimension.' };
  const type = source.fields.get(unit.encoding.y.field)!.type;
  const zero: Scalar = type.value === 'decimal' ? { decimal: '0' } : 0;
  const stack: StackState = { offsets: new Map(), coordinates: new Map(), values: [] };
  const state: GroupState = { source, zero, type, stack };
  let cohort: ReadonlySet<string> | undefined;
  for (const group of series.groups.values()) {
    const current = stackGroup(group, state);
    if (current.kind !== 'ready') return current;
    if (cohort !== undefined && !sameCohort(cohort, current.value))
      return { kind: 'data-only', reason: 'Stacked area series must share the same temporal cohorts.' };
    cohort ??= current.value;
  }
  return { kind: 'ready', value: { coordinates: stack.coordinates, values: stack.values } };
}
