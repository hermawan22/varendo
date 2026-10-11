import type { LocalDataFieldKind, LocalDataShapeField, LocalDataShapeInput } from './local-shape.js';
import type { Diagnostic, Outcome } from '../contracts/types.js';
import { WIRE_LIMITS } from '../contracts/limits.js';
import { rowObject, validIdentifier } from './local-shape-capture.js';
import { identityFromRow } from './local-shape-identity.js';
import { canonicalIdentity, decimal, instant } from './local-shape-scalars.js';

export interface InspectedShape {
  readonly fields: readonly LocalDataShapeField[];
  readonly identity: readonly string[];
}

function failure(code: string, message: string, path: readonly (string | number)[] = []): Outcome<never> {
  const diagnostic: Diagnostic = { code, message, path, retryable: false };
  return { ok: false, diagnostics: [diagnostic] };
}

function kindOf(value: unknown): LocalDataFieldKind | undefined {
  if (value === null) return undefined;
  switch (typeof value) {
    case 'string':
      return 'text';
    case 'boolean':
      return 'boolean';
    case 'number':
      if (!Number.isFinite(value)) return undefined;
      return Number.isSafeInteger(value) ? 'integer' : 'float';
    default:
      return decimal(value) ? 'decimal' : undefined;
  }
}

function jsonByteLength(value: unknown): Outcome<number> {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return failure('data.shape-value', 'A local value is not JSON representable.');
    return { ok: true, value: new TextEncoder().encode(encoded).byteLength };
  } catch {
    return failure('data.shape-value', 'A local value could not be encoded within the wire shape.');
  }
}

function validDateText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function matchesDeclaredKind(value: unknown, kind: LocalDataFieldKind): boolean {
  switch (kind) {
    case 'text':
      return typeof value === 'string';
    case 'date':
      return typeof value === 'string' && validDateText(value);
    case 'instant':
      return typeof value === 'string' && instant(value) !== undefined;
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'float':
      return typeof value === 'number' && Number.isFinite(value);
    case 'decimal':
      return decimal(value);
    default:
      return false;
  }
}

function matchesDeclaredField(value: unknown, field: LocalDataShapeField): boolean {
  if (value === null) return field.nullable;
  return matchesDeclaredKind(value, field.kind);
}

function validateDeclaredFields(
  row: Record<string, unknown>,
  fields: ReadonlyMap<string, LocalDataShapeField>,
): Outcome<void> {
  for (const [id, field] of fields) {
    if (!matchesDeclaredField(row[id], field))
      return failure('data.shape-inconsistent', `Local field ${id} does not match its declared wire kind.`);
  }
  return { ok: true, value: undefined };
}

function wireShapeValue(value: unknown): unknown {
  if (!decimal(value)) return value;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, 'decimal');
    return descriptor !== undefined && 'value' in descriptor ? { decimal: descriptor.value } : undefined;
  } catch {
    return undefined;
  }
}

interface ShapeInspectionState {
  readonly fields: Map<string, { kind: LocalDataFieldKind | undefined; nullable: boolean }>;
  readonly identities: Set<string>;
  readonly identityCandidates: Set<string>;
  readonly callbackRows: { readonly row: Record<string, unknown>; readonly index: number }[];
  firstKeys: readonly string[] | undefined;
  bytes: number;
}

export function inspectRows(
  input: LocalDataShapeInput,
  rows: readonly unknown[],
  limits: { readonly rows: number; readonly bytes: number; readonly fields: number },
  expectedFields?: readonly string[],
  declaredFields?: ReadonlyMap<string, LocalDataShapeField>,
): Outcome<InspectedShape> {
  if (rows.length > limits.rows) return failure('data.shape-capacity', 'The local row count exceeds its bound.');
  const state: ShapeInspectionState = {
    fields: new Map(),
    identities: new Set(),
    identityCandidates: new Set(),
    callbackRows: [],
    firstKeys: undefined,
    bytes: 2,
  };
  for (const [index, raw] of rows.entries()) {
    const checked = inspectShapeRow(input, raw, index, limits, expectedFields, declaredFields, state);
    if (!checked.ok) return checked;
  }
  return finishShape(input, limits, state);
}

function inspectShapeRow(
  input: LocalDataShapeInput,
  raw: unknown,
  index: number,
  limits: { readonly bytes: number; readonly fields: number },
  expectedFields: readonly string[] | undefined,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
  state: ShapeInspectionState,
): Outcome<void> {
  const inspected = rowObject(raw, index, limits.fields);
  if (!inspected.ok) return inspected;
  const row = inspected.value;
  const keys = Object.keys(row).sort();
  const structure = validateShapeRow(input, row, index, keys, expectedFields, declaredFields, state);
  if (!structure.ok) return structure;
  const values = inspectShapeValues(row, keys, index, limits.bytes, declaredFields, state);
  if (!values.ok) return values;
  const identity = identityFromRow(input, row, index, state.fields);
  if (!identity.ok) return identity;
  let identityKey = identity.value.value;
  if (input.getRowId !== undefined && input.identity === undefined) {
    const matchingCandidates = [...state.identityCandidates].filter(
      (field) =>
        canonicalIdentity(row[field], state.fields.get(field)?.kind) ===
        canonicalIdentity(identity.value.raw, state.fields.get(field)?.kind),
    );
    const accessed = identity.value.accessed ?? [];
    const matches = accessed.length === 1 ? matchingCandidates.filter((field) => field === accessed[0]) : [];
    state.identityCandidates.clear();
    for (const field of matches) state.identityCandidates.add(field);
    state.callbackRows.push({ row, index });
    identityKey = '';
  }
  if (identityKey !== '') {
    if (state.identities.has(identityKey))
      return failure('data.identity-duplicate', 'Local row identities must be unique.');
    state.identities.add(identityKey);
  }
  return { ok: true, value: undefined };
}

function validateRowKeys(keys: readonly string[], index: number): Outcome<void> {
  if (keys.some((key) => !validIdentifier(key)))
    return failure('data.shape-field', `Local row ${index} contains an invalid field identifier.`);
  return { ok: true, value: undefined };
}

function validateExpectedFields(
  row: Record<string, unknown>,
  keys: readonly string[],
  expectedFields: readonly string[] | undefined,
): Outcome<void> {
  if (
    expectedFields !== undefined &&
    (keys.some((key) => !expectedFields.includes(key)) || expectedFields.some((key) => !Object.hasOwn(row, key)))
  )
    return failure('data.shape-inconsistent', 'Local rows contain a field outside the declared schema.');
  return { ok: true, value: undefined };
}

function validateDeclaredRow(
  row: Record<string, unknown>,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
): Outcome<void> {
  if (declaredFields === undefined) return { ok: true, value: undefined };
  const declared = validateDeclaredFields(row, declaredFields);
  if (!declared.ok) return declared;
  return { ok: true, value: undefined };
}

function validateSchemaRow(input: LocalDataShapeInput, row: Record<string, unknown>, index: number): Outcome<void> {
  if (input.schema === undefined) return { ok: true, value: undefined };
  try {
    if (!input.schema.safeParse(row).success)
      return failure('data.shape-inconsistent', `Local row ${index} does not satisfy its declared schema.`);
  } catch {
    return failure('data.shape-schema', `Local row ${index} could not be validated by its declared schema.`);
  }
  return { ok: true, value: undefined };
}

function validateShapeFields(
  input: LocalDataShapeInput,
  row: Record<string, unknown>,
  index: number,
  keys: readonly string[],
  expectedFields: readonly string[] | undefined,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
): Outcome<void> {
  const validKeys = validateRowKeys(keys, index);
  if (!validKeys.ok) return validKeys;
  const expected = validateExpectedFields(row, keys, expectedFields);
  if (!expected.ok) return expected;
  const declared = validateDeclaredRow(row, declaredFields);
  if (!declared.ok) return declared;
  return validateSchemaRow(input, row, index);
}

function updateFieldStructure(
  keys: readonly string[],
  expectedFields: readonly string[] | undefined,
  state: ShapeInspectionState,
): Outcome<void> {
  if (expectedFields !== undefined) {
    if (state.firstKeys === undefined) {
      state.firstKeys = expectedFields;
      for (const key of expectedFields) state.identityCandidates.add(key);
    }
    return { ok: true, value: undefined };
  }
  if (state.firstKeys === undefined) {
    state.firstKeys = keys;
    for (const key of keys) state.identityCandidates.add(key);
    return { ok: true, value: undefined };
  }
  if (keys.length !== state.firstKeys.length || keys.some((key, offset) => key !== state.firstKeys![offset]))
    return failure('data.shape-inconsistent', 'Local rows do not expose a consistent field shape.');
  return { ok: true, value: undefined };
}

function validateShapeRow(
  input: LocalDataShapeInput,
  row: Record<string, unknown>,
  index: number,
  keys: readonly string[],
  expectedFields: readonly string[] | undefined,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
  state: ShapeInspectionState,
): Outcome<void> {
  const valid = validateShapeFields(input, row, index, keys, expectedFields, declaredFields);
  if (!valid.ok) return valid;
  return updateFieldStructure(keys, expectedFields, state);
}

function inspectOneShapeValue(
  row: Record<string, unknown>,
  key: string,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
  state: ShapeInspectionState,
): Outcome<unknown> {
  const value = row[key];
  if (typeof value === 'string' && value.length > WIRE_LIMITS.text)
    return failure('data.shape-capacity', `Local field ${key} exceeds its text bound.`);
  const kind = declaredFields?.get(key)?.kind ?? kindOf(value);
  if (value !== null && kind === undefined)
    return failure(
      typeof value === 'object' ? 'data.shape-nested' : 'data.shape-value',
      `Local field ${key} contains an unsupported value.`,
    );
  updateInferredField(state, key, kind, value);
  return { ok: true, value: wireShapeValue(value) };
}

function updateInferredField(
  state: ShapeInspectionState,
  key: string,
  kind: LocalDataFieldKind | undefined,
  value: unknown,
): void {
  const prior = state.fields.get(key);
  if (prior === undefined) {
    state.fields.set(key, { kind, nullable: value === null });
    return;
  }
  if (value === null) prior.nullable = true;
  if (kind !== undefined && prior.kind !== undefined && prior.kind !== kind)
    throw new TypeError(`Local field ${key} changes scalar kind.`);
}

function encodedFieldBytes(key: string, value: unknown): Outcome<number> {
  const keyBytes = jsonByteLength(key);
  if (!keyBytes.ok) return keyBytes;
  const valueBytes = jsonByteLength(value);
  if (!valueBytes.ok) return valueBytes;
  return { ok: true, value: keyBytes.value + 1 + valueBytes.value };
}

function inspectShapeValues(
  row: Record<string, unknown>,
  keys: readonly string[],
  index: number,
  byteLimit: number,
  declaredFields: ReadonlyMap<string, LocalDataShapeField> | undefined,
  state: ShapeInspectionState,
): Outcome<void> {
  let rowBytes = 2;
  for (const [fieldIndex, key] of keys.entries()) {
    let inspected: Outcome<unknown>;
    try {
      inspected = inspectOneShapeValue(row, key, declaredFields, state);
    } catch {
      return failure('data.shape-inconsistent', `Local field ${key} changes scalar kind.`);
    }
    if (!inspected.ok) return inspected;
    const encoded = encodedFieldBytes(key, inspected.value);
    if (!encoded.ok) return encoded;
    rowBytes += (fieldIndex === 0 ? 0 : 1) + encoded.value;
    if (state.bytes + (index === 0 ? 0 : 1) + rowBytes > byteLimit)
      return failure('data.shape-capacity', 'The local shape exceeds its byte bound.');
  }
  state.bytes += (index === 0 ? 0 : 1) + rowBytes;
  return { ok: true, value: undefined };
}

function finishShape(
  input: LocalDataShapeInput,
  limits: { readonly fields: number },
  state: ShapeInspectionState,
): Outcome<InspectedShape> {
  if (state.fields.size > limits.fields)
    return failure('data.shape-capacity', 'The inferred local shape exceeds its field bound.');
  const output = [...state.fields.entries()].sort(([left], [right]) => compareFieldIds(left, right));
  const fields = finishFields(output);
  if (!fields.ok) return fields;
  const identity = finishIdentity(input, state);
  if (!identity.ok) return identity;
  return {
    ok: true,
    value: { fields: Object.freeze(fields.value), identity: Object.freeze(identity.value) },
  };
}

function compareFieldIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function finishFields(
  output: readonly [string, { readonly kind: LocalDataFieldKind | undefined; readonly nullable: boolean }][],
): Outcome<readonly LocalDataShapeField[]> {
  if (output.length === 0) return failure('data.shape-empty', 'Local rows must expose at least one usable field.');
  if (output.some(([, field]) => field.kind === undefined))
    return failure('data.shape-ambiguous', 'A local field contains only null values and needs a declared schema.');
  return {
    ok: true,
    value: output.map(([id, field]) => ({ id, kind: field.kind!, nullable: field.nullable })),
  };
}

function replayCallbackIdentities(identityField: string, state: ShapeInspectionState): Outcome<void> {
  const identityKind = state.fields.get(identityField)?.kind;
  for (const { row, index } of state.callbackRows) {
    const identityKey = canonicalIdentity(row[identityField], identityKind);
    if (state.identities.has(identityKey))
      return failure('data.identity-duplicate', `Local row identities must be unique at row ${index}.`);
    state.identities.add(identityKey);
  }
  return { ok: true, value: undefined };
}

function finishIdentity(input: LocalDataShapeInput, state: ShapeInspectionState): Outcome<readonly string[]> {
  if (input.identity !== undefined) return { ok: true, value: input.identity };
  if (input.getRowId === undefined) return { ok: true, value: [] };
  if (state.identityCandidates.size !== 1)
    return failure('data.identity-ambiguous', 'The row identity callback must select exactly one scalar field.');
  const identity = [...state.identityCandidates][0]!;
  const replayed = replayCallbackIdentities(identity, state);
  if (!replayed.ok) return replayed;
  return { ok: true, value: [identity] };
}
