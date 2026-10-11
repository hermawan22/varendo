import { parseWireValue, scalarIdentity, validateScalar } from '@varendo/core';
import type { Outcome, Result, Scalar } from '@varendo/core';
import { fail } from './shared.js';
import type { PlotDatum, PlotFields } from './types.js';

interface ParsedRows {
  readonly rows: readonly PlotDatum[];
  readonly fields: PlotFields;
}

function parseRecord(value: unknown, fields: PlotFields, identityFields: readonly string[]): Outcome<PlotDatum> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return fail('row', 'A plot row must be a record.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.has(key)))
    return fail('row-field', 'A plot row contains a field outside the authorized descriptor.');
  const values: Record<string, Scalar> = Object.create(null) as Record<string, Scalar>;
  for (const field of fields.values()) {
    const raw = Object.hasOwn(row, field.id) ? row[field.id] : undefined;
    const checked = validateScalar(raw === undefined && field.type.nullable ? null : raw, field.type);
    if (!checked.ok) return checked;
    values[field.id] = checked.value;
  }
  const identity = rowIdentity(values, fields, identityFields);
  if (!identity.ok) return identity;
  return { ok: true, value: { identity: identity.value, values } };
}

function rowIdentity(
  values: Readonly<Record<string, Scalar>>,
  fields: PlotFields,
  identityFields: readonly string[],
): Outcome<string> {
  const parts: string[] = [];
  for (const fieldId of identityFields) {
    const field = fields.get(fieldId);
    if (field === undefined) return fail('identity', 'An identity field is missing.');
    const value = values[fieldId];
    if (value === null || value === undefined) return fail('identity', 'Identity values cannot be missing.');
    const identity = scalarIdentity(value, field.type);
    if (!identity.ok) return identity;
    parts.push(identity.value);
  }
  return { ok: true, value: JSON.stringify(parts) };
}

export function prepareRows(input: unknown, descriptor: Result, maxRows: number): Outcome<ParsedRows> {
  const inspected = parseWireValue(input);
  if (!inspected.ok) return inspected;
  const values = inspected.value;
  if (!Array.isArray(values) || values.length > maxRows) return fail('rows', 'The plot exceeds the loaded-row budget.');
  if (values.length * descriptor.fields.length > 100_000)
    return fail('cell-budget', 'The loaded data exceeds the bounded cell budget.');
  if (values.length !== descriptor.counts.loaded)
    return fail('scope', 'The supplied rows do not match the descriptor loaded count.');
  if (descriptor.identity.length === 0) return fail('identity', 'Interactive plots require stable result identities.');
  const fields = new Map(descriptor.fields.map((field) => [field.id, field]));
  const rows: PlotDatum[] = [];
  const identities = new Set<string>();
  for (const value of values) {
    const row = parseRecord(value, fields, descriptor.identity);
    if (!row.ok) return row;
    if (identities.has(row.value.identity)) return fail('identity', 'Plot row identities must be unique.');
    identities.add(row.value.identity);
    rows.push(row.value);
  }
  return { ok: true, value: { rows, fields } };
}

export function selectRows(
  rows: readonly PlotDatum[],
  identities: readonly string[] | undefined,
  maxRows: number,
): Outcome<readonly PlotDatum[]> {
  if (identities === undefined) return { ok: true, value: rows };
  const available = new Set(rows.map((row) => row.identity));
  if (identities.length > maxRows || identities.some((id) => !available.has(id)))
    return fail('projection', 'The display projection references unavailable rows.');
  const selected = new Set(identities);
  return { ok: true, value: rows.filter((row) => selected.has(row.identity)) };
}
