import type { Diagnostic, Outcome } from '@varendo/core';

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function failure<T>(code: string, message: string): Outcome<T> {
  const diagnostic: Diagnostic = { code, message, retryable: false };
  return { ok: false, diagnostics: [diagnostic] };
}
