import type { Diagnostic, Outcome } from '../contracts/types.js';
import { WIRE_LIMITS } from '../contracts/limits.js';

function failure(code: string, message: string, path: readonly (string | number)[] = []): Outcome<never> {
  const diagnostic: Diagnostic = { code, message, path, retryable: false };
  return { ok: false, diagnostics: [diagnostic] };
}

export function validIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    value !== '__proto__' &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function plainRow(row: unknown, index: number): Outcome<Record<string, unknown>> {
  if (row === null || typeof row !== 'object' || Array.isArray(row))
    return failure('data.shape-object', `Local row ${index} must be a plain record.`);
  try {
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null)
      return failure('data.shape-object', `Local row ${index} must use a plain object prototype.`);
    return { ok: true, value: row as Record<string, unknown> };
  } catch {
    return failure('data.shape-object', `Local row ${index} could not be safely inspected.`);
  }
}

function captureShapeValue(value: unknown, index: number, field: string): Outcome<unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: true, value };
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { ok: true, value };
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string')
        return failure('data.shape-executable', `Local field ${field} contains a symbol key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor))
        return failure('data.shape-accessor', `Local field ${field} contains an accessor value.`);
      captured[key] = descriptor.value;
    }
    return { ok: true, value: Object.freeze(captured) };
  } catch {
    return failure('data.shape-value', `Local field ${field} in row ${index} could not be safely inspected.`);
  }
}

function captureRowProperties(
  row: Record<string, unknown>,
  index: number,
  maxFields: number,
): Outcome<Record<string, unknown>> {
  try {
    const ownKeys = Reflect.ownKeys(row);
    if (ownKeys.length > maxFields)
      return failure('data.shape-capacity', `Local row ${index} exceeds its field bound.`);
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys) {
      if (typeof key !== 'string') return failure('data.shape-executable', `Local row ${index} contains a symbol key.`);
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (descriptor === undefined || !('value' in descriptor))
        return failure('data.shape-accessor', `Local row ${index} contains an accessor field.`);
      if (key === 'toJSON' && typeof descriptor.value === 'function')
        return failure('data.shape-executable', 'Local rows cannot provide executable toJSON hooks.');
      const value = captureShapeValue(descriptor.value, index, key);
      if (!value.ok) return value;
      captured[key] = value.value;
    }
    return { ok: true, value: Object.freeze(captured) };
  } catch {
    return failure('data.shape-object', `Local row ${index} could not be safely inspected.`);
  }
}

export function rowObject(row: unknown, index: number, maxFields: number): Outcome<Record<string, unknown>> {
  const plain = plainRow(row, index);
  if (!plain.ok) return plain;
  return captureRowProperties(plain.value, index, maxFields);
}

function rowArrayLength(rows: readonly unknown[]): Outcome<number> {
  const descriptor = Object.getOwnPropertyDescriptor(rows, 'length');
  if (descriptor === undefined || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value))
    return failure('data.shape-accessor', 'Local rows must expose a data length.');
  if (descriptor.value < 0) return failure('data.shape-object', 'Local rows must have a non-negative length.');
  return { ok: true, value: descriptor.value };
}

function validateRowArrayKeys(rows: readonly unknown[], length: number): Outcome<void> {
  const keys = Reflect.ownKeys(rows);
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)
      return failure('data.shape-object', 'Local rows must be dense arrays without extra fields.');
    const descriptor = Object.getOwnPropertyDescriptor(rows, key);
    if (descriptor === undefined || !('value' in descriptor))
      return failure('data.shape-accessor', 'Local rows cannot contain accessor items.');
  }
  return { ok: true, value: undefined };
}

function captureRowArrayItems(rows: readonly unknown[], length: number): Outcome<readonly unknown[]> {
  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
    if (descriptor === undefined || !('value' in descriptor))
      return failure('data.shape-object', 'Local rows must be dense arrays.');
    captured.push(descriptor.value);
  }
  return { ok: true, value: Object.freeze(captured) };
}

export function captureLocalRows(rows: readonly unknown[], maxRows: number): Outcome<readonly unknown[]> {
  try {
    if (!Array.isArray(rows)) return failure('data.shape-object', 'Local rows must be an array.');
    const length = rowArrayLength(rows);
    if (!length.ok) return length;
    if (length.value > maxRows) return failure('data.shape-capacity', 'The local row count exceeds its bound.');
    const validKeys = validateRowArrayKeys(rows, length.value);
    if (!validKeys.ok) return validKeys;
    return captureRowArrayItems(rows, length.value);
  } catch {
    return failure('data.shape-object', 'Local rows could not be safely inspected.');
  }
}
