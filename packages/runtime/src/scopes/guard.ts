import type { Outcome } from '@varendo/core';
import { freezeDiagnostic } from './diagnostic.js';
import { runtimeDiagnostic } from './diagnostic.js';
import { normalizeVoidOutcome } from './outcome.js';
import type { ScopeBinding, ScopeLeaveDecision, ScopeLeaveState, ScopeSelector, ScopeSnapshot } from './types.js';

const MAX_REVISION = 128;

const STATUS_ONLY_DECISIONS: ReadonlySet<string> = new Set(['clean', 'discard', 'stay']);

export class InvalidScopeGuardError extends TypeError {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leaveState(value: unknown): ScopeLeaveState {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'dirty' && key !== 'revision'))
    throw new InvalidScopeGuardError('The host returned an invalid scope leave state.');
  if (typeof value.dirty !== 'boolean' || typeof value.revision !== 'string')
    throw new InvalidScopeGuardError('The host returned an invalid scope leave state.');
  if (value.revision.length === 0 || value.revision.length > MAX_REVISION)
    throw new InvalidScopeGuardError('The host returned an invalid scope leave revision.');
  return Object.freeze({ dirty: value.dirty, revision: value.revision });
}

function readLeaveState(binding: ScopeBinding, selector: ScopeSelector): ScopeLeaveState {
  return binding.readLeaveState === undefined
    ? Object.freeze({ dirty: false, revision: 'clean' })
    : leaveState(binding.readLeaveState(selector));
}

function leaveDecision(value: unknown): ScopeLeaveDecision {
  if (!isRecord(value) || typeof value.status !== 'string')
    throw new InvalidScopeGuardError('The host returned an invalid scope leave decision.');
  if (STATUS_ONLY_DECISIONS.has(value.status) && Object.keys(value).length === 1)
    return Object.freeze({ status: value.status }) as ScopeLeaveDecision;
  if (value.status === 'needs-input') {
    if (Object.keys(value).some((key) => key !== 'status' && key !== 'diagnostic'))
      throw new InvalidScopeGuardError('The host returned an invalid scope leave decision.');
    if (value.diagnostic === undefined) return Object.freeze({ status: 'needs-input' });
    const fallback = Object.freeze({
      code: 'scope.guard-invalid',
      message: 'The host returned an invalid guard diagnostic.',
      retryable: false,
    });
    const diagnostic = freezeDiagnostic(value.diagnostic, fallback);
    if (diagnostic === fallback) throw new InvalidScopeGuardError('The host returned an invalid guard diagnostic.');
    return Object.freeze({ status: 'needs-input', diagnostic });
  }
  if (value.status === 'save' && Object.keys(value).every((key) => key === 'status' || key === 'save')) {
    if (typeof value.save !== 'function')
      throw new InvalidScopeGuardError('The host returned an invalid scope save decision.');
    return Object.freeze({
      status: 'save',
      save: value.save as Extract<ScopeLeaveDecision, { status: 'save' }>['save'],
    });
  }
  throw new InvalidScopeGuardError('The host returned an unknown scope leave decision.');
}

export interface GuardCapture {
  readonly selector: ScopeSelector;
  readonly activationEpoch: number;
  readonly permissionRevision: number;
  readonly policyRevision: string;
  readonly leaveRevision: string;
}

export function captureGuard(binding: ScopeBinding, snapshot: ScopeSnapshot): GuardCapture {
  if (snapshot.selector === null || snapshot.policyRevision === undefined)
    throw new TypeError('A leave guard requires an active scope.');
  return Object.freeze({
    selector: snapshot.selector,
    activationEpoch: snapshot.activationEpoch,
    permissionRevision: snapshot.permissionRevision,
    policyRevision: snapshot.policyRevision,
    leaveRevision: readLeaveState(binding, snapshot.selector).revision,
  });
}

function guardStillCurrent(binding: ScopeBinding, capture: GuardCapture, snapshot: ScopeSnapshot): boolean {
  const currentRevision = readLeaveState(binding, capture.selector).revision;
  return (
    snapshot.active &&
    snapshot.activationEpoch === capture.activationEpoch &&
    snapshot.permissionRevision === capture.permissionRevision &&
    snapshot.policyRevision === capture.policyRevision &&
    currentRevision === capture.leaveRevision
  );
}

export function transitionGuardCurrent(
  binding: ScopeBinding,
  capture: GuardCapture,
  snapshot: ScopeSnapshot,
  id: number,
  currentId: number,
  disposed: boolean,
): boolean {
  return id === currentId && !disposed && guardStillCurrent(binding, capture, snapshot);
}

export async function runLeaveGuard(
  binding: ScopeBinding,
  capture: GuardCapture,
  requested: ScopeSelector,
  signal: AbortSignal,
): Promise<ScopeLeaveDecision> {
  const state = readLeaveState(binding, capture.selector);
  if (!state.dirty) return { status: 'clean' };
  if (binding.beforeLeave === undefined) return { status: 'needs-input' };
  return leaveDecision(
    await binding.beforeLeave({
      active: capture.selector,
      requested,
      activationEpoch: capture.activationEpoch,
      revision: capture.leaveRevision,
      signal,
    }),
  );
}

export async function saveGuard(
  decision: Extract<ScopeLeaveDecision, { readonly status: 'save' }>,
  signal: AbortSignal,
): Promise<Outcome<void>> {
  const fallback = runtimeDiagnostic('scope.save-failed', 'The host could not save the active scope draft.');
  try {
    return normalizeVoidOutcome(await decision.save({ signal }), fallback);
  } catch {
    return { ok: false, diagnostics: [fallback] };
  }
}
