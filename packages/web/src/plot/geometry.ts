import { bindPlotSpec } from '@varendo/core/plot';
import type { Outcome, PlotUnit, Result } from '@varendo/core';
import { createBarLayout } from './geometry/bars.js';
import { dataOnly, fail, validateOptions } from './geometry/shared.js';
import { buildMarks } from './geometry/marks.js';
import { groupSeries, seriesFailure } from './geometry/series.js';
import { buildStackLayout } from './geometry/stacking.js';
import { createPrimaryScales, createVerticalLayout, colorPresentation } from './geometry/scales.js';
import { prepareRows, selectRows } from './geometry/rows.js';
import { validateFamilyRows, validateHistogram, validateProjectionDomains } from './geometry/validation.js';
import type {
  GeometryCheck,
  PlotGeometry,
  PlotGeometryOptions,
  PlotMark,
  PlotProjection,
  PlotSource,
} from './geometry/types.js';
import type { PrimaryScales, VerticalLayout } from './geometry/scales.js';
import type { PlotSeries } from './geometry/series.js';
import type { StackLayout } from './geometry/stacking.js';
import type { BarPosition } from './geometry/bars.js';

export type {
  PlotDatum,
  PlotGeometry,
  PlotGeometryOptions,
  PlotMark,
  PlotProjection,
  PlotRow,
} from './geometry/types.js';

interface PlotDrawing {
  readonly series: PlotSeries;
  readonly primary: PrimaryScales;
  readonly vertical: VerticalLayout;
  readonly marks: readonly PlotMark[];
}

interface SeriesState {
  readonly series: PlotSeries;
  readonly stack: StackLayout;
}

interface LayoutState {
  readonly primary: PrimaryScales;
  readonly vertical: VerticalLayout;
  readonly bars: ReadonlyMap<string, BarPosition>;
}

/** Bounded realization. Over-budget data returns a diagnostic; observations are never silently dropped. */
export function compilePlotUnit(
  unit: PlotUnit,
  result: Result,
  inputRows: unknown,
  options: PlotGeometryOptions,
  projection: PlotProjection = {},
): Outcome<PlotGeometry> {
  const budget = validateOptions(options);
  if (!budget.ok) return budget;
  const bound = bindPlotSpec({ version: '1', root: unit }, [result]);
  if (!bound.ok) return bound;
  const { node, result: descriptor } = bound.value.units[0]!;
  const prepared = prepareRows(inputRows, descriptor, options.maxRows);
  if (!prepared.ok) return prepared;
  const projected = selectRows(prepared.value.rows, projection.identities, options.maxRows);
  if (!projected.ok) return projected;
  const domainError = validateProjectionDomains(projection.domains);
  if (domainError !== undefined) return fail('domain-budget', domainError);
  const source: PlotSource = {
    unit: node,
    descriptor,
    data: prepared.value.rows,
    displayed: projected.value,
    fields: prepared.value.fields,
    options,
  };
  return compileGeometry(source, projection);
}

function compileGeometry(source: PlotSource, projection: PlotProjection): Outcome<PlotGeometry> {
  try {
    const drawing = createDrawing(source, projection);
    if (drawing.kind === 'error') return drawing.outcome;
    if (drawing.kind === 'data-only') return dataOnly(source.options, source.data, source.descriptor, drawing.reason);
    return completeGeometry(source, drawing.value);
  } catch {
    return dataOnly(
      source.options,
      source.data,
      source.descriptor,
      'The scale cannot safely represent these observations. Loaded values are available below.',
    );
  }
}

function createDrawing(source: PlotSource, projection: PlotProjection): GeometryCheck<PlotDrawing> {
  const seriesState = prepareSeriesState(source);
  if (seriesState.kind !== 'ready') return seriesState;
  const layout = prepareLayout(source, projection, seriesState.value.series, seriesState.value.stack);
  if (layout.kind !== 'ready') return layout;
  const marks = buildMarks(
    source,
    seriesState.value.series,
    layout.value.primary,
    layout.value.vertical,
    seriesState.value.stack,
    layout.value.bars,
  );
  if (marks.kind !== 'ready') return marks;
  return validateDrawing(source, seriesState.value.series, layout.value, marks.value);
}

function prepareSeriesState(source: PlotSource): GeometryCheck<SeriesState> {
  const grouping = groupSeries(source);
  if (!grouping.ok) return { kind: 'error', outcome: grouping };
  const seriesReason = seriesFailure(grouping.value);
  if (seriesReason !== undefined) return { kind: 'data-only', reason: seriesReason };
  const family = validateFamilyRows(source);
  if (family.kind !== 'ready') return family;
  const stack = buildStackLayout(source, grouping.value);
  if (stack.kind !== 'ready') return stack;
  const histogram = checkHistogram(source);
  if (histogram.kind !== 'ready') return histogram;
  return { kind: 'ready', value: { series: grouping.value, stack: stack.value } };
}

function prepareLayout(
  source: PlotSource,
  projection: PlotProjection,
  series: PlotSeries,
  stack: StackLayout,
): GeometryCheck<LayoutState> {
  const primary = createPrimaryScales(source, projection);
  if (primary.kind !== 'ready') return primary;
  const vertical = createVerticalLayout(source, primary.value, projection, stack.values);
  if (vertical.kind !== 'ready') return vertical;
  const bars = createBarLayout(source, series, primary.value.x);
  if (bars.kind !== 'ready') return bars;
  return { kind: 'ready', value: { primary: primary.value, vertical: vertical.value, bars: bars.value } };
}

function validateDrawing(
  source: PlotSource,
  series: PlotSeries,
  layout: LayoutState,
  marks: readonly PlotMark[],
): GeometryCheck<PlotDrawing> {
  if (source.displayed.length === 0)
    return { kind: 'data-only', reason: 'No displayed observations are available for the requested plot partition.' };
  if (marks.length === 0)
    return { kind: 'data-only', reason: 'No plottable observations are available; exact values are shown below.' };
  if (geometryCost(marks) > source.options.maxMarks)
    return { kind: 'data-only', reason: 'The exact geometry exceeds the mark budget.' };
  return {
    kind: 'ready',
    value: { series, primary: layout.primary, vertical: layout.vertical, marks },
  };
}

function checkHistogram(source: PlotSource): GeometryCheck<void> {
  if (source.options.family !== 'histogram') return { kind: 'ready', value: undefined };
  const type = source.fields.get(source.unit.encoding.y.field)!.type;
  const zero = type.value === 'decimal' ? { decimal: '0' } : 0;
  return validateHistogram(source, zero);
}

function geometryCost(marks: PlotDrawing['marks']): number {
  return marks.reduce((total, mark) => total + (mark.kind === 'path' ? mark.identities.length : 1), 0);
}

function completeGeometry(source: PlotSource, drawing: PlotDrawing): Outcome<PlotGeometry> {
  const { width, height } = source.options;
  const { unit, fields } = source;
  const xField = fields.get(unit.encoding.x.field)!;
  const yField = fields.get(unit.encoding.y.field)!;
  const axisLabel = (field: typeof xField) => `${field.label}${field.type.unit ? ` (${field.type.unit.symbol})` : ''}`;
  return {
    ok: true,
    value: {
      state: 'plot',
      width,
      height,
      axisLeft: drawing.primary.axisLeft,
      marks: drawing.marks,
      rows: source.data,
      axes: { x: drawing.primary.x, y: drawing.vertical.y, xLabel: axisLabel(xField), yLabel: axisLabel(yField) },
      ...colorPresentation(source, drawing.primary),
      series: [...drawing.series.groups.keys()],
      legend: [...drawing.series.legend].map(([id, label]) => ({ id, label })),
      result: source.descriptor,
    },
  };
}
