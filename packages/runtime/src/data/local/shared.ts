import { WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Outcome } from '@varendo/core';
import type { ReadContext, UnsupportedCapability } from '../types.js';

export interface SourceLimits {
  readonly rows: number;
  readonly bytes: number;
}

export function diagnostic(
  code: string,
  message: string,
  path?: readonly (string | number)[],
  remedies?: readonly string[],
): Diagnostic {
  return {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path: [...path] }),
    ...(remedies === undefined ? {} : { remedies: [...remedies] }),
  };
}

export function failure<T>(
  code: string,
  message: string,
  path?: readonly (string | number)[],
  remedies?: readonly string[],
): Outcome<T> {
  return { ok: false, diagnostics: [diagnostic(code, message, path, remedies)] };
}

export function policyContext(context: ReadContext): ReadContext {
  if (context.cohort === undefined) return context;
  const { cohort: _cohort, ...rest } = context;
  return rest;
}

export function unsupported<T>(capability: UnsupportedCapability, path?: readonly (string | number)[]): Outcome<T> {
  return failure(
    'data.unsupported',
    `${capability.kind} capability ${capability.id} is not supported by this source: ${capability.reason}`,
    path,
    capability.alternatives,
  );
}

export function isSafePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function assertSafeId(value: string, label: string): void {
  const invalid =
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > WIRE_LIMITS.id ||
    /[\s\u0000-\u001f\u007f]/u.test(value);
  if (invalid) throw new TypeError(`${label} must be a bounded nonempty identifier.`);
}

export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const child of value) freezeDeep(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

export { canonicalJson as canonical } from '../../canonical.js';
