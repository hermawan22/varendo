import type { Diagnostic, Outcome } from '@varendo/core';
import { freezeDiagnostic } from './diagnostic.js';
import type { ScopeResolution, ScopeSelector } from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_LINEAGE = 16;

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function freezeSelector(selector: ScopeSelector): ScopeSelector {
  if (!isBoundedId(selector.kind) || !isBoundedId(selector.id))
    throw new TypeError('Scope selectors require bounded kind and id values.');
  if (selector.lineage !== undefined && !Array.isArray(selector.lineage))
    throw new TypeError('Scope selector lineage must be an array.');
  if ((selector.lineage?.length ?? 0) > MAX_LINEAGE)
    throw new TypeError(`Scope selector lineage cannot exceed ${MAX_LINEAGE} entries.`);
  const lineage = selector.lineage?.map((entry) => {
    if (!isBoundedId(entry.kind) || !isBoundedId(entry.id))
      throw new TypeError('Scope selector lineage requires bounded kind and id values.');
    return Object.freeze({ kind: entry.kind, id: entry.id });
  });
  return Object.freeze({
    kind: selector.kind,
    id: selector.id,
    ...(lineage === undefined ? {} : { lineage: Object.freeze(lineage) }),
  });
}

export function sameSelector(left: ScopeSelector | null | undefined, right: ScopeSelector | null | undefined): boolean {
  if (left == null || right == null) return left === right;
  if (left.kind !== right.kind || left.id !== right.id) return false;
  const leftLineage = left.lineage ?? [];
  const rightLineage = right.lineage ?? [];
  if (leftLineage.length !== rightLineage.length) return false;
  return leftLineage.every(
    (entry, index) => entry.kind === rightLineage[index]?.kind && entry.id === rightLineage[index]?.id,
  );
}

function freezeAllowedFeatures(value: ScopeResolution['allowedFeatures']): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('Allowed feature IDs must be an array.');
  if (value.length > 256) throw new TypeError('A scope cannot authorize more than 256 features.');
  const features = value.map((featureId) => {
    if (!isBoundedId(featureId)) throw new TypeError('Allowed feature IDs must be bounded values.');
    return featureId;
  });
  return Object.freeze([...new Set(features)]);
}

function freezeResolution(resolution: ScopeResolution): ScopeResolution {
  if (!Number.isSafeInteger(resolution.permissionRevision) || resolution.permissionRevision < 0)
    throw new TypeError('Scope permission revisions must be non-negative safe integers.');
  if (
    typeof resolution.policyRevision !== 'string' ||
    resolution.policyRevision.length === 0 ||
    resolution.policyRevision.length > 128
  )
    throw new TypeError('Scope policy revisions must be bounded non-empty values.');
  const allowedFeatures = freezeAllowedFeatures(resolution.allowedFeatures);
  return Object.freeze({
    selector: freezeSelector(resolution.selector),
    permissionRevision: resolution.permissionRevision,
    policyRevision: resolution.policyRevision,
    ...(allowedFeatures === undefined ? {} : { allowedFeatures }),
  });
}

function resolutionFailure(code: string): { readonly ok: false; readonly diagnostics: readonly [Diagnostic] } {
  return {
    ok: false,
    diagnostics: [
      Object.freeze({ code, message: 'The trusted host returned an invalid scope resolution.', retryable: false }),
    ],
  };
}

const deniedResolution = Object.freeze({
  code: 'scope.resolve-denied',
  message: 'The trusted host denied the requested scope.',
  retryable: false,
});

export function validateResolution(
  outcome: Outcome<ScopeResolution>,
  requested: ScopeSelector,
): Outcome<ScopeResolution> {
  try {
    if (outcome.ok === false) {
      if (!Array.isArray(outcome.diagnostics) || outcome.diagnostics.length === 0)
        return resolutionFailure('scope.resolve-invalid');
      const diagnostic = freezeDiagnostic(outcome.diagnostics[0], deniedResolution);
      if (diagnostic === deniedResolution) return resolutionFailure('scope.resolve-invalid');
      return { ok: false, diagnostics: [diagnostic] };
    }
    if (outcome.ok !== true) return resolutionFailure('scope.resolve-invalid');
    const resolution = freezeResolution(outcome.value);
    return sameSelector(resolution.selector, requested)
      ? { ok: true, value: resolution }
      : resolutionFailure('scope.selector-mismatch');
  } catch {
    return resolutionFailure('scope.resolve-invalid');
  }
}
