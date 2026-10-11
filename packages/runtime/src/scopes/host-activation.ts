import type { Outcome } from '@varendo/core';
import { runtimeDiagnostic } from './diagnostic.js';
import { normalizeVoidOutcome } from './outcome.js';
import type { ScopeBinding, ScopeResolution } from './types.js';

interface TransitionActivationInput {
  readonly previous: ScopeResolution;
  readonly activationEpoch: number;
  readonly leaveRevision: string;
}

export function activateInitialHost(binding: ScopeBinding, resolution: ScopeResolution): Outcome<void> {
  return invokeActivation(binding, resolution, Object.freeze({ kind: 'initial' }), false);
}

export function prepareInitialHost(binding: ScopeBinding, resolution: ScopeResolution): Outcome<void> {
  return invokeActivation(binding, resolution, Object.freeze({ kind: 'initial' }), true);
}

export function activateTransitionHost(
  binding: ScopeBinding,
  resolution: ScopeResolution,
  input: TransitionActivationInput,
): Outcome<void> {
  return invokeActivation(binding, resolution, Object.freeze({ kind: 'transition', ...input }), false);
}

export function prepareTransitionHost(
  binding: ScopeBinding,
  resolution: ScopeResolution,
  input: TransitionActivationInput,
): Outcome<void> {
  return invokeActivation(binding, resolution, Object.freeze({ kind: 'transition', ...input }), true);
}

function invokeActivation(
  binding: ScopeBinding,
  resolution: ScopeResolution,
  context: Parameters<ScopeBinding['activate']>[1],
  prepare: boolean,
): Outcome<void> {
  const fallback = runtimeDiagnostic(
    prepare ? 'scope.activation-prepare-failed' : 'scope.activation-failed',
    prepare
      ? 'The host could not prepare the scope activation.'
      : 'The host could not commit the accepted scope activation.',
  );
  try {
    const outcome = prepare ? binding.prepareActivation(resolution, context) : binding.activate(resolution, context);
    return normalizeVoidOutcome(outcome, fallback, !prepare);
  } catch {
    return { ok: false, diagnostics: [fallback] };
  }
}

export function isolateHost(callback: () => void): void {
  try {
    callback();
  } catch {
    // Security fencing and disposal do not depend on optional host cleanup hooks.
  }
}
