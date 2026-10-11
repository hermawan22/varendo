import { parsePlotSpec } from './parse.js';
import { parseResult } from '../parse.js';
import { WIRE_LIMITS } from '../limits.js';
import type { PlotSpec, PlotNode, PlotUnit, PlotEncoding } from './types.js';
import type { Outcome, Result, SemanticType } from '../types.js';
import { resultRefKey } from '../stable.js';
import { isNumeric } from '../visualization/validation-common.js';

export interface BoundPlotUnit {
  readonly node: PlotUnit;
  readonly result: Result;
}

export interface BoundPlot {
  readonly spec: PlotSpec;
  readonly units: readonly BoundPlotUnit[];
}

interface VisitState {
  readonly results: ReadonlyMap<string, Result>;
  readonly units: BoundPlotUnit[];
  count: number;
}

const key = resultRefKey;

const fail = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `plot.${code}`, message, retryable: false }],
});

function signature(encoding: PlotEncoding, type: SemanticType): string {
  return JSON.stringify([
    encoding.scale,
    encoding.zero ?? false,
    type.value,
    type.unit?.dimension,
    type.unit?.symbol,
    type.unit?.currency,
    type.temporal?.calendar,
    type.temporal?.timezone,
    type.temporal?.grain,
    type.grain,
  ]);
}

function authorizedResultIndex(input: readonly Result[]): Outcome<Map<string, Result>> {
  if (!Array.isArray(input) || input.length > WIRE_LIMITS.outputs)
    return fail('results', 'The authorized descriptor set exceeds its bound.');
  const results = new Map<string, Result>();
  for (const candidate of input) {
    const parsed = parseResult(candidate);
    if (!parsed.ok) return parsed;
    const result = parsed.value;
    if (results.has(key(result.ref))) return fail('results', 'Result references must be unique.');
    if (new Set(result.fields.map((field) => field.id)).size !== result.fields.length)
      return fail('fields', 'Result fields must have unique identities.');
    results.set(key(result.ref), result);
  }
  return { ok: true, value: results };
}

function fieldType(result: Result, encoding: PlotEncoding): SemanticType {
  return result.fields.find((field) => field.id === encoding.field)!.type;
}

function validateScale(encoding: PlotEncoding, type: SemanticType): Outcome<void> {
  if ((encoding.scale === 'linear' || encoding.scale === 'log') && !isNumeric(type))
    return fail('scale', 'A quantitative scale requires a numeric field.');
  if (encoding.scale === 'temporal' && type.value !== 'date' && type.value !== 'instant')
    return fail('scale', 'A temporal scale requires a date or instant field.');
  if (encoding.zero && encoding.scale !== 'linear') return fail('zero', 'Zero is supported only on linear scales.');
  return { ok: true, value: undefined };
}

function validateChannel(channel: string, encoding: PlotEncoding): Outcome<void> {
  if (channel === 'size' && encoding.scale !== 'linear') return fail('size', 'Size requires a linear scale.');
  if (channel === 'series' && encoding.scale !== 'ordinal')
    return fail('series', 'Series grouping requires an ordinal scale.');
  return { ok: true, value: undefined };
}

function validateEncoding(channel: string, encoding: PlotEncoding, result: Result): Outcome<void> {
  const field = result.fields.find((candidate) => candidate.id === encoding.field);
  if (field === undefined) return fail('field', 'An encoded field is absent from the result.');
  const scale = validateScale(encoding, field.type);
  if (!scale.ok) return scale;
  return validateChannel(channel, encoding);
}

function validateMark(unit: PlotUnit): Outcome<void> {
  const { mark, encoding } = unit;
  if ((mark === 'line' || mark === 'area') && !['linear', 'log'].includes(encoding.y.scale))
    return fail('mark', 'Line and area marks require quantitative y values.');
  if ((mark === 'bar' || mark === 'area') && (encoding.y.scale !== 'linear' || encoding.y.zero !== true))
    return fail('baseline', 'Bar and area marks require a linear y scale with a zero baseline.');
  if ((mark === 'rect' || mark === 'link') && (encoding.x2 === undefined || encoding.y2 === undefined))
    return fail('endpoint', 'Rect and link marks require explicit second endpoints.');
  return { ok: true, value: undefined };
}

function validateEndpoints(unit: PlotUnit, result: Result): Outcome<void> {
  const { encoding } = unit;
  const endpoints = [
    [encoding.x, encoding.x2],
    [encoding.y, encoding.y2],
  ] as const;
  for (const [first, second] of endpoints) {
    if (second === undefined) continue;
    if (signature(first, fieldType(result, first)) !== signature(second, fieldType(result, second)))
      return fail('endpoint', 'Endpoint scales and semantic types must be compatible.');
  }
  return { ok: true, value: undefined };
}

function bindUnit(unit: PlotUnit, results: ReadonlyMap<string, Result>): Outcome<BoundPlotUnit> {
  const result = results.get(key(unit.result));
  if (result === undefined) return fail('result', 'The exact result revision and scope are unavailable.');
  for (const [channel, encoding] of Object.entries(unit.encoding)) {
    const checked = validateEncoding(channel, encoding, result);
    if (!checked.ok) return checked;
  }
  const mark = validateMark(unit);
  if (!mark.ok) return mark;
  const endpoints = validateEndpoints(unit, result);
  if (!endpoints.ok) return endpoints;
  return { ok: true, value: { node: unit, result } };
}

function childrenOf(node: Exclude<PlotNode, PlotUnit>): readonly PlotNode[] {
  if (node.kind === 'facet') return [node.child];
  return node.children;
}

function validateFacet(node: Exclude<PlotNode, PlotUnit>, descendants: readonly BoundPlotUnit[]): Outcome<void> {
  if (node.kind !== 'facet') return { ok: true, value: undefined };
  const fieldMissing = descendants.some((unit) => !unit.result.fields.some((field) => field.id === node.field));
  if (fieldMissing) return fail('facet', 'The facet field must exist in every child result.');
  const types = descendants.map((unit) => {
    const type = fieldType(unit.result, { field: node.field, scale: 'ordinal' });
    return JSON.stringify([type.value, type.nullable, signature({ field: node.field, scale: 'ordinal' }, type)]);
  });
  if (new Set(types).size > 1)
    return fail(
      'facet-type',
      'Facet fields require the same semantic type, unit and temporal policy across child results.',
    );
  return { ok: true, value: undefined };
}

function validateSharedScales(node: Exclude<PlotNode, PlotUnit>, descendants: readonly BoundPlotUnit[]): Outcome<void> {
  if (node.kind === 'concat' || node.scales !== 'shared-compatible') return { ok: true, value: undefined };
  const signatures = new Map<string, string>();
  for (const unit of descendants) {
    for (const [channel, encoding] of Object.entries(unit.node.encoding)) {
      const value = signature(encoding, fieldType(unit.result, encoding));
      const prior = signatures.get(channel);
      if (prior !== undefined && prior !== value)
        return fail('shared-scale', 'Shared scales require compatible field types, units and temporal policies.');
      signatures.set(channel, value);
    }
  }
  return { ok: true, value: undefined };
}

function visit(node: PlotNode, state: VisitState): Outcome<readonly BoundPlotUnit[]> {
  state.count += 1;
  if (state.count > 128) return fail('budget', 'The plot exceeds 128 composition nodes.');
  if (node.kind === 'unit') {
    const bound = bindUnit(node, state.results);
    if (!bound.ok) return bound;
    state.units.push(bound.value);
    return { ok: true, value: [bound.value] };
  }
  const descendants: BoundPlotUnit[] = [];
  for (const child of childrenOf(node)) {
    const childResult = visit(child, state);
    if (!childResult.ok) return childResult;
    descendants.push(...childResult.value);
  }
  const facet = validateFacet(node, descendants);
  if (!facet.ok) return facet;
  const scales = validateSharedScales(node, descendants);
  if (!scales.ok) return scales;
  return { ok: true, value: descendants };
}

/** The caller supplies currently authorized descriptors; binding never reads or authorizes data. */
export function bindPlotSpec(input: unknown, authorizedResults: readonly Result[]): Outcome<BoundPlot> {
  const parsed = parsePlotSpec(input);
  if (!parsed.ok) return parsed;
  const results = authorizedResultIndex(authorizedResults);
  if (!results.ok) return results;
  const state: VisitState = { results: results.value, units: [], count: 0 };
  const checked = visit(parsed.value.root, state);
  if (!checked.ok) return checked;
  return { ok: true, value: { spec: parsed.value, units: state.units } };
}
