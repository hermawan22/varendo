import type { Outcome, Result, SemanticType } from '@varendo/core';
import type { AeliqoDataColumn } from '../data/index.js';
import type { AeliqoDataResolvedConfig, AeliqoValidatedBinding } from './data-registry-types.js';
import { columns } from './data-registry-columns.js';
import {
  allowedKeys,
  boundedText,
  commonConfig,
  failure,
  fieldMap,
  identityFields,
  MAX_DATA_ITEMS,
  numeric,
  object,
  unitKey,
  validFieldList,
} from './data-registry-common.js';
import {
  aliasedObservation,
  observationSelector,
  selectOne,
  type DeltaObservationInput,
} from './data-registry-selection.js';

interface NumericField {
  readonly id: string;
  readonly descriptor: Result['fields'][number];
}

interface DeltaInputPair {
  readonly current: DeltaObservationInput;
  readonly baseline: DeltaObservationInput;
}

interface DeltaSelectorPair {
  readonly current: Readonly<Record<string, unknown>>;
  readonly baseline: Readonly<Record<string, unknown>>;
}

interface DeltaFieldPair {
  readonly current: NumericField;
  readonly baseline: NumericField;
}

interface ResolvedKeyValueFields {
  readonly ids: readonly string[];
  readonly columns: readonly AeliqoDataColumn[];
}

interface ResolvedDetailFields {
  readonly fields: readonly string[];
  readonly columns: readonly AeliqoDataColumn[];
  readonly identity: readonly string[];
}

function keyValueColumn(
  raw: unknown,
  fields: ReadonlyMap<string, Result['fields'][number]>,
  seen: ReadonlySet<string>,
): Outcome<AeliqoDataColumn> {
  const item = object(raw);
  if (
    item === undefined ||
    !Object.hasOwn(item, 'field') ||
    !allowedKeys(item, ['field', 'label', 'description', 'displayValue', 'href'])
  ) {
    return failure('config', 'KeyValue items are malformed.');
  }
  const id = boundedText(item.field, 'item.field');
  if (!id.ok) return id;
  const descriptor = fields.get(id.value);
  if (descriptor === undefined || seen.has(id.value)) {
    return failure('field', `KeyValue field ${id.value} is not unique in the Result.`);
  }
  if (item.label !== undefined && item.label !== descriptor.label) {
    return failure('field', `KeyValue field ${id.value} must use its registered label.`);
  }
  return { ok: true, value: { key: id.value, label: descriptor.label, type: descriptor.type.value } };
}

function scalarField(result: Result, fieldId: unknown, role: string): Outcome<NumericField> {
  const field = boundedText(fieldId, role);
  if (!field.ok) return field;
  const descriptor = fieldMap(result).get(field.value);
  if (descriptor === undefined) return failure('field', `${role} must name a declared Result field.`);
  if (!numeric(descriptor.type)) return failure('field', `${role} must name a numeric Result field.`);
  return { ok: true, value: { id: field.value, descriptor } };
}

function isFractionRatio(type: SemanticType): boolean {
  return type.unit?.dimension === 'ratio' && type.unit.symbol === '1' && type.unit.currency === undefined;
}

function isExplicitFractionRatioType(current: SemanticType, baseline: SemanticType): boolean {
  return isFractionRatio(current) && isFractionRatio(baseline);
}

function metricColumn(field: NumericField): AeliqoDataColumn {
  return {
    key: field.id,
    label: field.descriptor.label,
    type: field.descriptor.type.value,
  };
}

export function resolveMetric(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<AeliqoDataResolvedConfig> {
  if (!allowedKeys(input, ['field', 'identityValues', 'rowIdentity', 'label'])) {
    return failure('config', 'Metric configuration contains an unknown property.');
  }
  const field = scalarField(binding.result, input.field, 'field');
  if (!field.ok) return field;
  if (input.label !== undefined && input.label !== field.value.descriptor.label) {
    return failure('field', 'Metric label must use the registered field label.');
  }
  const selected = selectOne(input, binding);
  if (!selected.ok) return selected;
  return {
    ok: true,
    value: {
      ...commonConfig(input, {
        fields: [field.value.id],
        columns: [metricColumn(field.value)],
        identity: binding.result.identity,
        selection: 'none',
      }),
      metricField: field.value.id,
      selectedRow: selected.value.row,
      selectedIndex: selected.value.index,
    },
  };
}

function resolveDeltaInputs(input: Readonly<Record<string, unknown>>): Outcome<DeltaInputPair> {
  const current = aliasedObservation(input, 'currentField', 'current');
  if (!current.ok) return current;
  const baseline = aliasedObservation(input, 'baselineField', 'baseline');
  if (!baseline.ok) return baseline;
  return { ok: true, value: { current: current.value, baseline: baseline.value } };
}

function resolveDeltaSelectors(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
  observations: DeltaInputPair,
): Outcome<DeltaSelectorPair> {
  const current = observationSelector(input, observations.current, binding.result, 'Current');
  if (!current.ok) return current;
  const baseline = observationSelector(input, observations.baseline, binding.result, 'Baseline');
  if (!baseline.ok) return baseline;
  return { ok: true, value: { current: current.value, baseline: baseline.value } };
}

function resolveDeltaFields(binding: AeliqoValidatedBinding, observations: DeltaInputPair): Outcome<DeltaFieldPair> {
  const current = scalarField(binding.result, observations.current.field, 'currentField');
  if (!current.ok) return current;
  const baseline = scalarField(binding.result, observations.baseline.field, 'baselineField');
  if (!baseline.ok) return baseline;
  return { ok: true, value: { current: current.value, baseline: baseline.value } };
}

function deltaMode(
  raw: unknown,
  current: NumericField,
  baseline: NumericField,
): Outcome<'absolute' | 'relative' | 'percentage-point'> {
  if (unitKey(current.descriptor.type) !== unitKey(baseline.descriptor.type)) {
    return failure('unit', 'Delta observations must use compatible declared units.');
  }
  const mode = raw ?? 'absolute';
  if (mode !== 'absolute' && mode !== 'relative' && mode !== 'percentage-point') {
    return failure('config', 'Delta mode is invalid.');
  }
  if (mode === 'percentage-point' && !isExplicitFractionRatioType(current.descriptor.type, baseline.descriptor.type)) {
    return failure('unsupported', 'Percentage-point deltas require two explicitly declared fraction-ratio fields.');
  }
  return { ok: true, value: mode };
}

function deltaFields(current: NumericField, baseline: NumericField): readonly string[] {
  if (current.id === baseline.id) return [current.id];
  return [current.id, baseline.id];
}

export function resolveDelta(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<AeliqoDataResolvedConfig> {
  if (
    !allowedKeys(input, [
      'currentField',
      'baselineField',
      'current',
      'baseline',
      'mode',
      'identityValues',
      'rowIdentity',
      'label',
    ])
  ) {
    return failure('config', 'Delta configuration contains an unknown property.');
  }
  const observations = resolveDeltaInputs(input);
  if (!observations.ok) return observations;
  const selectors = resolveDeltaSelectors(input, binding, observations.value);
  if (!selectors.ok) return selectors;
  const fields = resolveDeltaFields(binding, observations.value);
  if (!fields.ok) return fields;
  const mode = deltaMode(input.mode, fields.value.current, fields.value.baseline);
  if (!mode.ok) return mode;
  const currentRow = selectOne(selectors.value.current, binding);
  if (!currentRow.ok) return currentRow;
  const baselineRow = selectOne(selectors.value.baseline, binding);
  if (!baselineRow.ok) return baselineRow;
  return {
    ok: true,
    value: {
      ...commonConfig(input, {
        fields: deltaFields(fields.value.current, fields.value.baseline),
        columns: [],
        identity: binding.result.identity,
        selection: 'none',
      }),
      selectedRow: currentRow.value.row,
      selectedIndex: currentRow.value.index,
      delta: {
        currentField: fields.value.current.id,
        baselineField: fields.value.baseline.id,
        mode: mode.value,
        currentRow: currentRow.value.row,
        baselineRow: baselineRow.value.row,
      },
    },
  };
}

function resolveKeyValueFields(raw: unknown, result: Result): Outcome<ResolvedKeyValueFields> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DATA_ITEMS) {
    return failure('config', 'KeyValue items must be a bounded nonempty array.');
  }
  const fields = fieldMap(result);
  const ids: string[] = [];
  const seen = new Set<string>();
  const output: AeliqoDataColumn[] = [];
  for (const rawItem of raw) {
    const column = keyValueColumn(rawItem, fields, seen);
    if (!column.ok) return column;
    ids.push(column.value.key);
    seen.add(column.value.key);
    output.push(column.value);
  }
  return { ok: true, value: { ids, columns: output } };
}

export function resolveKeyValue(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<AeliqoDataResolvedConfig> {
  if (!allowedKeys(input, ['items', 'identityValues', 'rowIdentity'])) {
    return failure('config', 'KeyValue configuration contains an unknown property.');
  }
  const resolved = resolveKeyValueFields(input.items, binding.result);
  if (!resolved.ok) return resolved;
  const selected = selectOne(input, binding);
  if (!selected.ok) return selected;
  return {
    ok: true,
    value: {
      ...commonConfig(input, {
        fields: resolved.value.ids,
        columns: resolved.value.columns,
        identity: binding.result.identity,
        selection: 'none',
      }),
      selectedRow: selected.value.row,
      selectedIndex: selected.value.index,
    },
  };
}

function validateDetailFields(raw: unknown, result: Result): Outcome<readonly string[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  return validFieldList(raw, result);
}

function checkAuthorizedFields(
  fields: readonly string[] | undefined,
  authorizedColumns: ReadonlySet<string>,
): Outcome<void> {
  if (fields !== undefined && fields.some((field) => !authorizedColumns.has(field))) {
    return failure('field', 'Detail fields must be supplied by the authorized column set.');
  }
  return { ok: true, value: undefined };
}

function resolveDetailColumns(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
  fields: readonly string[] | undefined,
  authorizedColumns: ReadonlySet<string>,
): Outcome<readonly AeliqoDataColumn[]> {
  let fallback: readonly AeliqoDataColumn[] | undefined;
  if (input.columns === undefined) {
    fallback = binding.columns.filter((column) => fields === undefined || fields.includes(column.key));
  }
  const resolved = columns(input, binding.result, fallback);
  if (!resolved.ok) return resolved;
  if (resolved.value.some((column) => !authorizedColumns.has(column.key))) {
    return failure('field', 'Detail columns must be supplied by the authorized column set.');
  }
  return resolved;
}

function validateDetailColumnSelection(columns: readonly AeliqoDataColumn[], fields: readonly string[]): Outcome<void> {
  if (columns.length !== fields.length || fields.some((field) => !columns.some((column) => column.key === field))) {
    return failure('field', 'Detail columns must be included in the configured fields.');
  }
  return { ok: true, value: undefined };
}

function resolveDetailFields(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<ResolvedDetailFields> {
  const fields = validateDetailFields(input.fields, binding.result);
  if (!fields.ok) return fields;
  const identity = identityFields(input, binding.result);
  if (!identity.ok) return identity;
  const authorizedColumns = new Set(binding.columns.map((column) => column.key));
  const allowedFields = checkAuthorizedFields(fields.value, authorizedColumns);
  if (!allowedFields.ok) return allowedFields;
  const resolvedColumns = resolveDetailColumns(input, binding, fields.value, authorizedColumns);
  if (!resolvedColumns.ok) return resolvedColumns;
  const resolvedFields = fields.value ?? resolvedColumns.value.map((column) => column.key);
  const consistent = validateDetailColumnSelection(resolvedColumns.value, resolvedFields);
  if (!consistent.ok) return consistent;
  return {
    ok: true,
    value: { fields: resolvedFields, columns: resolvedColumns.value, identity: identity.value },
  };
}

export function resolveDetail(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<AeliqoDataResolvedConfig> {
  if (
    !allowedKeys(input, [
      'fields',
      'columns',
      'identity',
      'identityValues',
      'rowIdentity',
      'title',
      'entity',
      'showIdentity',
    ])
  ) {
    return failure('config', 'Detail configuration contains an unknown property.');
  }
  const resolved = resolveDetailFields(input, binding);
  if (!resolved.ok) return resolved;
  const selected = selectOne(input, binding);
  if (!selected.ok) return selected;
  if (input.showIdentity !== undefined && typeof input.showIdentity !== 'boolean') {
    return failure('config', 'Detail showIdentity must be boolean when provided.');
  }
  return {
    ok: true,
    value: {
      ...commonConfig(input, {
        fields: resolved.value.fields,
        columns: resolved.value.columns,
        identity: resolved.value.identity,
        selection: 'none',
      }),
      selectedRow: selected.value.row,
      selectedIndex: selected.value.index,
      detailRow: selected.value.row,
    },
  };
}
