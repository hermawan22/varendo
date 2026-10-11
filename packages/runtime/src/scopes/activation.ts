import type { Diagnostic } from '@varendo/core';
import { freezeDiagnostic, runtimeDiagnostic } from './diagnostic.js';
import type { ScopeResolution, ScopeSnapshot } from './types.js';

export function activeSnapshot(
  current: ScopeSnapshot,
  resolution: ScopeResolution,
  activationEpoch: number,
): ScopeSnapshot {
  return Object.freeze({
    runtimeId: current.runtimeId,
    scopeInstanceId: current.scopeInstanceId,
    activationEpoch,
    active: true,
    permissionRevision: resolution.permissionRevision,
    status: 'active',
    selector: resolution.selector,
    policyRevision: resolution.policyRevision,
    revision: String(Number(current.revision) + 1),
  });
}

export function failedActivationSnapshot(current: ScopeSnapshot, diagnostic: Diagnostic): ScopeSnapshot {
  return Object.freeze({
    runtimeId: current.runtimeId,
    scopeInstanceId: current.scopeInstanceId,
    activationEpoch: current.activationEpoch,
    active: false,
    permissionRevision: current.permissionRevision + 1,
    status: 'denied',
    selector: null,
    revision: String(Number(current.revision) + 1),
    diagnostic,
  });
}

export function initialFailureSnapshot(current: ScopeSnapshot, reason: Diagnostic): ScopeSnapshot {
  const safeReason = freezeDiagnostic(
    reason,
    runtimeDiagnostic('scope.host-failure', 'The trusted host returned an invalid diagnostic.'),
  );
  return Object.freeze({
    ...current,
    status: 'denied',
    selector: null,
    revision: String(Number(current.revision) + 1),
    diagnostic: safeReason,
  });
}
