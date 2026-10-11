import { WIRE_LIMITS } from '@varendo/core';
import type { ResultRef } from '@varendo/core';
import type { ResultHandle, ResultLease, ResultStatus } from '../results/types.js';
import type { RegionAuthority, RegionContent, RegionOutcome, RegionRestoreMaterialization } from './types.js';
import { FAILURE, failure, frozen, validateResultRef } from './region-contracts.js';

const READABLE_STATUSES: ReadonlySet<ResultStatus> = new Set(['ready', 'partial', 'refreshing']);

export function resultRefFromHandle(handle: ResultHandle): RegionOutcome<ResultRef> {
  if (handle === null || typeof handle !== 'object' || typeof handle.snapshot !== 'function')
    return failure('runtime.region-invalid', 'Region dependencies must be real ResultHandles.');
  try {
    const snapshot = handle.snapshot();
    const ref = snapshot.descriptor?.ref;
    if (ref === undefined || !validateResultRef(ref))
      return failure('runtime.region-stale', 'A result handle has no committed descriptor to bind to the region.');
    if (
      ref.outputId !== handle.key.outputId ||
      ref.queryDigest !== handle.key.queryDigest ||
      ref.scopeDigest !== handle.key.scopeDigest ||
      !READABLE_STATUSES.has(snapshot.status)
    )
      return failure('runtime.region-stale', 'The result handle is no longer an authorized dependency.');
    return { ok: true, value: frozen({ ...ref }) };
  } catch {
    return failure('runtime.region-stale', 'The result handle is no longer an authorized dependency.');
  }
}

export function retainResultHandle(handle: ResultHandle): RegionOutcome<ResultLease> {
  try {
    if (handle === null || typeof handle !== 'object' || typeof handle.retain !== 'function')
      return failure(
        'runtime.region-invalid',
        'Region dependencies must be real ResultHandles with a retainable lease.',
      );
    const lease = handle.retain();
    if (lease === null || typeof lease !== 'object' || typeof lease.release !== 'function' || lease.released)
      return failure('runtime.region-stale', 'A result handle is no longer available for a region lease.');
    return { ok: true, value: lease };
  } catch {
    return failure('runtime.region-stale', 'A result handle could not be retained by the region.');
  }
}

export function bindResultHandleToAuthority(handle: ResultHandle, authority: RegionAuthority): RegionOutcome<void> {
  try {
    const key = handle.key;
    if (
      key.principalKey !== authority.principalKey ||
      key.scopeDigest !== authority.scopeDigest ||
      key.policyRevision !== authority.policyRevision ||
      key.catalogRevision !== authority.catalogRevision ||
      key.functionRegistryDigest !== authority.functionRegistryDigest
    )
      return failure('runtime.region-stale', 'A result handle belongs to a different principal or authorization pin.');
    return { ok: true, value: undefined };
  } catch {
    return failure('runtime.region-stale', 'A result handle has no stable authorization identity.');
  }
}

export function resultHandleGeneration(handle: ResultHandle): RegionOutcome<number> {
  try {
    const generation = handle.generation;
    if (!Number.isSafeInteger(generation) || generation < 0)
      return failure('runtime.region-stale', 'A result handle has no stable generation.');
    return { ok: true, value: generation };
  } catch {
    return failure('runtime.region-stale', 'A result handle has no stable generation.');
  }
}

export interface OwnedResultLease {
  readonly ref: ResultRef;
  readonly lease: ResultLease;
}

export function releaseLeases(leases: readonly OwnedResultLease[]): void {
  for (const owned of leases) {
    try {
      owned.lease.release();
    } catch {
      /* a host lease cannot invalidate region state */
    }
  }
}

export function validateRestoreMaterialization(value: unknown): RegionOutcome<RegionRestoreMaterialization> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return failure('runtime.region-denied', FAILURE.denied);
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => key !== 'state' && key !== 'resultHandles') ||
      !Object.hasOwn(record, 'state')
    )
      return failure('runtime.region-denied', FAILURE.denied);
    if (
      record.resultHandles !== undefined &&
      (!Array.isArray(record.resultHandles) || record.resultHandles.length > WIRE_LIMITS.array)
    )
      return failure('runtime.region-budget', FAILURE.budget);
    return {
      ok: true,
      value: frozen({
        state: record.state as RegionContent,
        ...(record.resultHandles === undefined
          ? {}
          : { resultHandles: Object.freeze([...record.resultHandles] as ResultHandle[]) }),
      }),
    };
  } catch {
    return failure('runtime.region-denied', FAILURE.denied);
  }
}

export function resultRefForHandle(handle: ResultHandle): RegionOutcome<ResultRef> {
  return resultRefFromHandle(handle);
}
