import type { Diagnostic } from '@varendo/core';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_LABEL = 4_096;
const MAX_TEXT = 16_384;
const MAX_PATH = 64;
const MAX_REMEDIES = 16;

export function runtimeDiagnostic(code: string, message: string): Diagnostic {
  return Object.freeze({ code, message, retryable: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedPath(value: unknown): readonly (string | number)[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_PATH) return undefined;
  const valid = value.every(
    (entry) =>
      (typeof entry === 'string' && entry.length <= MAX_TEXT) ||
      (typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0),
  );
  return valid ? Object.freeze([...value]) : undefined;
}

function boundedRemedies(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_REMEDIES) return undefined;
  const valid = value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_LABEL);
  return valid ? Object.freeze([...value]) : undefined;
}

function diagnosticBase(value: Record<string, unknown>) {
  if (typeof value.code !== 'string' || !ID_PATTERN.test(value.code)) return undefined;
  if (typeof value.message !== 'string' || value.message.length === 0 || value.message.length > MAX_LABEL)
    return undefined;
  if (typeof value.retryable !== 'boolean') return undefined;
  return { code: value.code, message: value.message, retryable: value.retryable };
}

export function freezeDiagnostic(value: unknown, fallback: Diagnostic): Diagnostic {
  try {
    if (!isRecord(value)) return fallback;
    const base = diagnosticBase(value);
    if (base === undefined) return fallback;
    const path = boundedPath(value.path);
    const remedies = boundedRemedies(value.remedies);
    if (value.path !== undefined && path === undefined) return fallback;
    if (value.remedies !== undefined && remedies === undefined) return fallback;
    return Object.freeze({
      ...base,
      ...(path === undefined ? {} : { path }),
      ...(remedies === undefined ? {} : { remedies }),
    });
  } catch {
    return fallback;
  }
}
