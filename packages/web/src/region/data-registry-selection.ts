import { scalarIdentity, validateScalar, type Outcome, type Result, type Scalar } from '@varendo/core';
import type { VarendoDataRecord } from '../data/index.js';
import type { VarendoValidatedBinding } from './data-registry-types.js';
import { allowedKeys, failure, fieldMap, object } from './data-registry-common.js';

export interface DeltaObservationInput {
  readonly field: unknown;
  readonly selector?: Readonly<Record<string, unknown>>;
}

export interface SelectedRow {
  readonly row: VarendoDataRecord;
  readonly index: number;
}

function hasIdentitySelector(input: Readonly<Record<string, unknown>>): boolean {
  return input.identityValues !== undefined || input.rowIdentity !== undefined;
}

export function aliasedObservation(
  input: Readonly<Record<string, unknown>>,
  directKey: string,
  nestedKey: string,
): Outcome<DeltaObservationInput> {
  const direct = input[directKey];
  const nestedRaw = input[nestedKey];
  if (nestedRaw === undefined) return { ok: true, value: { field: direct } };
  const nested = object(nestedRaw);
  if (nested === undefined || !allowedKeys(nested, ['field', 'identityValues', 'rowIdentity'])) {
    return failure('config', `${nestedKey} must contain only its field and typed identity selector.`);
  }
  if (direct !== undefined && nested.field !== undefined && direct !== nested.field) {
    return failure('config', `${directKey} and ${nestedKey}.field must identify the same field.`);
  }
  return {
    ok: true,
    value: {
      field: direct ?? nested.field,
      ...(hasIdentitySelector(nested) ? { selector: nested } : {}),
    },
  };
}

export function rowIdentity(row: VarendoDataRecord, result: Result): Outcome<string> {
  const fields = fieldMap(result);
  const parts: string[] = [];
  for (const id of result.identity) {
    const field = fields.get(id);
    if (field === undefined) return failure('identity', `Identity field ${id} is not declared by the Result.`);
    const value = row[id];
    if (value === undefined || value === null) {
      return failure('identity', `Identity field ${id} is missing from a supplied row.`);
    }
    const identity = scalarIdentity(value, field.type);
    if (!identity.ok) return failure('identity', `Identity field ${id} is invalid.`);
    parts.push(identity.value);
  }
  return { ok: true, value: JSON.stringify(parts) };
}

function identityValuesFor(raw: unknown, result: Result): Outcome<Readonly<Record<string, Scalar>> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const values = object(raw);
  if (values === undefined) {
    return failure('identity', 'identityValues must provide every authorized identity field exactly once.');
  }
  const keys = Object.keys(values);
  if (keys.length !== result.identity.length || keys.some((field) => !result.identity.includes(field))) {
    return failure('identity', 'identityValues must provide every authorized identity field exactly once.');
  }
  const descriptors = fieldMap(result);
  const normalized: Record<string, Scalar> = {};
  for (const fieldId of result.identity) {
    const descriptor = descriptors.get(fieldId);
    if (descriptor === undefined)
      return failure('identity', `Identity field ${fieldId} is not declared by the Result.`);
    const checked = validateScalar(values[fieldId], descriptor.type);
    if (!checked.ok || checked.value === null) {
      return failure('identity', `identityValues.${fieldId} does not match the identity field type.`);
    }
    normalized[fieldId] = checked.value;
  }
  return { ok: true, value: normalized };
}

function identityValues(
  input: Readonly<Record<string, unknown>>,
  result: Result,
): Outcome<Readonly<Record<string, Scalar>> | undefined> {
  const directRaw = input.identityValues;
  const aliasRaw = input.rowIdentity;
  if (directRaw === undefined || aliasRaw === undefined) {
    return identityValuesFor(directRaw ?? aliasRaw, result);
  }
  const direct = identityValuesFor(directRaw, result);
  if (!direct.ok) return direct;
  const alias = identityValuesFor(aliasRaw, result);
  if (!alias.ok) return alias;
  if (direct.value === undefined || alias.value === undefined) {
    return failure('identity', 'Identity aliases must contain an identity object.');
  }
  const sameTuple = sameIdentityValues(direct.value, alias.value, result);
  if (!sameTuple) return failure('identity', 'identityValues and rowIdentity must describe the same identity tuple.');
  return direct;
}

function identityKey(values: Readonly<Record<string, Scalar>>, result: Result): Outcome<string> {
  const descriptors = fieldMap(result);
  const parts: string[] = [];
  for (const fieldId of result.identity) {
    const descriptor = descriptors.get(fieldId);
    if (descriptor === undefined)
      return failure('identity', `Identity field ${fieldId} is not declared by the Result.`);
    const identity = scalarIdentity(values[fieldId], descriptor.type);
    if (!identity.ok) return failure('identity', `Identity field ${fieldId} is invalid.`);
    parts.push(identity.value);
  }
  return { ok: true, value: JSON.stringify(parts) };
}

function sameIdentityValues(
  left: Readonly<Record<string, Scalar>> | undefined,
  right: Readonly<Record<string, Scalar>> | undefined,
  result: Result,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftKey = identityKey(left, result);
  if (!leftKey.ok) return false;
  const rightKey = identityKey(right, result);
  return rightKey.ok && leftKey.value === rightKey.value;
}

export function observationSelector(
  input: Readonly<Record<string, unknown>>,
  observation: DeltaObservationInput,
  result: Result,
  label: string,
): Outcome<Readonly<Record<string, unknown>>> {
  if (observation.selector === undefined) return { ok: true, value: input };
  if (!hasIdentitySelector(input)) return { ok: true, value: observation.selector };
  const shared = identityValues(input, result);
  if (!shared.ok) return shared;
  const specific = identityValues(observation.selector, result);
  if (!specific.ok) return specific;
  if (!sameIdentityValues(shared.value, specific.value, result)) {
    return failure('identity', `${label} identity selector conflicts with the shared identity selector.`);
  }
  return { ok: true, value: observation.selector };
}

function findRowIndex(requested: Readonly<Record<string, Scalar>>, binding: VarendoValidatedBinding): Outcome<number> {
  const requestedKey = identityKey(requested, binding.result);
  if (!requestedKey.ok) return requestedKey;
  for (let index = 0; index < binding.rows.length; index += 1) {
    const identity = rowIdentity(binding.rows[index]!, binding.result);
    if (identity.ok && identity.value === requestedKey.value) return { ok: true, value: index };
  }
  return failure('identity', 'identityValues does not identify a supplied authorized row.');
}

export function selectOne(
  input: Readonly<Record<string, unknown>>,
  binding: VarendoValidatedBinding,
): Outcome<SelectedRow> {
  if (binding.rows.length === 0) {
    return failure('binding', 'The authorized Result has no supplied row for a scalar view.');
  }
  const requested = identityValues(input, binding.result);
  if (!requested.ok) return requested;
  if (requested.value === undefined) {
    if (binding.rows.length !== 1) {
      return failure('identity', 'A scalar view requires exactly one authorized row or explicit identityValues.');
    }
    return { ok: true, value: { row: binding.rows[0]!, index: 0 } };
  }
  const index = findRowIndex(requested.value, binding);
  if (!index.ok) return index;
  return { ok: true, value: { row: binding.rows[index.value]!, index: index.value } };
}
