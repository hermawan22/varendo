import type { Outcome } from '@varendo/core';
import { normalizeVoidOutcome } from './outcome.js';
import { firstDiagnosticCode, transitionFailure } from './transition.js';
import type { ScopeBinding, ScopeResolution, ScopeSnapshot, ScopeTransitionResult } from './types.js';

export type TransitionFailureStage = 'guard' | 'resolve' | 'permission';

export class ScopeTransitionHostError extends Error {
  constructor(
    readonly stage: TransitionFailureStage,
    cause: unknown,
  ) {
    super(`The trusted host failed during ${stage}.`, { cause });
  }
}

const permissionDiagnostic = Object.freeze({
  code: 'scope.permission-check-failed',
  message: 'The trusted host returned invalid permission evidence.',
  retryable: false,
});

export async function authorizeScope(
  binding: ScopeBinding,
  resolution: ScopeResolution,
  signal: AbortSignal,
): Promise<Outcome<void>> {
  try {
    return normalizeVoidOutcome(await binding.authorize(resolution, { signal }), permissionDiagnostic);
  } catch (error) {
    throw new ScopeTransitionHostError('permission', error);
  }
}

interface AuthorityState {
  readonly transitionId: number;
  readonly disposed: boolean;
  readonly resolution: ScopeResolution | undefined;
  readonly snapshot: ScopeSnapshot;
}

interface CurrentAuthorityInput {
  readonly binding: ScopeBinding;
  readonly id: number;
  readonly signal: AbortSignal;
  readState(): AuthorityState;
  invalidate(): void;
}

function stateMatches(state: AuthorityState, id: number, resolution: ScopeResolution, before: ScopeSnapshot): boolean {
  return (
    state.transitionId === id &&
    !state.disposed &&
    state.resolution === resolution &&
    state.snapshot.active &&
    state.snapshot.activationEpoch === before.activationEpoch &&
    state.snapshot.permissionRevision === before.permissionRevision &&
    state.snapshot.policyRevision === before.policyRevision
  );
}

export async function proveCurrentAuthority(input: CurrentAuthorityInput): Promise<ScopeTransitionResult | undefined> {
  if (input.signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
  const initial = input.readState();
  const resolution = initial.resolution;
  if (resolution === undefined || !stateMatches(initial, input.id, resolution, initial.snapshot))
    return transitionFailure('stale', 'scope.transition-stale');
  let authorized: Outcome<void>;
  try {
    authorized = await authorizeScope(input.binding, resolution, input.signal);
  } catch {
    input.invalidate();
    return transitionFailure('denied', 'scope.permission-check-failed');
  }
  if (input.signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
  if (!authorized.ok) {
    input.invalidate();
    return transitionFailure('denied', firstDiagnosticCode(authorized.diagnostics, 'scope.permission-denied'));
  }
  return stateMatches(input.readState(), input.id, resolution, initial.snapshot)
    ? undefined
    : transitionFailure('stale', 'scope.transition-stale');
}
