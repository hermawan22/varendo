import type { Diagnostic } from '@varendo/core';
import type { CreateLocalSurfaceScopeInput, LocalSurfaceScope, SurfaceScopeSnapshot } from './types.js';

let nextScopeId = 1;

function denied(message: string): { readonly ok: false; readonly diagnostics: readonly [Diagnostic] } {
  return {
    ok: false,
    diagnostics: [{ code: 'surface.permission-denied', message, retryable: false }],
  };
}

export function createLocalSurfaceScope(
  runtimeId: string,
  input: CreateLocalSurfaceScopeInput = {},
): LocalSurfaceScope {
  const scopeInstanceId = input.id ?? `local-${nextScopeId++}`;
  const permissions = input.allowedFeatures === undefined ? undefined : new Set(input.allowedFeatures);
  let active = true;
  let permissionRevision = 1;
  const snapshot = (): SurfaceScopeSnapshot =>
    Object.freeze({ runtimeId, scopeInstanceId, activationEpoch: 1, active, permissionRevision });
  return Object.freeze({
    getSnapshot: snapshot,
    authorize(featureId: string) {
      if (!active) return denied('The local surface scope is disposed.');
      if (permissions !== undefined && !permissions.has(featureId))
        return denied(`Feature ${featureId} is not authorized in this local read-only scope.`);
      return { ok: true as const, value: undefined };
    },
    setFeaturePermission(featureId: string, allowed: boolean) {
      if (!active) return;
      const before = permissions?.has(featureId) ?? true;
      if (permissions !== undefined) {
        if (allowed) permissions.add(featureId);
        else permissions.delete(featureId);
      } else if (!allowed) {
        throw new TypeError('A scope with unrestricted local reads cannot mutate individual permissions.');
      }
      if (before !== allowed) permissionRevision += 1;
    },
    dispose() {
      if (!active) return;
      active = false;
      permissionRevision += 1;
    },
  });
}
