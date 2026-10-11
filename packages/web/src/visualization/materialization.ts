import { parseWireValue, scalarIdentity, validateScalar } from '@varendo/core';
import type { BoundVisualization } from '@varendo/core/visualization';
import type { Outcome, Result, Scalar } from '@varendo/core';
import type { VisualizationDataset, VisualizationRow } from './types.js';

const REQUIRED_REFERENCE_FIELDS = ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest'] as const;
const REFERENCE_FIELDS = new Set([...REQUIRED_REFERENCE_FIELDS, 'sourceLineage']);

const key = (result: Result['ref']): string =>
  JSON.stringify([
    result.id,
    result.revision,
    result.sourceLineage ?? null,
    result.outputId,
    result.queryDigest,
    result.scopeDigest,
  ]);

const fail = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `visualization.${code}`, message, retryable: false }],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExactReference(value: unknown): value is Result['ref'] {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length < 5 || keys.length > 6 || keys.some((name) => !REFERENCE_FIELDS.has(name))) return false;
  if (
    !REQUIRED_REFERENCE_FIELDS.every(
      (name) => Object.hasOwn(value, name) && typeof value[name] === 'string' && value[name],
    )
  )
    return false;
  return (
    !Object.hasOwn(value, 'sourceLineage') ||
    (typeof value.sourceLineage === 'string' && value.sourceLineage.length > 0)
  );
}

function findBoundResult(bound: BoundVisualization, resultRef: Result['ref']): Outcome<Result> {
  const inspected = parseWireValue(resultRef);
  if (!inspected.ok) return inspected;
  const reference = inspected.value;
  if (!isExactReference(reference)) return fail('binding', 'The selected result reference is malformed.');
  const result = bound.results.find((item) => key(item.ref) === key(reference));
  if (result === undefined) return fail('binding', 'The result does not belong to this bound visualization.');
  return { ok: true, value: result };
}

function isDatasetEntry(value: unknown): value is Record<string, unknown> & { readonly result: object } {
  if (!isRecord(value) || Object.keys(value).some((name) => name !== 'result' && name !== 'rows')) return false;
  return isRecord(value.result);
}

function selectDatasetRows(datasets: readonly VisualizationDataset[], selected: Result['ref']): Outcome<unknown> {
  const inspected = parseWireValue(datasets);
  if (!inspected.ok) return inspected;
  if (!Array.isArray(inspected.value) || inspected.value.length > 64)
    return fail('datasets', 'Materializations must be bounded.');
  const seenRefs = new Set<string>();
  let rows: unknown;
  for (const item of inspected.value) {
    if (!isDatasetEntry(item)) return fail('dataset', 'A materialization requires an exact result reference and rows.');
    const reference = item.result as Result['ref'];
    if (!isExactReference(reference)) return fail('dataset', 'A materialization reference is malformed.');
    const identity = key(reference);
    if (seenRefs.has(identity)) return fail('datasets', 'An exact materialization reference is repeated.');
    seenRefs.add(identity);
    if (identity === key(selected)) rows = item.rows;
  }
  return { ok: true, value: rows };
}

function validateRows(rows: unknown, result: Result): Outcome<readonly unknown[]> {
  if (
    !Array.isArray(rows) ||
    rows.length !== result.counts.loaded ||
    rows.length > 10_000 ||
    rows.length * result.fields.length > 100_000
  )
    return fail('rows', 'The authorized loaded rows must match the descriptor and remain within the row/cell budget.');
  return { ok: true, value: rows };
}

function validateRowValues(
  row: unknown,
  result: Result,
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<Record<string, Scalar>> {
  if (!isRecord(row) || Object.keys(row).some((field) => !fields.has(field)))
    return fail('row', 'A row contains undeclared fields.');
  const values: Record<string, Scalar> = Object.create(null) as Record<string, Scalar>;
  for (const field of result.fields) {
    const raw = Object.hasOwn(row, field.id) ? row[field.id] : undefined;
    const checked = validateScalar(raw === undefined && field.type.nullable ? null : raw, field.type);
    if (!checked.ok) return checked;
    values[field.id] = checked.value;
  }
  return { ok: true, value: values };
}

function rowIdentity(
  values: Readonly<Record<string, Scalar>>,
  identity: readonly string[],
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<string> {
  const parts: string[] = [];
  for (const id of identity) {
    const field = fields.get(id);
    const value = values[id];
    if (field === undefined || value === undefined || value === null)
      return fail('identity', 'A stable identity value is unavailable.');
    const checked = scalarIdentity(value, field.type);
    if (!checked.ok) return checked;
    parts.push(checked.value);
  }
  return { ok: true, value: JSON.stringify(parts) };
}

function materializeRows(rows: readonly unknown[], result: Result): Outcome<readonly VisualizationRow[]> {
  const fields = new Map(result.fields.map((field) => [field.id, field]));
  const identities = new Set<string>();
  const output: VisualizationRow[] = [];
  for (const row of rows) {
    const values = validateRowValues(row, result, fields);
    if (!values.ok) return values;
    const identity = rowIdentity(values.value, result.identity, fields);
    if (!identity.ok) return identity;
    if (identities.has(identity.value)) return fail('identity', 'Row identities must be unique.');
    identities.add(identity.value);
    output.push(Object.freeze({ identity: identity.value, values: Object.freeze(values.value) }));
  }
  return { ok: true, value: Object.freeze(output) };
}

/** The pure core binder must have accepted this descriptor first. No row index
 * or shape-valid reference is an authorization grant; host owns current rows. */
export function materializeVisualizationRows(
  bound: BoundVisualization,
  resultRef: Result['ref'],
  datasets: readonly VisualizationDataset[],
): Outcome<readonly VisualizationRow[]> {
  const selected = findBoundResult(bound, resultRef);
  if (!selected.ok) return selected;
  const rows = selectDatasetRows(datasets, selected.value.ref);
  if (!rows.ok) return rows;
  const checkedRows = validateRows(rows.value, selected.value);
  if (!checkedRows.ok) return checkedRows;
  return materializeRows(checkedRows.value, selected.value);
}
