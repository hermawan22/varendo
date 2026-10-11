import { area, line } from 'd3-shape';
import { compareScalars, scalarIdentity } from '@varendo/core';
import type { Outcome, Scalar } from '@varendo/core';
import type { PlotScale } from '../scales.js';
import { fail } from './shared.js';
import type { BarPosition } from './bars.js';
import type { GeometryCheck, PlotDatum, PlotMark, PlotSource } from './types.js';
import type { StackLayout } from './stacking.js';
import type { PrimaryScales, VerticalLayout } from './scales.js';
import type { PlotSeries } from './series.js';

interface MarkContext {
  readonly source: PlotSource;
  readonly series: PlotSeries;
  readonly x: PlotScale;
  readonly y: PlotScale;
  readonly size?: PlotScale;
  readonly colorAt: PrimaryScales['colorAt'];
  readonly stack: StackLayout;
  readonly bars: ReadonlyMap<string, BarPosition>;
  readonly vertical: VerticalLayout;
  readonly seenCells: Set<string>;
}

function plotX(datum: PlotDatum, context: MarkContext): number | undefined {
  const field = context.source.unit.encoding.x.field;
  return context.x.at(datum.values[field]!);
}

function plotY(datum: PlotDatum, context: MarkContext): number | undefined {
  const field = context.source.unit.encoding.y.field;
  return context.y.at(datum.values[field]!);
}

function isDefined(datum: PlotDatum, context: MarkContext): boolean {
  return plotX(datum, context) !== undefined && plotY(datum, context) !== undefined;
}

function validateLineOrder(group: readonly PlotDatum[], context: MarkContext): string | undefined {
  const { unit, fields } = context.source;
  if (unit.encoding.x.scale === 'ordinal') return undefined;
  let previous: Scalar = null;
  for (const datum of group) {
    if (!isDefined(datum, context)) {
      previous = null;
      continue;
    }
    const current = datum.values[unit.encoding.x.field]!;
    if (previous !== null) {
      const order = compareScalars(previous, current, fields.get(unit.encoding.x.field)!.type);
      if (!order.ok || order.value === null || order.value > 0)
        return 'Line and area observations must be ordered by x; missing values remain gaps.';
    }
    previous = current;
  }
  return undefined;
}

function xPosition(datum: PlotDatum, context: MarkContext): number {
  const position = plotX(datum, context);
  if (position === undefined) throw Error('Missing x position');
  return position;
}

function yPosition(datum: PlotDatum, context: MarkContext): number {
  const position = plotY(datum, context);
  if (position === undefined) throw Error('Missing y position');
  return position;
}

function lineAreaPath(
  group: readonly PlotDatum[],
  groupId: string,
  context: MarkContext,
): GeometryCheck<PlotMark | undefined> {
  const { unit } = context.source;
  if (unit.mark !== 'line' && unit.mark !== 'area') return { kind: 'ready', value: undefined };
  const orderError = validateLineOrder(group, context);
  if (orderError !== undefined) return { kind: 'data-only', reason: orderError };
  const defined = (datum: PlotDatum) => isDefined(datum, context);
  const path = makeLineAreaPath(group, context, defined);
  if (path === null || path === undefined) return { kind: 'ready', value: undefined };
  return {
    kind: 'ready',
    value: {
      kind: 'path',
      path,
      filled: unit.mark === 'area',
      series: groupId,
      identities: group.filter(defined).map((datum) => datum.identity),
    },
  };
}

function makeLineAreaPath(
  group: readonly PlotDatum[],
  context: MarkContext,
  defined: (datum: PlotDatum) => boolean,
): string | null | undefined {
  const { unit } = context.source;
  if (unit.mark === 'line')
    return line<PlotDatum>()
      .defined(defined)
      .x((datum) => plotX(datum, context)!)
      .y((datum) => yPosition(datum, context))(group);
  if (context.source.options.stack === 'zero') return stackedAreaPath(group, context, defined);
  return area<PlotDatum>()
    .defined(defined)
    .x((datum) => xPosition(datum, context))
    .y0(context.vertical.baselineY)
    .y1((datum) => yPosition(datum, context))(group);
}

function stackedAreaPath(
  group: readonly PlotDatum[],
  context: MarkContext,
  defined: (datum: PlotDatum) => boolean,
): string | null | undefined {
  return area<PlotDatum>()
    .defined((datum) => defined(datum) && context.stack.coordinates.has(datum.identity))
    .x((datum) => plotX(datum, context)!)
    .y0((datum) => context.y.at(context.stack.coordinates.get(datum.identity)!.baseline)!)
    .y1((datum) => context.y.at(context.stack.coordinates.get(datum.identity)!.top)!)(group);
}

function datumColor(datum: PlotDatum, context: MarkContext): string | undefined {
  const { encoding } = context.source.unit;
  return context.colorAt(datum.values[encoding.color?.field ?? encoding.y.field]!);
}

function buildDatumMark(datum: PlotDatum, groupId: string, context: MarkContext): GeometryCheck<PlotMark | undefined> {
  const x = plotX(datum, context);
  const y = plotY(datum, context);
  if (x === undefined || y === undefined) return { kind: 'ready', value: undefined };
  const color = datumColor(datum, context);
  switch (context.source.unit.mark) {
    case 'point':
    case 'line':
      return { kind: 'ready', value: pointMark(datum, groupId, x, y, color, context) };
    case 'bar':
    case 'cell':
      return rectangleMark(datum, groupId, x, y, color, context);
    case 'rect':
    case 'link':
      return endpointMark(datum, groupId, x, y, color, context);
    case 'area':
      return { kind: 'ready', value: undefined };
    default:
      return assertNever(context.source.unit.mark);
  }
}

function pointMark(
  datum: PlotDatum,
  group: string,
  x: number,
  y: number,
  color: string | undefined,
  context: MarkContext,
): PlotMark {
  const sizeField = context.source.unit.encoding.size?.field;
  const radius = sizeField === undefined ? 3 : (context.size?.at(datum.values[sizeField]!) ?? 3);
  return {
    kind: 'point',
    x,
    y,
    radius,
    series: group,
    identity: datum.identity,
    ...(color === undefined ? {} : { color }),
  };
}

function rectangleMark(
  datum: PlotDatum,
  group: string,
  x: number,
  y: number,
  color: string | undefined,
  context: MarkContext,
): GeometryCheck<PlotMark> {
  if (context.source.unit.mark === 'cell') return cellMark(datum, group, x, y, color, context);
  return barMark(datum, group, x, y, color, context);
}

function cellMark(
  datum: PlotDatum,
  group: string,
  x: number,
  y: number,
  color: string | undefined,
  context: MarkContext,
): GeometryCheck<PlotMark> {
  const { encoding } = context.source.unit;
  const xIdentity = scalarIdentity(datum.values[encoding.x.field]!, context.source.fields.get(encoding.x.field)!.type);
  if (!xIdentity.ok) return { kind: 'error', outcome: errorOnly(xIdentity) };
  const yIdentity = scalarIdentity(datum.values[encoding.y.field]!, context.source.fields.get(encoding.y.field)!.type);
  if (!yIdentity.ok) return { kind: 'error', outcome: errorOnly(yIdentity) };
  const cellKey = JSON.stringify([xIdentity.value, yIdentity.value]);
  if (context.seenCells.has(cellKey))
    return { kind: 'data-only', reason: 'Heatmap rows must contain one value per dimension pair.' };
  context.seenCells.add(cellKey);
  return {
    kind: 'ready',
    value: {
      kind: 'rect',
      x: x - context.vertical.cellWidth / 2,
      y: y - context.vertical.cellHeight / 2,
      width: context.vertical.cellWidth,
      height: context.vertical.cellHeight,
      series: group,
      identity: datum.identity,
      ...(color === undefined ? {} : { color }),
    },
  };
}

function barMark(
  datum: PlotDatum,
  group: string,
  x: number,
  y: number,
  color: string | undefined,
  context: MarkContext,
): GeometryCheck<PlotMark> {
  const yType = context.source.fields.get(context.source.unit.encoding.y.field)!.type;
  const zero: Scalar = yType.value === 'decimal' ? { decimal: '0' } : 0;
  const baseline = context.y.at(zero) ?? context.vertical.baselineY;
  const layout = context.bars.get(datum.identity);
  const defaultWidth = Math.max(
    1,
    Math.min(28, (context.vertical.plotWidth / Math.max(1, context.source.displayed.length)) * 0.7),
  );
  const width = layout?.width ?? defaultWidth;
  const center = layout?.center ?? x;
  return {
    kind: 'ready',
    value: {
      kind: 'rect',
      x: center - width / 2,
      y: Math.min(y, baseline),
      width,
      height: Math.max(1, Math.abs(baseline - y)),
      series: group,
      identity: datum.identity,
      ...(color === undefined ? {} : { color }),
    },
  };
}

function endpointMark(
  datum: PlotDatum,
  group: string,
  x: number,
  y: number,
  color: string | undefined,
  context: MarkContext,
): GeometryCheck<PlotMark | undefined> {
  const { encoding, mark } = context.source.unit;
  const x2 = context.x.at(datum.values[encoding.x2!.field]!);
  const y2 = context.y.at(datum.values[encoding.y2!.field]!);
  if (x2 === undefined || y2 === undefined) return { kind: 'ready', value: undefined };
  if (mark === 'rect')
    return {
      kind: 'ready',
      value: {
        kind: 'rect',
        x: Math.min(x, x2),
        y: Math.min(y, y2),
        width: Math.abs(x2 - x),
        height: Math.abs(y2 - y),
        series: group,
        identity: datum.identity,
        ...(color === undefined ? {} : { color }),
      },
    };
  return {
    kind: 'ready',
    value: {
      kind: 'path',
      path: line()([
        [x, y],
        [x2, y2],
      ])!,
      filled: false,
      series: group,
      identities: [datum.identity],
      ...(color === undefined ? {} : { color }),
    },
  };
}

function errorOnly(outcome: Outcome<unknown>): Outcome<never> {
  if (outcome.ok) return fail('mark', 'Invalid mark');
  return { ok: false, diagnostics: outcome.diagnostics };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported plot mark: ${String(value)}`);
}

function appendGroupMarks(
  groupId: string,
  group: readonly PlotDatum[],
  context: MarkContext,
  marks: PlotMark[],
): GeometryCheck<void> {
  const path = lineAreaPath(group, groupId, context);
  if (path.kind !== 'ready') return path;
  if (path.value !== undefined) marks.push(path.value);
  for (const datum of group) {
    const mark = buildDatumMark(datum, groupId, context);
    if (mark.kind !== 'ready') return mark;
    if (mark.value !== undefined) marks.push(mark.value);
  }
  return { kind: 'ready', value: undefined };
}

export function buildMarks(
  source: PlotSource,
  series: PlotSeries,
  primary: PrimaryScales,
  vertical: VerticalLayout,
  stack: StackLayout,
  bars: ReadonlyMap<string, BarPosition>,
): GeometryCheck<readonly PlotMark[]> {
  const context: MarkContext = {
    source,
    series,
    x: primary.x,
    y: vertical.y,
    ...(vertical.size === undefined ? {} : { size: vertical.size }),
    colorAt: primary.colorAt,
    stack,
    bars,
    vertical,
    seenCells: new Set(),
  };
  const marks: PlotMark[] = [];
  for (const [groupId, group] of series.groups) {
    const checked = appendGroupMarks(groupId, group, context, marks);
    if (checked.kind !== 'ready') return checked;
  }
  return { kind: 'ready', value: marks };
}
