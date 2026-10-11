import { compareScalars } from '@varendo/core';
import type { Scalar } from '@varendo/core';
import type { GeometryCheck, PlotDatum, PlotProjection, PlotSource } from './types.js';

function ready(): GeometryCheck<void> {
  return { kind: 'ready', value: undefined };
}

export function validateProjectionDomains(domains: PlotProjection['domains']): string | undefined {
  if (domains && (domains.x.length > 10_000 || domains.y.length > 10_000))
    return 'The display scale domain exceeds its value budget.';
  return undefined;
}

export function validateFamilyRows(source: PlotSource): GeometryCheck<void> {
  const { family } = source.options;
  if (family === undefined) return ready();
  const { encoding } = source.unit;
  const required = [
    encoding.x.field,
    encoding.y.field,
    ...(encoding.x2 ? [encoding.x2.field] : []),
    ...(encoding.y2 ? [encoding.y2.field] : []),
    ...(family === 'heatmap' && encoding.color ? [encoding.color.field] : []),
  ];
  for (const datum of source.data) {
    const missing = hasMissing(datum, required);
    if (missing && !isAllowedGap(datum, source))
      return { kind: 'data-only', reason: 'A Cartesian mark requires non-missing encoded dimensions and measures.' };
  }
  return ready();
}

function hasMissing(datum: PlotDatum, fields: readonly string[]): boolean {
  return fields.some((field) => datum.values[field] === null || datum.values[field] === undefined);
}

function isAllowedGap(datum: PlotDatum, source: PlotSource): boolean {
  const { family } = source.options;
  if (family !== 'trend' && family !== 'area') return false;
  const { x, y } = source.unit.encoding;
  return datum.values[x.field] !== null && datum.values[x.field] !== undefined && datum.values[y.field] === null;
}

export function validateHistogram(source: PlotSource, zero: Scalar): GeometryCheck<void> {
  const { encoding } = source.unit;
  const x2 = encoding.x2;
  const y2 = encoding.y2;
  if (x2 === undefined || y2 === undefined) return ready();
  const startType = source.fields.get(encoding.x.field)!.type;
  const valueType = source.fields.get(encoding.y.field)!.type;
  const baselineType = source.fields.get(y2.field)!.type;
  let previousStart: Scalar | undefined;
  let previousEnd: Scalar | undefined;
  for (const datum of source.data) {
    const checked = validateHistogramDatum(datum, source, zero, { startType, valueType, baselineType });
    if (checked.kind !== 'ready') return checked;
    const start = datum.values[encoding.x.field]!;
    const end = datum.values[x2.field]!;
    const ordering = validateBinOrdering(start, previousStart, previousEnd, startType);
    if (ordering !== undefined) return { kind: 'data-only', reason: ordering };
    previousStart = start;
    previousEnd = end;
  }
  return ready();
}

interface HistogramTypes {
  readonly startType: PlotSource['descriptor']['fields'][number]['type'];
  readonly valueType: PlotSource['descriptor']['fields'][number]['type'];
  readonly baselineType: PlotSource['descriptor']['fields'][number]['type'];
}

function validateHistogramDatum(
  datum: PlotDatum,
  source: PlotSource,
  zero: Scalar,
  types: HistogramTypes,
): GeometryCheck<void> {
  const { x, x2, y, y2 } = source.unit.encoding;
  const start = datum.values[x.field]!;
  const end = datum.values[x2!.field]!;
  const value = datum.values[y.field]!;
  const baseline = datum.values[y2!.field]!;
  if (start === null || end === null || value === null || baseline === null)
    return { kind: 'data-only', reason: 'Histogram bins require non-missing endpoints, values and a zero baseline.' };
  if (!positiveWidth(start, end, types.startType))
    return { kind: 'data-only', reason: 'Histogram bins must have positive width.' };
  if (!isZero(baseline, zero, types.baselineType))
    return { kind: 'data-only', reason: 'Histogram bins must use an explicit zero baseline.' };
  if (!isNonnegative(value, zero, types.valueType))
    return { kind: 'data-only', reason: 'Histogram counts and densities cannot be negative.' };
  return ready();
}

function positiveWidth(start: Scalar, end: Scalar, type: HistogramTypes['startType']): boolean {
  const result = compareScalars(start, end, type);
  return result.ok && result.value !== null && result.value < 0;
}

function isZero(value: Scalar, zero: Scalar, type: HistogramTypes['baselineType']): boolean {
  const result = compareScalars(value, zero, type);
  return result.ok && result.value === 0;
}

function isNonnegative(value: Scalar, zero: Scalar, type: HistogramTypes['valueType']): boolean {
  const result = compareScalars(value, zero, type);
  return result.ok && result.value !== null && result.value >= 0;
}

function validateBinOrdering(
  start: Scalar,
  previousStart: Scalar | undefined,
  previousEnd: Scalar | undefined,
  type: HistogramTypes['startType'],
): string | undefined {
  if (previousStart !== undefined) {
    const ordered = compareScalars(previousStart, start, type);
    if (!ordered.ok || ordered.value === null || ordered.value >= 0)
      return 'Histogram bins must be ordered without duplicate starts.';
  }
  if (previousEnd === undefined) return undefined;
  const disjoint = compareScalars(previousEnd, start, type);
  if (!disjoint.ok || disjoint.value === null || disjoint.value > 0) return 'Histogram bins must not overlap.';
  return undefined;
}
