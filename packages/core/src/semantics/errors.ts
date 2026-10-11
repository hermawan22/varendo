import type { Diagnostic, Outcome } from '../contracts/types.js';

export type SemanticPath = readonly (string | number)[];

function semanticDiagnostic(
  code: string,
  message: string,
  path: SemanticPath = [],
  remedies?: readonly string[],
): Diagnostic {
  const diagnostic: Diagnostic = { code, message, path, retryable: false };
  return remedies === undefined ? diagnostic : { ...diagnostic, remedies };
}

export function semanticFailure<T>(
  code: string,
  message: string,
  path: SemanticPath = [],
  remedies?: readonly string[],
): Outcome<T> {
  return { ok: false, diagnostics: [semanticDiagnostic(code, message, path, remedies)] };
}

function prependDiagnostic(path: SemanticPath, diagnostic: Diagnostic): Diagnostic {
  const suffix = diagnostic.path ?? [];
  return { ...diagnostic, path: [...path, ...suffix] };
}

function mapDiagnostics(
  diagnostics: readonly Diagnostic[],
  mapper: (diagnostic: Diagnostic) => Diagnostic,
): readonly [Diagnostic, ...Diagnostic[]] {
  // Every Outcome failure is non-empty by contract. Keep that invariant at
  // the boundary when Array.map necessarily widens the tuple.
  return diagnostics.map(mapper) as unknown as [Diagnostic, ...Diagnostic[]];
}

export function prependOutcomePath<T>(path: SemanticPath, outcome: Outcome<T>): Outcome<T> {
  return outcome.ok
    ? outcome
    : {
        ok: false,
        diagnostics: mapDiagnostics(outcome.diagnostics, (diagnostic) => prependDiagnostic(path, diagnostic)),
      };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
