import type { Diagnostic } from '@varendo/core';
import { ScopeTransitionHostError } from './authority.js';
import type { GuardCapture } from './guard.js';
import { transitionGuardCurrent } from './guard.js';
import {
  activateInitialHost,
  activateTransitionHost,
  isolateHost,
  prepareInitialHost,
  prepareTransitionHost,
} from './host-activation.js';
import { firstDiagnosticCode, transitionFailure } from './transition.js';
import type { ScopeBinding, ScopeResolution, ScopeSnapshot, ScopeTransitionResult } from './types.js';

interface AcceptanceState {
  readonly snapshot: ScopeSnapshot;
  readonly transitionId: number;
  readonly disposed: boolean;
  readonly resolution: ScopeResolution | undefined;
}

interface ActivationBoundaryInput extends AcceptanceState {
  readonly id: number;
  readonly expectedResolution: ScopeResolution | undefined;
  readonly expectedSnapshot: ScopeSnapshot;
}

interface TransitionAcceptanceInput {
  readonly binding: ScopeBinding;
  readonly capture: GuardCapture;
  readonly id: number;
  readonly resolution: ScopeResolution;
  readonly signal: AbortSignal;
  readState(): AcceptanceState;
  retain(outcome: {
    readonly ok: false;
    readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
  }): Promise<ScopeTransitionResult>;
  activate(): ScopeTransitionResult;
}

interface TransitionCommitInput {
  readonly binding: ScopeBinding;
  readonly capture: GuardCapture;
  readonly id: number;
  readonly resolution: ScopeResolution;
  readonly previous: ScopeResolution;
  readonly before: ScopeSnapshot;
  readState(): AcceptanceState;
  publishFenced(snapshot: ScopeSnapshot): void;
  fenceTargets(): void;
  fenceLifecycle(): void;
  failClosed(diagnosticCode: string): ScopeTransitionResult;
  publish(epoch: number): ScopeTransitionResult;
}

interface InitialCommitInput {
  readonly binding: ScopeBinding;
  readonly id: number;
  readonly resolution: ScopeResolution;
  readonly before: ScopeSnapshot;
  readState(): AcceptanceState;
  publishFailure(diagnostic: Diagnostic): void;
  publish(): void;
}

export async function prepareTransition(input: TransitionAcceptanceInput): Promise<ScopeTransitionResult> {
  const state = input.readState();
  let current: boolean;
  try {
    current = transitionGuardCurrent(
      input.binding,
      input.capture,
      state.snapshot,
      input.id,
      state.transitionId,
      state.disposed,
    );
  } catch (error) {
    throw new ScopeTransitionHostError('guard', error);
  }
  if (!current || state.resolution === undefined) return transitionFailure('stale', 'scope.transition-stale');
  if (input.signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
  const prepared = prepareTransitionHost(input.binding, input.resolution, {
    previous: state.resolution,
    activationEpoch: input.capture.activationEpoch,
    leaveRevision: input.capture.leaveRevision,
  });
  const interrupted = activationBoundaryFailure({
    ...input.readState(),
    id: input.id,
    expectedResolution: state.resolution,
    expectedSnapshot: state.snapshot,
  });
  if (interrupted !== undefined) return interrupted;
  if (input.signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
  return prepared.ok ? input.activate() : input.retain(prepared);
}

function disposedFailure(state: AcceptanceState): ScopeTransitionResult | undefined {
  return state.disposed || state.snapshot.status === 'disposed'
    ? transitionFailure('disposed', 'scope.disposed')
    : undefined;
}

function activationBoundaryFailure(input: ActivationBoundaryInput): ScopeTransitionResult | undefined {
  const terminal = disposedFailure(input);
  if (terminal !== undefined) return terminal;
  if (input.snapshot.status === 'denied') return transitionFailure('denied', 'scope.inactive');
  if (
    input.id !== input.transitionId ||
    input.resolution !== input.expectedResolution ||
    input.snapshot !== input.expectedSnapshot
  )
    return transitionFailure('stale', 'scope.transition-stale');
  return undefined;
}

function publishedBoundaryFailure(input: TransitionCommitInput, epoch: number): ScopeTransitionResult | undefined {
  const state = input.readState();
  const terminal = disposedFailure(state);
  if (terminal !== undefined) return terminal;
  if (state.snapshot.status === 'denied') return transitionFailure('denied', 'scope.inactive');
  if (
    input.id !== state.transitionId ||
    state.resolution !== input.resolution ||
    !state.snapshot.active ||
    state.snapshot.status !== 'active' ||
    state.snapshot.activationEpoch !== epoch
  )
    return transitionFailure('stale', 'scope.transition-stale');
  return undefined;
}

function failedBoundaryTerminal(input: TransitionCommitInput): ScopeTransitionResult | undefined {
  const state = input.readState();
  const terminal = disposedFailure(state);
  if (terminal !== undefined) return terminal;
  if (state.snapshot.status === 'denied' && state.snapshot.invalidationReason !== undefined)
    return transitionFailure('denied', 'scope.inactive');
  return undefined;
}

export function commitTransition(input: TransitionCommitInput): ScopeTransitionResult {
  const epoch = input.before.activationEpoch + 1;
  const fenced = Object.freeze({ ...input.before, active: false });
  const interrupted = () =>
    activationBoundaryFailure({
      ...input.readState(),
      id: input.id,
      expectedResolution: input.previous,
      expectedSnapshot: fenced,
    });
  const deactivate = (resolution: ScopeResolution) =>
    isolateHost(() => input.binding.deactivate(resolution, 'transition'));
  input.publishFenced(fenced);
  input.fenceTargets();
  let failure = interrupted();
  if (failure !== undefined) return failure;
  input.fenceLifecycle();
  failure = interrupted();
  if (failure !== undefined) return failure;
  deactivate(input.previous);
  failure = interrupted();
  if (failure !== undefined) return failure;
  const activated = activateTransitionHost(input.binding, input.resolution, {
    previous: input.previous,
    activationEpoch: input.capture.activationEpoch,
    leaveRevision: input.capture.leaveRevision,
  });
  failure = interrupted();
  if (failure !== undefined) {
    deactivate(input.resolution);
    return interrupted() ?? failure;
  }
  if (!activated.ok) {
    deactivate(input.resolution);
    failure = interrupted();
    if (failure !== undefined) return failure;
    const closed = input.failClosed(firstDiagnosticCode(activated.diagnostics, 'scope.activation-failed'));
    return failedBoundaryTerminal(input) ?? closed;
  }
  const published = input.publish(epoch);
  return publishedBoundaryFailure(input, epoch) ?? published;
}

export function commitInitial(input: InitialCommitInput): void {
  const interrupted = () =>
    activationBoundaryFailure({
      ...input.readState(),
      id: input.id,
      expectedResolution: undefined,
      expectedSnapshot: input.before,
    });
  const compensate = () => isolateHost(() => input.binding.deactivate(input.resolution, 'dispose'));
  const prepared = prepareInitialHost(input.binding, input.resolution);
  if (interrupted() !== undefined) return;
  if (!prepared.ok) return input.publishFailure(prepared.diagnostics[0]);
  const activated = activateInitialHost(input.binding, input.resolution);
  if (interrupted() !== undefined) {
    compensate();
    return;
  }
  if (!activated.ok) {
    compensate();
    if (interrupted() !== undefined) return;
    return input.publishFailure(activated.diagnostics[0]);
  }
  input.publish();
}
