import type { Diagnostic, Outcome } from '@varendo/core';
import { activeSnapshot, failedActivationSnapshot, initialFailureSnapshot } from './activation.js';
import { freezeSelector, sameSelector, validateResolution } from './address.js';
import { authorizeScope, ScopeTransitionHostError } from './authority.js';
import { runtimeDiagnostic as diagnostic } from './diagnostic.js';
import { isolateHost } from './host-activation.js';
import type { SurfaceAddress } from '../surfaces/types.js';
import { captureGuard, InvalidScopeGuardError, runLeaveGuard, saveGuard, transitionGuardCurrent } from './guard.js';
import { ScopeLifecycle } from './teardown.js';
import { ScopeTargetRegistry } from './targets.js';
import { commitInitial, commitTransition, prepareTransition } from './transition-acceptance.js';
import { containTransitionError } from './transition-error.js';
import { deniedScopeOutcome, firstDiagnosticCode, needsInput } from './transition.js';
import { signalAborted, transitionFailure } from './transition.js';
import type {
  CreateScopeInput,
  ScopeController,
  ScopeInvalidationReason,
  ScopeRequestOptions,
  ScopeResolution,
  ScopeSelector,
  ScopeSnapshot,
  ScopeTransitionResult,
} from './types.js';

let nextScopeId = 1;

const INVALIDATION_REASONS: ReadonlySet<ScopeInvalidationReason> = new Set([
  'logout',
  'revoked',
  'expired',
  'external-switch',
]);

export class ScopeControllerImpl implements ScopeController {
  private readonly lifecycle = new ScopeLifecycle();
  private readonly initial: ScopeSelector;
  private snapshot: ScopeSnapshot;
  private resolution: ScopeResolution | undefined;
  private activeTransition: AbortController | undefined;
  private transitionId = 0;
  private attachCount = 0;
  private disposed = false;
  private readonly targets = new ScopeTargetRegistry();
  private readonly readTransitionState = () => ({
    transitionId: this.transitionId,
    disposed: this.disposed,
    resolution: this.resolution,
    snapshot: this.snapshot,
  });

  constructor(
    runtimeId: string,
    private readonly input: CreateScopeInput,
    private readonly onDispose: () => void,
  ) {
    this.initial = freezeSelector(input.initial);
    this.snapshot = Object.freeze({
      runtimeId,
      scopeInstanceId: input.id ?? `scope-${nextScopeId++}`,
      activationEpoch: 0,
      active: false,
      permissionRevision: 0,
      status: 'idle',
      selector: null,
      revision: '0',
    });
  }

  getSnapshot(): ScopeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    return this.lifecycle.subscribe(listener);
  }

  subscribeFence(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    return this.lifecycle.subscribeFence(listener);
  }

  registerTarget(address: SurfaceAddress, fence: () => void): () => void {
    return this.targets.register(address, this.snapshot, fence);
  }

  attach(): () => void {
    if (this.disposed) return () => undefined;
    this.attachCount += 1;
    if (this.attachCount === 1 && this.snapshot.status === 'idle') void this.activateInitial();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.attachCount -= 1;
      if (this.attachCount === 0 && this.snapshot.status === 'resolving' && this.snapshot.selector === null) {
        this.activeTransition?.abort();
        this.transitionId += 1;
        this.snapshot = Object.freeze({
          ...this.snapshot,
          status: 'idle',
          revision: String(Number(this.snapshot.revision) + 1),
        });
        this.lifecycle.notify();
      }
    };
  }

  async requestChange(selector: ScopeSelector, options: ScopeRequestOptions = {}): Promise<ScopeTransitionResult> {
    if (this.disposed) return transitionFailure('disposed', 'scope.disposed');
    if (!this.snapshot.active || this.resolution === undefined) return transitionFailure('denied', 'scope.inactive');
    if (signalAborted(options.signal)) return transitionFailure('cancelled', 'scope.transition-cancelled');
    const requested = freezeSelector(selector);
    if (signalAborted(options.signal)) return transitionFailure('cancelled', 'scope.transition-cancelled');
    if (sameSelector(requested, this.snapshot.selector))
      return Object.freeze({
        status: 'active',
        selector: this.snapshot.selector!,
        activationEpoch: this.snapshot.activationEpoch,
      });
    const transition = this.beginTransition(requested, options.signal);
    if (transition === undefined) return transitionFailure('cancelled', 'scope.transition-cancelled');
    try {
      let capture: ReturnType<typeof captureGuard>;
      try {
        capture = captureGuard(this.input.binding, this.snapshot);
      } catch (error) {
        return await this.handleTransitionException(transition.id, transition.controller.signal, error);
      }
      return await this.runTransition(transition.id, capture, requested, transition.controller.signal);
    } catch (error) {
      return await this.handleTransitionException(transition.id, transition.controller.signal, error);
    } finally {
      transition.cleanup();
      this.clearPending(transition.id);
    }
  }

  authorize(featureId: string): Outcome<void> {
    if (!this.snapshot.active || this.resolution === undefined)
      return deniedScopeOutcome(this.disposed ? 'scope.disposed' : 'scope.inactive');
    if (this.resolution.allowedFeatures !== undefined && !this.resolution.allowedFeatures.includes(featureId))
      return deniedScopeOutcome('scope.feature-denied');
    return { ok: true, value: undefined };
  }

  invalidate(reason: ScopeInvalidationReason): void {
    if (!INVALIDATION_REASONS.has(reason))
      throw new TypeError('Scope invalidation reasons must use the closed runtime contract.');
    if (this.disposed || this.snapshot.status === 'denied') return;
    const before = this.snapshot;
    const resolution = this.resolution;
    this.activeTransition?.abort();
    this.resolution = undefined;
    this.snapshot = Object.freeze({
      runtimeId: before.runtimeId,
      scopeInstanceId: before.scopeInstanceId,
      activationEpoch: before.activationEpoch,
      active: false,
      permissionRevision: before.permissionRevision + 1,
      status: 'denied',
      selector: null,
      revision: String(Number(before.revision) + 1),
      invalidationReason: reason,
    });
    this.targets.fence(before.activationEpoch);
    this.lifecycle.fence();
    this.lifecycle.notify();
    if (before.selector !== null && before.policyRevision !== undefined)
      isolateHost(() =>
        this.input.binding.recover?.({
          selector: before.selector!,
          policyRevision: before.policyRevision!,
          activationEpoch: before.activationEpoch,
          reason,
        }),
      );
    if (resolution !== undefined) isolateHost(() => this.input.binding.deactivate?.(resolution, reason));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeTransition?.abort();
    const before = this.snapshot;
    const resolution = this.resolution;
    this.resolution = undefined;
    this.snapshot = Object.freeze({
      runtimeId: before.runtimeId,
      scopeInstanceId: before.scopeInstanceId,
      activationEpoch: before.activationEpoch,
      active: false,
      permissionRevision: before.permissionRevision + 1,
      status: 'disposed',
      selector: null,
      revision: String(Number(before.revision) + 1),
    });
    this.targets.fence(before.activationEpoch);
    this.lifecycle.dispose();
    if (resolution !== undefined) isolateHost(() => this.input.binding.deactivate?.(resolution, 'dispose'));
    this.onDispose();
  }

  private async activateInitial(): Promise<void> {
    const transition = this.beginTransition(this.initial);
    if (transition === undefined) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      status: 'resolving',
      revision: String(Number(this.snapshot.revision) + 1),
    });
    this.lifecycle.notify();
    try {
      const resolved = await this.input.binding.resolve(this.initial, { signal: transition.controller.signal });
      if (transition.controller.signal.aborted || transition.id !== this.transitionId) return;
      const checked = validateResolution(resolved, this.initial);
      if (!checked.ok) {
        this.publishInitialFailure(checked.diagnostics[0]);
        return;
      }
      await this.activateResolvedInitial(transition.id, checked.value, transition.controller.signal);
    } catch {
      if (!transition.controller.signal.aborted)
        this.publishInitialFailure(diagnostic('scope.resolve-failed', 'The initial scope could not be resolved.'));
    } finally {
      transition.cleanup();
    }
  }

  private beginTransition(selector: ScopeSelector, parent?: AbortSignal) {
    if (parent?.aborted === true) return undefined;
    this.activeTransition?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent?.addEventListener('abort', abort, { once: true });
    const id = ++this.transitionId;
    this.activeTransition = controller;
    if (this.snapshot.active) this.publishPending(id, selector, 'guard');
    return {
      id,
      controller,
      cleanup: () => {
        parent?.removeEventListener('abort', abort);
        if (this.activeTransition === controller) this.activeTransition = undefined;
      },
    };
  }

  private async guard(
    capture: ReturnType<typeof captureGuard>,
    requested: ScopeSelector,
    signal: AbortSignal,
  ): Promise<ScopeTransitionResult | undefined> {
    let decision;
    try {
      decision = await runLeaveGuard(this.input.binding, capture, requested, signal);
    } catch (error) {
      if (error instanceof InvalidScopeGuardError) return this.keepActive('needs-input', 'scope.guard-invalid');
      throw new ScopeTransitionHostError('guard', error);
    }
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    switch (decision.status) {
      case 'stay':
        return this.keepActive('cancelled', 'scope.guard-stay');
      case 'needs-input':
        return this.keepActive('needs-input', decision.diagnostic?.code ?? 'scope.guard-required');
      case 'save':
        break;
      default:
        return undefined;
    }
    const saved = await saveGuard(decision, signal);
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    if (!saved.ok) return this.keepActive('needs-input', firstDiagnosticCode(saved.diagnostics, 'scope.save-failed'));
    return undefined;
  }

  private async runTransition(
    id: number,
    capture: ReturnType<typeof captureGuard>,
    requested: ScopeSelector,
    signal: AbortSignal,
  ): Promise<ScopeTransitionResult> {
    const guarded = await this.guard(capture, requested, signal);
    if (guarded !== undefined) {
      const current = await this.recheckActive(id, capture, signal);
      return current ?? guarded;
    }
    const afterGuard = await this.recheckActive(id, capture, signal);
    if (afterGuard !== undefined) return afterGuard;
    this.publishPending(id, requested, 'resolving');
    let resolved: Outcome<ScopeResolution>;
    try {
      resolved = await this.input.binding.resolve(requested, { signal });
    } catch (error) {
      throw new ScopeTransitionHostError('resolve', error);
    }
    return this.finishResolvedTransition(id, capture, requested, resolved, signal);
  }

  private async finishResolvedTransition(
    id: number,
    capture: ReturnType<typeof captureGuard>,
    requested: ScopeSelector,
    resolved: Outcome<ScopeResolution>,
    signal: AbortSignal,
  ): Promise<ScopeTransitionResult> {
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    const checked = validateResolution(resolved, requested);
    if (!checked.ok) return this.retainOrDeny(id, capture, checked, 'scope.resolve-failed', signal);
    const afterResolve = await this.recheckActive(id, capture, signal);
    if (afterResolve !== undefined) return afterResolve;
    const target = await authorizeScope(this.input.binding, checked.value, signal);
    if (!target.ok) return this.retainOrDeny(id, capture, target, 'scope.permission-denied', signal);
    const afterTarget = await this.recheckActive(id, capture, signal);
    if (afterTarget !== undefined) return afterTarget;
    const finalTarget = await authorizeScope(this.input.binding, checked.value, signal);
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    if (!finalTarget.ok) return this.retainOrDeny(id, capture, finalTarget, 'scope.permission-denied', signal);
    return prepareTransition({
      binding: this.input.binding,
      capture,
      id,
      resolution: checked.value,
      signal,
      readState: this.readTransitionState,
      retain: (outcome) => this.retainOrDeny(id, capture, outcome, 'scope.activation-prepare-failed', signal),
      activate: () => this.activate(id, checked.value, capture),
    });
  }

  private async activateResolvedInitial(id: number, resolution: ScopeResolution, signal: AbortSignal): Promise<void> {
    let authorized: Outcome<void>;
    try {
      authorized = await authorizeScope(this.input.binding, resolution, signal);
    } catch {
      return this.publishInitialFailure(
        diagnostic('scope.permission-check-failed', 'The initial scope permission check failed.'),
      );
    }
    if (!authorized.ok) return this.publishInitialFailure(authorized.diagnostics[0]);
    if (signal.aborted || id !== this.transitionId) return;
    const before = this.snapshot;
    commitInitial({
      binding: this.input.binding,
      id,
      resolution,
      before,
      readState: this.readTransitionState,
      publishFailure: (reason) => this.publishInitialFailure(reason),
      publish: () => {
        this.resolution = resolution;
        this.snapshot = activeSnapshot(before, resolution, 1);
        this.lifecycle.notify();
      },
    });
  }

  private async handleTransitionException(
    id: number,
    signal: AbortSignal,
    error: unknown,
  ): Promise<ScopeTransitionResult> {
    return containTransitionError({
      binding: this.input.binding,
      id,
      signal,
      error,
      readState: this.readTransitionState,
      invalidate: () => this.invalidate('revoked'),
      keepActive: (status, code) => this.keepActive(status, code),
    });
  }

  private activate(
    id: number,
    resolution: ScopeResolution,
    capture: ReturnType<typeof captureGuard>,
  ): ScopeTransitionResult {
    if (id !== this.transitionId) return transitionFailure('stale', 'scope.transition-stale');
    const oldResolution = this.resolution;
    if (oldResolution === undefined) return transitionFailure('stale', 'scope.transition-stale');
    const before = this.snapshot;
    return commitTransition({
      binding: this.input.binding,
      capture,
      id,
      resolution,
      previous: oldResolution,
      before,
      readState: this.readTransitionState,
      publishFenced: (snapshot) => (this.snapshot = snapshot),
      fenceTargets: () => this.targets.fence(before.activationEpoch),
      fenceLifecycle: () => this.lifecycle.fence(),
      failClosed: (code) => this.failClosed(before, code),
      publish: (epoch) => {
        this.resolution = resolution;
        this.snapshot = activeSnapshot(before, resolution, epoch);
        this.lifecycle.notify();
        return Object.freeze({ status: 'active', selector: resolution.selector, activationEpoch: epoch });
      },
    });
  }

  private publishPending(id: number, selector: ScopeSelector, phase: 'guard' | 'resolving'): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      pending: Object.freeze({ selector, phase: phase === 'guard' ? 'guarding' : phase, requestId: `scope-${id}` }),
      revision: String(Number(this.snapshot.revision) + 1),
    });
    this.lifecycle.notify();
  }

  private keepActive(status: 'needs-input' | 'cancelled', diagnosticCode: string): ScopeTransitionResult {
    if (this.snapshot.pending !== undefined) {
      const { pending: _pending, ...active } = this.snapshot;
      this.snapshot = Object.freeze({ ...active, revision: String(Number(active.revision) + 1) });
      this.lifecycle.notify();
    }
    return status === 'needs-input' ? needsInput(diagnosticCode) : transitionFailure(status, diagnosticCode);
  }

  private finishFailure(
    id: number,
    outcome: { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] },
    fallback: string,
  ): ScopeTransitionResult {
    if (id !== this.transitionId) return transitionFailure('stale', 'scope.transition-stale');
    const code = firstDiagnosticCode(outcome.diagnostics, fallback);
    this.keepActive('cancelled', code);
    return transitionFailure(code.includes('denied') || code === 'scope.permission-stale' ? 'denied' : 'failed', code);
  }

  private async recheckActive(
    id: number,
    capture: ReturnType<typeof captureGuard>,
    signal: AbortSignal,
  ): Promise<ScopeTransitionResult | undefined> {
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    let current: boolean;
    try {
      current = transitionGuardCurrent(
        this.input.binding,
        capture,
        this.snapshot,
        id,
        this.transitionId,
        this.disposed,
      );
    } catch (error) {
      throw new ScopeTransitionHostError('guard', error);
    }
    if (!current || this.resolution === undefined) return transitionFailure('stale', 'scope.transition-stale');
    const authorized = await authorizeScope(this.input.binding, this.resolution, signal);
    if (signal.aborted) return transitionFailure('cancelled', 'scope.transition-cancelled');
    if (!authorized.ok) {
      this.invalidate('revoked');
      return transitionFailure('denied', firstDiagnosticCode(authorized.diagnostics, 'scope.permission-denied'));
    }
    try {
      if (!transitionGuardCurrent(this.input.binding, capture, this.snapshot, id, this.transitionId, this.disposed))
        return transitionFailure('stale', 'scope.transition-stale');
    } catch (error) {
      throw new ScopeTransitionHostError('guard', error);
    }
    return undefined;
  }

  private async retainOrDeny(
    id: number,
    capture: ReturnType<typeof captureGuard>,
    outcome: { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] },
    fallback: string,
    signal: AbortSignal,
  ): Promise<ScopeTransitionResult> {
    const current = await this.recheckActive(id, capture, signal);
    if (current !== undefined) return current;
    return this.finishFailure(id, outcome, fallback);
  }

  private clearPending(id: number): void {
    if (this.snapshot.pending?.requestId !== `scope-${id}`) return;
    const { pending: _pending, ...current } = this.snapshot;
    this.snapshot = Object.freeze({ ...current, revision: String(Number(current.revision) + 1) });
    this.lifecycle.notify();
  }

  private failClosed(before: ScopeSnapshot, diagnosticCode: string): ScopeTransitionResult {
    this.resolution = undefined;
    this.snapshot = failedActivationSnapshot(
      before,
      diagnostic(diagnosticCode, 'The host could not activate the authorized scope.'),
    );
    this.lifecycle.fence();
    this.lifecycle.notify();
    return transitionFailure(diagnosticCode.includes('permission') ? 'denied' : 'failed', diagnosticCode);
  }

  private publishInitialFailure(reason: Diagnostic): void {
    this.snapshot = initialFailureSnapshot(this.snapshot, reason);
    this.lifecycle.notify();
  }
}
