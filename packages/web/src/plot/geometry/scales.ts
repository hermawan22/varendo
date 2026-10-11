import { makeAxisScale, makePlotScale } from '../scales.js';
import type { PlotScale, PlotTick } from '../scales.js';
import { quantitativeColor } from '../palette.js';
import type { GeometryCheck, PlotProjection, PlotSource } from './types.js';
import type { Scalar } from '@varendo/core';

export interface PrimaryScales {
  readonly x: PlotScale;
  readonly axisLeft: number;
  readonly color?: PlotScale;
  readonly colorAt: (value: Scalar) => string | undefined;
}

const ZERO_BASED_FAMILIES: ReadonlySet<string> = new Set(['bar', 'area', 'histogram']);

export interface VerticalLayout {
  readonly y: PlotScale;
  readonly size?: PlotScale;
  readonly baselineY: number;
  readonly plotWidth: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

export function createPrimaryScales(source: PlotSource, projection: PlotProjection): GeometryCheck<PrimaryScales> {
  const { unit, fields, displayed } = source;
  const axisLeft = source.options.family === 'heatmap' ? 216 : 64;
  const widthError = validateHeatmapWidth(source, axisLeft);
  if (widthError !== undefined) return { kind: 'data-only', reason: widthError };
  const encodingError = validateMarkEncodings(unit);
  if (encodingError !== undefined) return { kind: 'data-only', reason: encodingError };
  const { encoding } = unit;
  const x = makeAxisScale(
    encoding.x,
    fields.get(encoding.x.field)!.type,
    projection.domains?.x ?? displayed.flatMap((datum) => xValues(datum, encoding)),
    [axisLeft, source.options.width - 24],
  );
  const color = makeColorScale(source);
  if (color.kind !== 'ready') return color;
  const colorError = validateColorUsage(source, color.value);
  if (colorError !== undefined) return { kind: 'data-only', reason: colorError };
  return {
    kind: 'ready',
    value: {
      x,
      axisLeft,
      ...(color.value === undefined ? {} : { color: color.value }),
      colorAt: colorFunction(color.value),
    },
  };
}

function validateHeatmapWidth(source: PlotSource, axisLeft: number): string | undefined {
  if (source.options.family !== 'heatmap') return undefined;
  if (source.options.width >= axisLeft + 24 + 64) return undefined;
  return 'Heatmap graphics require at least 304 CSS pixels; exact data is available below.';
}

function validateMarkEncodings(unit: PlotSource['unit']): string | undefined {
  const { encoding } = unit;
  if (encoding.size !== undefined && unit.mark !== 'point' && unit.mark !== 'line')
    return 'Size is supported only for point marks.';
  if ((encoding.x2 !== undefined || encoding.y2 !== undefined) && unit.mark !== 'rect' && unit.mark !== 'link')
    return 'Second endpoints require rect or link marks.';
  return undefined;
}

function xValues(
  datum: PlotSource['data'][number],
  encoding: PlotSource['unit']['encoding'],
): import('@varendo/core').Scalar[] {
  return [datum.values[encoding.x.field]!, ...(encoding.x2 ? [datum.values[encoding.x2.field]!] : [])];
}

function makeColorScale(source: PlotSource): GeometryCheck<PlotScale | undefined> {
  const color = source.unit.encoding.color;
  if (color === undefined || color.scale === 'ordinal') return { kind: 'ready', value: undefined };
  const scale = makePlotScale(
    color,
    source.fields.get(color.field)!.type,
    source.displayed.map((datum) => datum.values[color.field]!),
    [0, 1],
  );
  return { kind: 'ready', value: scale };
}

function validateColorUsage(source: PlotSource, color: PlotScale | undefined): string | undefined {
  const encoding = source.unit.encoding.color;
  if (color === undefined || encoding === undefined) return undefined;
  if (source.unit.mark === 'line' || source.unit.mark === 'area')
    return 'Quantitative color is not representable on a single line or area path. Use an ordinal series or the exact data table.';
  if (source.displayed.some((datum) => datum.values[encoding.field] === null))
    return 'Quantitative color requires a value for every displayed mark.';
  return undefined;
}

function colorFunction(color: PlotScale | undefined): PrimaryScales['colorAt'] {
  return (value) => {
    if (color === undefined || value === null) return undefined;
    const position = color.at(value);
    if (position === undefined) return undefined;
    const first = color.ticks[0]?.position ?? 0;
    const last = color.ticks.at(-1)?.position ?? 1;
    const ratio = last === first ? 0.5 : Math.min(1, Math.max(0, (position - first) / (last - first)));
    return quantitativeColor(ratio);
  };
}

function minimumStep(positions: readonly number[], fallback: number): number {
  const sorted = [...positions].sort((left, right) => left - right);
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) step = Math.min(step, sorted[index]! - sorted[index - 1]!);
  return Number.isFinite(step) && step > 0 ? step : fallback;
}

function displayPositions(
  source: PlotSource,
  x: PlotScale,
  y: PlotScale,
): {
  readonly x: readonly number[];
  readonly y: readonly number[];
} {
  const xValues = source.displayed.map((datum) => x.at(datum.values[source.unit.encoding.x.field]!));
  const yValues = source.displayed.map((datum) => y.at(datum.values[source.unit.encoding.y.field]!));
  return {
    x: [...new Set(xValues.filter((value): value is number => value !== undefined))],
    y: [...new Set(yValues.filter((value): value is number => value !== undefined))],
  };
}

function quantitativeZero(type: PlotSource['descriptor']['fields'][number]['type']): Scalar {
  return type.value === 'decimal' ? { decimal: '0' } : 0;
}

export function createVerticalLayout(
  source: PlotSource,
  primary: PrimaryScales,
  projection: PlotProjection,
  stackValues: readonly Scalar[],
): GeometryCheck<VerticalLayout> {
  const { width, height, family } = source.options;
  const { unit, displayed, fields } = source;
  const { encoding } = unit;
  const yType = fields.get(encoding.y.field)!.type;
  const domain =
    projection.domains?.y === undefined
      ? displayed.flatMap((datum) => yValues(datum, encoding))
      : [...projection.domains.y];
  domain.push(...stackValues);
  const y = makeAxisScale(encoding.y, yType, domain, [height - 48, 24]);
  const needsZero = ZERO_BASED_FAMILIES.has(family ?? '') || unit.mark === 'bar' || unit.mark === 'area';
  const zeroY = needsZero ? y.at(quantitativeZero(yType)) : undefined;
  if (needsZero && zeroY === undefined)
    return { kind: 'data-only', reason: 'The quantitative scale cannot represent its required zero baseline.' };
  const size = makeSizeScale(source);
  const positions = displayPositions(source, primary.x, y);
  const plotWidth = width - 24 - primary.axisLeft;
  const cellWidth = Math.max(
    1,
    Math.min(160, minimumStep(positions.x, plotWidth / Math.max(1, positions.x.length)) * 0.9),
  );
  const cellHeight = Math.max(
    1,
    Math.min(96, minimumStep(positions.y, (height - 72) / Math.max(1, positions.y.length)) * 0.9),
  );
  return {
    kind: 'ready',
    value: { y, ...(size === undefined ? {} : { size }), baselineY: zeroY ?? 0, plotWidth, cellWidth, cellHeight },
  };
}

function yValues(
  datum: PlotSource['data'][number],
  encoding: PlotSource['unit']['encoding'],
): import('@varendo/core').Scalar[] {
  return [datum.values[encoding.y.field]!, ...(encoding.y2 ? [datum.values[encoding.y2.field]!] : [])];
}

function makeSizeScale(source: PlotSource): PlotScale | undefined {
  const size = source.unit.encoding.size;
  if (size === undefined) return undefined;
  return makePlotScale(
    size,
    source.fields.get(size.field)!.type,
    source.displayed.map((datum) => datum.values[size.field]!),
    [3, 12],
  );
}

export function colorPresentation(
  source: PlotSource,
  primary: PrimaryScales,
): { readonly colorField?: string; readonly colorTicks?: readonly PlotTick[] } {
  const encoding = source.unit.encoding.color;
  if (encoding === undefined || encoding.scale === 'ordinal' || primary.color === undefined) return {};
  return { colorField: encoding.field, colorTicks: primary.color.ticks };
}
