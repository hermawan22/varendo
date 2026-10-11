import type { Diagnostic } from '@varendo/core';
import type { ScopeTransitionResult } from './types.js';

export function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function transitionFailure(
  status: Exclude<ScopeTransitionResult['status'], 'active' | 'needs-input'>,
  diagnosticCode: string,
): ScopeTransitionResult {
  return Object.freeze({ status, diagnosticCode });
}

export function needsInput(diagnosticCode: string): ScopeTransitionResult {
  return Object.freeze({
    status: 'needs-input',
    diagnosticCode,
    choices: Object.freeze(['save', 'discard', 'stay'] as const),
  });
}

export function deniedScopeOutcome(code: string): { readonly ok: false; readonly diagnostics: readonly [Diagnostic] } {
  return {
    ok: false,
    diagnostics: [Object.freeze({ code, message: 'The trusted host rejected the scope operation.', retryable: false })],
  };
}

export function firstDiagnosticCode(diagnostics: readonly Diagnostic[], fallback: string): string {
  try {
    return diagnostics[0]?.code ?? fallback;
  } catch {
    return fallback;
  }
}
