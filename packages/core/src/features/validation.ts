import type { Diagnostic, Outcome, VersionRef } from '../contracts/types.js';
import { versionRefKey } from '../contracts/stable.js';
import { FeatureDefinitionError } from './types.js';

const MAX_DEFINITIONS = 128;
const CAPABILITY_KINDS = new Set(['read', 'status', 'command', 'cancel', 'output']);

function diagnostic(code: string, message: string, path: readonly (string | number)[] = []): Diagnostic {
  return { code, message, path, retryable: false };
}

export function failure<T>(code: string, message: string, path: readonly (string | number)[] = []): Outcome<T> {
  return { ok: false, diagnostics: [diagnostic(code, message, path)] };
}

export function throwFeature(code: string, message: string, path: readonly (string | number)[] = []): never {
  throw new FeatureDefinitionError([diagnostic(code, message, path)]);
}

export function validFeatureId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function validReference(value: unknown): value is VersionRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record.id === 'string' &&
    record.id.includes('.') &&
    validFeatureId(record.id) &&
    validFeatureId(record.revision)
  );
}

export function referenceKey(ref: VersionRef): string {
  return versionRefKey(ref);
}

export function assertDefinitionCount(values: readonly unknown[], path: string): void {
  if (values.length === 0 || values.length > MAX_DEFINITIONS)
    throwFeature('feature.definition-count', `${path} must contain 1–${MAX_DEFINITIONS} definitions.`, [path]);
}

export function assertReferenceCount(values: readonly unknown[], path: readonly (string | number)[]): void {
  if (values.length > MAX_DEFINITIONS)
    throwFeature('feature.reference-count', `A feature reference list cannot exceed ${MAX_DEFINITIONS} entries.`, path);
}

export function assertReference(ref: unknown, path: readonly (string | number)[]): asserts ref is VersionRef {
  if (!validReference(ref))
    throwFeature('feature.reference', 'Feature references require a bounded namespaced ID and revision.', path);
}

export function assertCapabilityKind(value: unknown, path: readonly (string | number)[]): void {
  if (typeof value !== 'string' || !CAPABILITY_KINDS.has(value))
    throwFeature('feature.capability-kind', 'A capability requires explicit bounded effect semantics.', path);
}

export function frozenRef(ref: VersionRef): VersionRef {
  return Object.freeze({ id: ref.id, revision: ref.revision });
}

export function freezeOwned<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeOwned(child);
  return value;
}
