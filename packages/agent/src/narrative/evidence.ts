import { scalarIdentity, validateScalar, type Outcome, type Scalar } from '@varendo/core';
import type { NarrativeCell } from '@varendo/core/agent';
import type { ResultHandle } from '@varendo/runtime/results';
import { fail, same } from './shared.js';
import type { NarrativeAuthority, NarrativeEvidenceTrace, NarrativeUsedEvidence } from './types.js';

type ResultSnapshot = ReturnType<ResultHandle['snapshot']>;
type ResultDescriptor = NonNullable<ResultSnapshot['descriptor']>;
type ResultField = ResultDescriptor['fields'][number];

interface ReadyEvidence {
  readonly snapshot: ResultSnapshot;
  readonly descriptor: ResultDescriptor;
}

interface RowScan {
  readonly matches: number;
  readonly value: Scalar | undefined;
}

type RowMatch = { readonly matched: false } | { readonly matched: true; readonly value: Scalar };

function resultHandle(cell: NarrativeCell, context: NarrativeAuthority): Outcome<ResultHandle> {
  if (cell.result.scopeDigest !== context.scopeDigest) return fail('stale', 'The claim scope is not current.');
  const handle = context.resolveResult(cell.result);
  if (handle === undefined) return fail('unavailable', 'The authorized result is unavailable.');
  const key = handle.key;
  if (
    key.principalKey !== context.principalKey ||
    key.scopeDigest !== context.scopeDigest ||
    key.policyRevision !== context.policyRevision ||
    key.catalogRevision !== context.catalogRevision ||
    key.functionRegistryDigest !== context.functionRegistryDigest
  )
    return fail('denied', 'The result authority has changed.');
  return { ok: true, value: handle };
}

function readyEvidence(handle: ResultHandle, cell: NarrativeCell): Outcome<ReadyEvidence> {
  const snapshot = handle.snapshot();
  const descriptor = snapshot.descriptor;
  if (snapshot.status !== 'ready' || descriptor === undefined || !same(descriptor.ref, cell.result))
    return fail('stale', 'The exact result revision is not ready.');
  return { ok: true, value: { snapshot, descriptor } };
}

function checkDescriptorScope(cell: NarrativeCell, descriptor: ResultDescriptor): Outcome<void> {
  if (
    descriptor.precision.kind !== 'exact' ||
    descriptor.coverage.kind !== 'complete' ||
    descriptor.consistency.kind !== 'snapshot' ||
    descriptor.evidence.kind === 'inferred'
  )
    return fail('unsupported', 'Exact complete observed or computed evidence is required.');
  if (
    descriptor.coverage.populationDigest !== cell.populationDigest ||
    !same(descriptor.filters, cell.filters) ||
    !same(descriptor.period, cell.period)
  )
    return fail('scope', 'The population, filters or period do not match.');
  return { ok: true, value: undefined };
}

function checkFieldMapping(cell: NarrativeCell, descriptor: ResultDescriptor): Outcome<ResultField> {
  const field = descriptor.fields.find((candidate) => candidate.id === cell.field);
  if (
    field !== undefined &&
    field.role === 'measure' &&
    descriptor.evidence.kind === 'computed' &&
    descriptor.evidence.definitions.length > 0 &&
    field.derivation === undefined
  )
    return fail('definition', 'The computed metric lacks an explicit field definition mapping.');
  if (field === undefined || !same(field.type, cell.type) || !same(field.derivation, cell.definition))
    return fail('field', 'The field type or definition does not match.');
  if (
    descriptor.evidence.kind === 'computed' &&
    cell.definition !== undefined &&
    !descriptor.evidence.definitions.some((ref) => same(ref, cell.definition))
  )
    return fail('definition', 'The computation does not cite this definition.');
  return { ok: true, value: field };
}

function identityFields(cell: NarrativeCell, descriptor: ResultDescriptor): Outcome<readonly ResultField[]> {
  if (descriptor.identity.length === 0 || !same([...descriptor.identity].sort(), Object.keys(cell.identity).sort()))
    return fail('identity', 'The claim must identify one complete stable row identity.');
  const fields: ResultField[] = [];
  for (const id of descriptor.identity) {
    const field = descriptor.fields.find((candidate) => candidate.id === id);
    if (field === undefined) return fail('identity', 'The result identity is unavailable.');
    fields.push(field);
  }
  return { ok: true, value: fields };
}

function expectedIdentity(cell: NarrativeCell, fields: readonly ResultField[]): Outcome<readonly string[]> {
  const expected: string[] = [];
  for (const field of fields) {
    const identity = scalarIdentity(cell.identity[field.id], field.type);
    if (!identity.ok) return fail('identity', 'The claim identity value is invalid.');
    expected.push(identity.value);
  }
  return { ok: true, value: expected };
}

function inspectRow(
  row: Readonly<Record<string, Scalar>>,
  cell: NarrativeCell,
  fields: readonly ResultField[],
  expected: readonly string[],
): Outcome<RowMatch> {
  const actual: string[] = [];
  for (const field of fields) {
    const identity = scalarIdentity(row[field.id], field.type);
    if (!identity.ok) return fail('identity', 'The result contains an invalid identity.');
    actual.push(identity.value);
  }
  if (!same(actual, expected)) return { ok: true, value: { matched: false } };
  const checked = validateScalar(row[cell.field], cell.type);
  if (!checked.ok) return fail('field', 'The result cell is invalid.');
  return { ok: true, value: { matched: true, value: checked.value } };
}

function scanBatch(
  rows: readonly Readonly<Record<string, Scalar>>[],
  cell: NarrativeCell,
  fields: readonly ResultField[],
  expected: readonly string[],
  trace: NarrativeEvidenceTrace,
): Outcome<RowScan> {
  let matches = 0;
  let value: Scalar | undefined;
  for (const row of rows) {
    trace.scanned += 1;
    if (trace.scanned > trace.maxRows) return fail('budget', 'The claim verification row budget was reached.');
    const match = inspectRow(row, cell, fields, expected);
    if (!match.ok) return match;
    if (!match.value.matched) continue;
    matches += 1;
    value = match.value.value;
  }
  return { ok: true, value: { matches, value } };
}

function uniqueCellValue(
  cell: NarrativeCell,
  snapshot: ResultSnapshot,
  fields: readonly ResultField[],
  expected: readonly string[],
  trace: NarrativeEvidenceTrace,
): Outcome<Scalar> {
  let matches = 0;
  let value: Scalar | undefined;
  for (const batch of snapshot.batches) {
    const scanned = scanBatch(batch.rows, cell, fields, expected, trace);
    if (!scanned.ok) return scanned;
    matches += scanned.value.matches;
    if (scanned.value.matches > 0) value = scanned.value.value;
  }
  if (matches !== 1 || value === undefined) return fail('identity', 'A unique matching result row is required.');
  return { ok: true, value };
}

export function verifyCell(
  cell: NarrativeCell,
  context: NarrativeAuthority,
  trace: NarrativeEvidenceTrace,
): Outcome<Scalar> {
  const handle = resultHandle(cell, context);
  if (!handle.ok) return handle;
  const ready = readyEvidence(handle.value, cell);
  if (!ready.ok) return ready;
  const scope = checkDescriptorScope(cell, ready.value.descriptor);
  if (!scope.ok) return scope;
  const field = checkFieldMapping(cell, ready.value.descriptor);
  if (!field.ok) return field;
  const fields = identityFields(cell, ready.value.descriptor);
  if (!fields.ok) return fields;
  const expected = expectedIdentity(cell, fields.value);
  if (!expected.ok) return expected;
  const value = uniqueCellValue(cell, ready.value.snapshot, fields.value, expected.value, trace);
  if (!value.ok) return value;
  const used: NarrativeUsedEvidence = { handle: handle.value, snapshot: ready.value.snapshot, ref: cell.result };
  trace.used.push(used);
  return value;
}
