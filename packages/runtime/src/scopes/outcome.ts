import type { Diagnostic, Outcome } from '@varendo/core';
import { freezeDiagnostic } from './diagnostic.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeVoidOutcome(value: unknown, fallback: Diagnostic, allowVoid = false): Outcome<void> {
  try {
    if (allowVoid && value === undefined) return { ok: true, value: undefined };
    if (!isRecord(value)) return { ok: false, diagnostics: [fallback] };
    if (value.ok === true) return { ok: true, value: undefined };
    if (value.ok !== false || !Array.isArray(value.diagnostics) || value.diagnostics.length === 0)
      return { ok: false, diagnostics: [fallback] };
    return { ok: false, diagnostics: [freezeDiagnostic(value.diagnostics[0], fallback)] };
  } catch {
    return { ok: false, diagnostics: [fallback] };
  }
}
