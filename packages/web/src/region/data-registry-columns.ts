import type { Outcome, Result } from '@varendo/core';
import type { VarendoDataColumn } from '../data/index.js';
import { boundedText, failure, fieldMap, MAX_DATA_ITEMS, object } from './data-registry-common.js';

type ColumnDescriptor = Result['fields'][number];
type ColumnCandidate = Record<string, unknown>;
type ColumnAlignment = 'start' | 'center' | 'end';

const COLUMN_KEYS: readonly string[] = ['key', 'label', 'type', 'sortable', 'align'];

function columnCandidate(value: unknown): Outcome<ColumnCandidate> {
  const candidate = object(value);
  if (candidate === undefined || Object.keys(candidate).some((key) => !COLUMN_KEYS.includes(key))) {
    return failure('config', 'A data column contains an unknown property.');
  }
  return { ok: true, value: candidate };
}

function columnDescriptor(
  candidate: ColumnCandidate,
  fields: ReadonlyMap<string, ColumnDescriptor>,
): Outcome<ColumnDescriptor> {
  const key = boundedText(candidate.key, 'column.key');
  if (!key.ok) return key;
  const descriptor = fields.get(key.value);
  if (descriptor === undefined) return failure('field', `Column ${key.value} is not a unique authorized field.`);
  return { ok: true, value: descriptor };
}

function validateColumnLabel(candidate: ColumnCandidate, descriptor: ColumnDescriptor): Outcome<void> {
  if (candidate.label === undefined) return { ok: true, value: undefined };
  const label = boundedText(candidate.label, 'column.label');
  if (!label.ok) return label;
  if (label.value !== descriptor.label) {
    return failure('field', `Column ${descriptor.id} must use the registered field label.`);
  }
  return { ok: true, value: undefined };
}

function validateColumnType(candidate: ColumnCandidate, descriptor: ColumnDescriptor): Outcome<void> {
  if (candidate.type !== undefined && candidate.type !== descriptor.type.value) {
    return failure('field', `Column ${descriptor.id} must use the registered semantic type.`);
  }
  return { ok: true, value: undefined };
}

function validateColumnSortable(candidate: ColumnCandidate): Outcome<boolean | undefined> {
  if (candidate.sortable === undefined) return { ok: true, value: undefined };
  if (typeof candidate.sortable !== 'boolean') return failure('config', 'column.sortable must be boolean.');
  return { ok: true, value: candidate.sortable };
}

function validateColumnAlignment(candidate: ColumnCandidate): Outcome<ColumnAlignment | undefined> {
  if (candidate.align === undefined) return { ok: true, value: undefined };
  if (candidate.align !== 'start' && candidate.align !== 'center' && candidate.align !== 'end') {
    return failure('config', 'column.align is invalid.');
  }
  return { ok: true, value: candidate.align };
}

function normalizeColumn(
  value: unknown,
  fields: ReadonlyMap<string, ColumnDescriptor>,
  seen: ReadonlySet<string>,
): Outcome<VarendoDataColumn> {
  const parsed = columnCandidate(value);
  if (!parsed.ok) return parsed;
  const descriptor = columnDescriptor(parsed.value, fields);
  if (!descriptor.ok) return descriptor;
  if (seen.has(descriptor.value.id)) {
    return failure('field', `Column ${descriptor.value.id} is not a unique authorized field.`);
  }
  const label = validateColumnLabel(parsed.value, descriptor.value);
  if (!label.ok) return label;
  const type = validateColumnType(parsed.value, descriptor.value);
  if (!type.ok) return type;
  const sortable = validateColumnSortable(parsed.value);
  if (!sortable.ok) return sortable;
  const align = validateColumnAlignment(parsed.value);
  if (!align.ok) return align;
  return {
    ok: true,
    value: {
      key: descriptor.value.id,
      label: descriptor.value.label,
      type: descriptor.value.type.value,
      ...(sortable.value === undefined ? {} : { sortable: sortable.value }),
      ...(align.value === undefined ? {} : { align: align.value }),
    },
  };
}

function parseColumns(raw: unknown, result: Result): Outcome<readonly VarendoDataColumn[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DATA_ITEMS) {
    return failure('config', 'columns must be a bounded nonempty array.');
  }
  const fields = fieldMap(result);
  const output: VarendoDataColumn[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const column = normalizeColumn(item, fields, seen);
    if (!column.ok) return column;
    seen.add(column.value.key);
    output.push(column.value);
  }
  return { ok: true, value: output };
}

export function columns(
  input: Readonly<Record<string, unknown>>,
  result: Result,
  fallback?: readonly VarendoDataColumn[],
): Outcome<readonly VarendoDataColumn[]> {
  if (input.columns !== undefined) return parseColumns(input.columns, result);
  if (fallback !== undefined) return parseColumns(fallback, result);
  return {
    ok: true,
    value: result.fields.map((field) => ({ key: field.id, label: field.label, type: field.type.value })),
  };
}
