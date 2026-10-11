import * as z from 'zod/mini';
import { histogramBinsSchema, resultRefSchema } from '../schemas.js';
import { inspectWire as parseWireValue } from '../ingress.js';
import { bindPlotSpec } from '../plot/validate.js';
import type { BoundPlot, BoundPlotUnit } from '../plot/validate.js';
import type { Catalog, FieldDefinition, MeaningDefinition, Outcome, Result } from '../types.js';
import type {
  BoundVisualization,
  PlotVisualizationSpec,
  VisualizationBindingContext,
  VisualizationFieldMap,
} from './binding-types.js';
import { bindAdditiveMeaning } from './additive-meaning.js';
import { fail, freezeOwned, isNumeric, isTemporal, resultRefKey, semanticSignature } from './validation-common.js';

const histogramBindingsSchema = z
  .array(z.strictObject({ result: resultRefSchema, bins: histogramBinsSchema }))
  .check(z.maxLength(128));

interface PlotUnitContext {
  readonly fields: VisualizationFieldMap;
  readonly encoding: BoundPlotUnit['node']['encoding'];
  readonly x: FieldDefinition;
  readonly y: FieldDefinition;
  readonly mark: BoundPlotUnit['node']['mark'];
  readonly rowGrain: readonly string[];
}

type AreaSpec = Extract<PlotVisualizationSpec, { readonly view: 'area' }>;
type HistogramSpec = Extract<PlotVisualizationSpec, { readonly view: 'histogram' }>;

export function bindPlotVisualization(
  spec: PlotVisualizationSpec,
  results: ReadonlyMap<string, Result>,
  context: VisualizationBindingContext,
  catalog: Catalog | undefined,
): Outcome<BoundVisualization> {
  const bound = bindPlotSpec(spec.plot, [...results.values()]);
  if (!bound.ok) return bound;

  const meaning = bindPlotUnits(spec, bound.value.units, context.histograms, catalog);
  if (!meaning.ok) return meaning;
  const usedResults = uniqueUnitResults(bound.value);
  return {
    ok: true,
    value: freezeOwned({
      spec,
      results: usedResults,
      plot: bound.value,
      ...(meaning.value === undefined ? {} : { meaning: meaning.value }),
    }),
  };
}

function uniqueUnitResults(plot: BoundPlot): Result[] {
  const keyed = plot.units.map((unit) => [resultRefKey(unit.result.ref), unit.result] as const);
  return [...new Map(keyed).values()];
}

function bindPlotUnits(
  spec: PlotVisualizationSpec,
  units: readonly BoundPlotUnit[],
  histograms: VisualizationBindingContext['histograms'],
  catalog: Catalog | undefined,
): Outcome<MeaningDefinition | undefined> {
  let meaning: MeaningDefinition | undefined;
  for (const unit of units) {
    const bound = bindPlotUnit(spec, unit, histograms, catalog);
    if (!bound.ok) return bound;
    if (bound.value !== undefined) meaning = bound.value;
  }
  return { ok: true, value: meaning };
}

function bindPlotUnit(
  spec: PlotVisualizationSpec,
  unit: BoundPlotUnit,
  histograms: VisualizationBindingContext['histograms'],
  catalog: Catalog | undefined,
): Outcome<MeaningDefinition | undefined> {
  const context = createPlotUnitContext(unit);
  switch (spec.view) {
    case 'trend':
      return bindTrend(context);
    case 'area':
      return bindArea(spec, context, catalog);
    case 'bar':
      return bindBar(context);
    case 'scatter':
      return bindScatter(context);
    case 'histogram':
      return bindHistogram(spec, unit, context, histograms);
    case 'heatmap':
      return bindHeatmap(context, unit);
    default:
      return unreachable(spec);
  }
}

function createPlotUnitContext(unit: BoundPlotUnit): PlotUnitContext {
  const fields = new Map(unit.result.fields.map((field) => [field.id, field]));
  const encoding = unit.node.encoding;
  return {
    fields,
    encoding,
    x: fields.get(encoding.x.field)!,
    y: fields.get(encoding.y.field)!,
    mark: unit.node.mark,
    rowGrain: unit.result.rowGrain,
  };
}

function bindTrend(context: PlotUnitContext): Outcome<MeaningDefinition | undefined> {
  if (!hasTemporalTrendAxes(context, 'line'))
    return fail('trend', 'Temporal views require temporal grain and quantitative observations.');
  return { ok: true, value: undefined };
}

function bindArea(
  spec: AreaSpec,
  context: PlotUnitContext,
  catalog: Catalog | undefined,
): Outcome<MeaningDefinition | undefined> {
  if (!hasTemporalTrendAxes(context, 'area'))
    return fail('trend', 'Temporal views require temporal grain and quantitative observations.');
  const meaning = bindAdditiveMeaning(spec.meaning, context.y, catalog);
  if (!meaning.ok) return meaning;
  if (spec.stack === 'zero' && context.encoding.series === undefined)
    return fail('stack', 'Stacked area requires an explicit series dimension.');
  return { ok: true, value: meaning.value };
}

function hasTemporalTrendAxes(context: PlotUnitContext, expectedMark: 'area' | 'line'): boolean {
  return (
    context.mark === expectedMark &&
    context.encoding.x.scale === 'temporal' &&
    isTemporal(context.x.type) &&
    context.x.type.temporal?.grain !== undefined &&
    isNumeric(context.y.type) &&
    context.rowGrain.includes(context.x.id)
  );
}

function bindBar(context: PlotUnitContext): Outcome<MeaningDefinition | undefined> {
  if (context.mark !== 'bar' || context.encoding.x.scale !== 'ordinal' || !isNumeric(context.y.type))
    return fail('bar', 'Bar views require categories and a quantitative zero baseline.');
  return { ok: true, value: undefined };
}

function bindScatter(context: PlotUnitContext): Outcome<MeaningDefinition | undefined> {
  if (!hasQuantitativeScatterAxes(context)) return fail('scatter', 'Scatter requires two quantitative axes.');
  return { ok: true, value: undefined };
}

function hasQuantitativeScatterAxes(context: PlotUnitContext): boolean {
  return (
    context.mark === 'point' &&
    isNumeric(context.x.type) &&
    isNumeric(context.y.type) &&
    ['linear', 'log'].includes(context.encoding.x.scale) &&
    ['linear', 'log'].includes(context.encoding.y.scale)
  );
}

function bindHistogram(
  spec: HistogramSpec,
  unit: BoundPlotUnit,
  context: PlotUnitContext,
  histograms: VisualizationBindingContext['histograms'],
): Outcome<MeaningDefinition | undefined> {
  const declaration = validateHistogramDeclaration(spec, unit, histograms);
  if (!declaration.ok) return declaration;
  if (!hasValidHistogramGeometry(spec, context, unit))
    return fail(
      'histogram',
      'Histogram requires executor-provided explicit numeric bin endpoints and a count or density measure.',
    );
  return { ok: true, value: undefined };
}

function validateHistogramDeclaration(
  spec: HistogramSpec,
  unit: BoundPlotUnit,
  histograms: VisualizationBindingContext['histograms'],
): Outcome<true> {
  const inspected = parseWireValue(histograms ?? []);
  if (!inspected.ok) return inspected;
  const declarations = z.safeParse(histogramBindingsSchema, inspected.value);
  if (!declarations.success || !hasExactHistogramDeclaration(declarations.data, spec, unit))
    return fail(
      'histogram',
      'The exact bin projection and count/density meaning must be declared once by the authorized host.',
    );
  return { ok: true, value: true };
}

function hasExactHistogramDeclaration(
  declarations: z.infer<typeof histogramBindingsSchema>,
  spec: HistogramSpec,
  unit: BoundPlotUnit,
): boolean {
  const matching = declarations.filter((binding) => matchesHistogramDeclaration(binding, spec, unit));
  return matching.length === 1;
}

function matchesHistogramDeclaration(
  binding: z.infer<typeof histogramBindingsSchema>[number],
  spec: HistogramSpec,
  unit: BoundPlotUnit,
): boolean {
  return (
    resultRefKey(binding.result) === resultRefKey(unit.result.ref) &&
    binding.bins.start === spec.bins.start &&
    binding.bins.end === spec.bins.end &&
    binding.bins.value === spec.bins.value &&
    binding.bins.measure === spec.bins.measure &&
    binding.bins.boundary === spec.bins.boundary
  );
}

function hasValidHistogramGeometry(spec: HistogramSpec, context: PlotUnitContext, unit: BoundPlotUnit): boolean {
  return (
    hasHistogramEncoding(spec, context) &&
    hasNumericHistogramFields(spec, context) &&
    hasCompatibleHistogramEndpoints(spec, context) &&
    hasValidHistogramMeasure(spec, context, unit)
  );
}

function hasHistogramEncoding(spec: HistogramSpec, context: PlotUnitContext): boolean {
  const { encoding, mark } = context;
  return (
    mark === 'rect' &&
    encoding.x.field === spec.bins.start &&
    encoding.x2?.field === spec.bins.end &&
    encoding.y.field === spec.bins.value &&
    encoding.y2 !== undefined
  );
}

function hasNumericHistogramFields(spec: HistogramSpec, context: PlotUnitContext): boolean {
  const { fields, x, y } = context;
  const end = fields.get(spec.bins.end);
  return isNumeric(x.type) && isNumeric(y.type) && end !== undefined;
}

function hasCompatibleHistogramEndpoints(spec: HistogramSpec, context: PlotUnitContext): boolean {
  const end = context.fields.get(spec.bins.end);
  return end !== undefined && semanticSignature(context.x.type) === semanticSignature(end.type);
}

function hasValidHistogramMeasure(spec: HistogramSpec, context: PlotUnitContext, unit: BoundPlotUnit): boolean {
  const { encoding, y } = context;
  return (
    encoding.x.scale === 'linear' &&
    encoding.y.scale === 'linear' &&
    encoding.y.zero === true &&
    unit.result.rowGrain.includes(spec.bins.start) &&
    unit.result.rowGrain.includes(spec.bins.end) &&
    (spec.bins.measure !== 'count' || y.type.value === 'integer')
  );
}

function bindHeatmap(context: PlotUnitContext, unit: BoundPlotUnit): Outcome<MeaningDefinition | undefined> {
  if (!hasValidHeatmapGeometry(context, unit))
    return fail('heatmap', 'Heatmap requires two declared grain dimensions and a quantitative color measure.');
  return { ok: true, value: undefined };
}

function hasValidHeatmapGeometry(context: PlotUnitContext, unit: BoundPlotUnit): boolean {
  return (
    hasValidHeatmapAxes(context) &&
    hasDistinctHeatmapDimensions(context) &&
    hasValidHeatmapColor(context) &&
    hasHeatmapDimensionsInGrain(context, unit)
  );
}

function hasValidHeatmapAxes(context: PlotUnitContext): boolean {
  return context.mark === 'cell' && context.encoding.x.scale === 'ordinal' && context.encoding.y.scale === 'ordinal';
}

function hasDistinctHeatmapDimensions(context: PlotUnitContext): boolean {
  return context.x.id !== context.y.id;
}

function hasValidHeatmapColor(context: PlotUnitContext): boolean {
  const color = context.encoding.color;
  if (color === undefined || color.scale !== 'linear') return false;
  const field = context.fields.get(color.field);
  return field !== undefined && isNumeric(field.type) && field.id !== context.x.id && field.id !== context.y.id;
}

function hasHeatmapDimensionsInGrain(context: PlotUnitContext, unit: BoundPlotUnit): boolean {
  return unit.result.rowGrain.includes(context.x.id) && unit.result.rowGrain.includes(context.y.id);
}

function unreachable(spec: never): never {
  return spec;
}
