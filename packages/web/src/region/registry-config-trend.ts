import type { Outcome, Result, Task } from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationValues,
  ResolvedPresentationConfig,
} from '@varendo/core/presentation';
import { AELIQO_OPERATION_REFS, MAX_ITEMS } from './registry-contracts.js';
import { allowedKeys } from './data-registry-common.js';
import {
  fail,
  fieldMap,
  numericField,
  optionalText,
  record,
  temporalField,
  text,
  trendGrain,
  unitKey,
} from './registry-config-common.js';

interface TrendInput {
  readonly labelField: string;
  readonly fields: Map<string, Result['fields'][number]>;
  readonly series: readonly unknown[];
  readonly seriesBy: unknown;
}

interface TrendSeries {
  readonly field: string;
  readonly label: string;
  readonly unit?: string;
}

interface ParsedSeriesItem {
  readonly series: TrendSeries;
  readonly unitKey: string;
}

export function trendConfig(
  values: PresentationValues,
  result: Result | undefined,
): Outcome<ResolvedPresentationConfig> {
  if (result === undefined) return fail('binding', 'A trend requires a bound result.');
  const input = trendInput(values, result);
  if (!input.ok) return input;
  const series = normalizeSeries(input.value.series, input.value.fields);
  if (!series.ok) return series;
  const grouping = normalizeSeriesBy(input.value.seriesBy, input.value);
  if (!grouping.ok) return grouping;
  const grain = trendGrain(grouping.value, input.value.labelField, result);
  if (!grain.ok) return grain;
  return resolvedTrend(input.value, series.value, grouping.value);
}

function trendInput(values: PresentationValues, result: Result): Outcome<TrendInput> {
  const input = record(values);
  if (input === undefined) return fail('config', 'The trend configuration must be an object.');
  if (Object.keys(input).some((key) => !['labelField', 'series', 'seriesBy'].includes(key)))
    return fail('config', 'The trend configuration contains an unknown field.');
  const label = text(input.labelField, 'labelField');
  if (!label.ok) return label;
  const fields = fieldMap(result);
  const temporal = fields.get(label.value);
  if (temporal === undefined || !temporalField(temporal))
    return fail('field', 'labelField must be a declared temporal date or instant field.');
  const series = seriesInput(input.series);
  if (!series.ok) return series;
  return { ok: true, value: { labelField: label.value, fields, series: series.value, seriesBy: input.seriesBy } };
}

function seriesInput(value: unknown): Outcome<readonly unknown[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    return fail('config', 'series must contain one to eight entries.');
  return { ok: true, value };
}

function normalizeSeries(
  items: readonly unknown[],
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<readonly TrendSeries[]> {
  const result: TrendSeries[] = [];
  const seen = new Set<string>();
  let firstUnitKey: string | undefined;
  for (const item of items) {
    const parsed = normalizeSeriesItem(item, fields, seen, firstUnitKey);
    if (!parsed.ok) return parsed;
    result.push(parsed.value.series);
    seen.add(parsed.value.series.field);
    firstUnitKey ??= parsed.value.unitKey;
  }
  return { ok: true, value: result };
}

function normalizeSeriesItem(
  item: unknown,
  fields: ReadonlyMap<string, Result['fields'][number]>,
  seen: ReadonlySet<string>,
  firstUnitKey: string | undefined,
): Outcome<ParsedSeriesItem> {
  const parsedCandidate = seriesCandidate(item);
  if (!parsedCandidate.ok) return parsedCandidate;
  const field = seriesField(parsedCandidate.value, fields, seen);
  if (!field.ok) return field;
  const { candidate, descriptor, fieldId } = field.value;
  const label = seriesLabel(candidate, descriptor.label, fieldId);
  if (!label.ok) return label;
  const unit = optionalText(candidate, 'unit');
  if (!unit.ok) return unit;
  const descriptorUnit = descriptor.type.unit?.symbol;
  if (unit.value !== undefined && unit.value !== descriptorUnit)
    return fail('field', `Trend series ${fieldId} must use its registered descriptor unit.`);
  const resolvedUnitKey = unitKey(descriptor);
  if (firstUnitKey !== undefined && resolvedUnitKey !== firstUnitKey)
    return fail('field', 'Trend series fields must use one compatible numeric unit on a shared y-axis.');
  return {
    ok: true,
    value: {
      series: {
        field: fieldId,
        label: label.value,
        ...(descriptorUnit === undefined ? {} : { unit: descriptorUnit }),
      },
      unitKey: resolvedUnitKey,
    },
  };
}

function seriesCandidate(item: unknown): Outcome<Record<string, unknown>> {
  const candidate = record(item);
  if (candidate === undefined || !validSeriesKeys(candidate))
    return fail('config', 'Trend series entries are malformed.');
  return { ok: true, value: candidate };
}

function seriesField(
  candidate: Record<string, unknown>,
  fields: ReadonlyMap<string, Result['fields'][number]>,
  seen: ReadonlySet<string>,
): Outcome<{
  readonly fieldId: string;
  readonly descriptor: Result['fields'][number];
  readonly candidate: Record<string, unknown>;
}> {
  const field = text(candidate.field, 'series.field');
  if (!field.ok) return field;
  const descriptor = fields.get(field.value);
  if (descriptor === undefined || !numericField(descriptor) || seen.has(field.value))
    return fail('field', 'Trend series fields must be unique declared numeric fields in the bound result.');
  return { ok: true, value: { fieldId: field.value, descriptor, candidate } };
}

function validSeriesKeys(candidate: Record<string, unknown>): boolean {
  return allowedKeys(candidate, ['field', 'label', 'unit']);
}

function seriesLabel(candidate: Record<string, unknown>, descriptorLabel: string, field: string): Outcome<string> {
  if (candidate.label === undefined) return { ok: true, value: descriptorLabel };
  const label = text(candidate.label, 'series.label');
  if (!label.ok) return label;
  if (label.value !== descriptorLabel)
    return fail('field', `Trend series ${field} must use its registered descriptor label.`);
  return label;
}

function normalizeSeriesBy(raw: unknown, input: TrendInput): Outcome<readonly string[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!isBoundedSeriesBy(raw)) return fail('config', 'seriesBy must contain bounded result field IDs.');
  if (!isValidSeriesBy(raw, input))
    return fail('field', 'seriesBy fields must be unique grouping fields distinct from temporal and measure fields.');
  return { ok: true, value: [...raw] };
}

function isBoundedSeriesBy(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ITEMS &&
    value.every((field) => typeof field === 'string' && field.length > 0)
  );
}

function isValidSeriesBy(seriesBy: readonly string[], input: TrendInput): boolean {
  const seriesFields = new Set(input.series.map((entry) => record(entry)?.field));
  return (
    new Set(seriesBy).size === seriesBy.length &&
    seriesBy.every((field) => input.fields.has(field) && field !== input.labelField && !seriesFields.has(field))
  );
}

function resolvedTrend(
  input: TrendInput,
  series: readonly TrendSeries[],
  seriesBy: readonly string[],
): Outcome<ResolvedPresentationConfig> {
  const fields = [input.labelField, ...seriesBy, ...series.map((entry) => entry.field)];
  const values: Record<string, unknown> = { labelField: input.labelField, series, seriesBy };
  return {
    ok: true,
    value: {
      values: values as PresentationValues,
      fields,
      ports: [],
      operations: [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze],
    },
  };
}

export function assessTrend(
  _config: ResolvedPresentationConfig,
  _result: Result | undefined,
  environment: PresentationEnvironment,
) {
  const narrow = environment.inlineSize.state === 'known' && environment.inlineSize.value < 480;
  return {
    ok: true as const,
    value: {
      taskFit: 90,
      informationDensity: narrow ? 60 : 75,
      interactionEffort: narrow ? 20 : 10,
      legibilityPenalty: narrow ? 5 : 0,
    },
  };
}

export function suggestTrend(
  needs: readonly Task['needs'][number][],
  result: Result | undefined,
): Outcome<PresentationValues> {
  if (result === undefined || result.fields.length === 0)
    return fail('suggestion', 'A trend suggestion requires an authorized result descriptor.');
  const requested = new Set(needs.flatMap((need) => need.fields));
  const label = preferredField(result, requested, temporalField) ?? result.fields.find(temporalField);
  const series = preferredSeries(result, requested, label?.id) ?? anySeries(result, label?.id);
  if (label === undefined || series === undefined)
    return fail('suggestion', 'A trend suggestion requires a temporal field and numeric series field.');
  const seriesBy = result.rowGrain.filter((field) => field !== label.id && field !== series.id && requested.has(field));
  const grain = trendGrain(seriesBy, label.id, result);
  if (!grain.ok) return grain;
  return { ok: true, value: { labelField: label.id, series: [{ field: series.id }], seriesBy } };
}

function preferredField(
  result: Result,
  requested: ReadonlySet<string>,
  matches: (field: Result['fields'][number]) => boolean,
) {
  return result.fields.find((field) => matches(field) && requested.has(field.id));
}

function preferredSeries(result: Result, requested: ReadonlySet<string>, labelId: string | undefined) {
  return result.fields.find((field) => numericField(field) && requested.has(field.id) && field.id !== labelId);
}

function anySeries(result: Result, labelId: string | undefined) {
  return result.fields.find((field) => numericField(field) && field.id !== labelId);
}
