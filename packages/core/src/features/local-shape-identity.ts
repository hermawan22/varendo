import type { Diagnostic, Outcome } from '../contracts/types.js';
import type { LocalDataFieldKind, LocalDataShapeInput } from './local-shape.js';
import { canonicalIdentity, decimal } from './local-shape-scalars.js';

export interface IdentityValue {
  readonly value: string;
  readonly raw?: unknown;
  readonly accessed?: readonly string[];
}

function failure(code: string, message: string): Outcome<never> {
  const diagnostic: Diagnostic = { code, message, path: [], retryable: false };
  return { ok: false, diagnostics: [diagnostic] };
}

function usableIdentityValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    decimal(value)
  );
}

function callbackIdentity(
  input: LocalDataShapeInput,
  row: Record<string, unknown>,
  index: number,
): Outcome<IdentityValue> {
  if (input.getRowId === undefined) return { ok: true, value: { value: '' } };
  try {
    const accessed = new Set<string>();
    const observed = new Proxy(row, {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && Object.hasOwn(target, property)) accessed.add(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const value = input.getRowId(observed, index);
    if (value === null || value === undefined || value === '')
      return failure('data.identity-missing', `Local row ${index} has no usable identity.`);
    if (!usableIdentityValue(value))
      return failure('data.identity-ambiguous', `Local row ${index} identity must be a scalar field value.`);
    return { ok: true, value: { value: canonicalIdentity(value), raw: value, accessed: [...accessed] } };
  } catch {
    return failure('data.identity-missing', `Local row ${index} identity could not be read.`);
  }
}

function fieldIdentity(
  input: LocalDataShapeInput,
  row: Record<string, unknown>,
  index: number,
  fields: ReadonlyMap<string, { readonly kind: LocalDataFieldKind | undefined }>,
): Outcome<IdentityValue> {
  if (input.identity === undefined || input.identity.length === 0) return { ok: true, value: { value: '' } };
  const values: unknown[] = [];
  for (const field of input.identity) {
    if (!Object.hasOwn(row, field) || row[field] === null || row[field] === undefined)
      return failure('data.identity-missing', `Local row ${index} is missing identity field ${field}.`);
    values.push(canonicalIdentity(row[field], fields.get(field)?.kind));
  }
  return { ok: true, value: { value: JSON.stringify(values) } };
}

export function identityFromRow(
  input: LocalDataShapeInput,
  row: Record<string, unknown>,
  index: number,
  fields: ReadonlyMap<string, { readonly kind: LocalDataFieldKind | undefined }>,
): Outcome<IdentityValue> {
  if (input.getRowId !== undefined) return callbackIdentity(input, row, index);
  return fieldIdentity(input, row, index, fields);
}
