import { proveCurrentAuthority, ScopeTransitionHostError } from './authority.js';
import type { TransitionFailureStage } from './authority.js';
import { InvalidScopeGuardError } from './guard.js';
import { transitionFailure } from './transition.js';
import type { ScopeBinding, ScopeResolution, ScopeSnapshot, ScopeTransitionResult } from './types.js';

interface TransitionErrorState {
  readonly transitionId: number;
  readonly disposed: boolean;
  readonly resolution: ScopeResolution | undefined;
  readonly snapshot: ScopeSnapshot;
}

interface TransitionErrorInput {
  readonly binding: ScopeBinding;
  readonly id: number;
  readonly signal: AbortSignal;
  readonly error: unknown;
  readState(): TransitionErrorState;
  invalidate(): void;
  keepActive(status: 'needs-input' | 'cancelled', diagnosticCode: string): ScopeTransitionResult;
}

const STAGE_FAILURE_CODES: Readonly<Record<TransitionFailureStage, string>> = {
  guard: 'scope.guard-failed',
  resolve: 'scope.transition-failed',
  permission: 'scope.permission-check-failed',
};

export async function containTransitionError(input: TransitionErrorInput): Promise<ScopeTransitionResult> {
  if (input.signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
  const current = await proveCurrentAuthority(input);
  if (current !== undefined) return current;
  if (input.error instanceof InvalidScopeGuardError) return input.keepActive('needs-input', 'scope.guard-invalid');
  const stage = input.error instanceof ScopeTransitionHostError ? input.error.stage : 'guard';
  const code = STAGE_FAILURE_CODES[stage] ?? 'scope.transition-failed';
  input.keepActive('cancelled', code);
  return transitionFailure('failed', code);
}
