import type { CommitPreconditions, Result, Task } from '@varendo/core';
import type { PresentationTargetEvidence } from '@varendo/core/presentation';
import type { RuntimeRenderReceipt } from '../app/types.js';
import type { SurfaceAddress } from './types.js';

export interface SurfacePresentationEvidence {
  readonly task: Task;
  readonly results: readonly Result[];
  readonly current: CommitPreconditions;
  /** The committed runtime region, fenced by its owning public surface activation. */
  readonly target: PresentationTargetEvidence;
}

/** Copies metadata from a committed evaluation; result row batches are excluded. */
export function presentationEvidence(
  receipt: RuntimeRenderReceipt,
  address: SurfaceAddress,
): SurfacePresentationEvidence | undefined {
  if (receipt.status !== 'committed' || receipt.region.readSet === undefined) return undefined;
  const results: Result[] = [];
  for (const output of receipt.outputs) {
    const descriptor = output.handle.snapshot().descriptor;
    if (descriptor === undefined) return undefined;
    results.push(descriptor);
  }
  if (results.length === 0) return undefined;
  const readSet = receipt.region.readSet;
  const current: CommitPreconditions = Object.freeze({
    scopeDigest: readSet.scopeDigest,
    policyRevision: readSet.policyRevision,
    taskRevision: readSet.taskRevision,
    regionRevision: readSet.regionRevision,
    catalogRevision: readSet.catalogRevision,
    experienceRevision: readSet.experienceRevision,
    functionRegistryDigest: readSet.functionRegistryDigest,
    results: Object.freeze([...readSet.results]),
  });
  const target: PresentationTargetEvidence = Object.freeze({
    address: Object.freeze({ ...address, surfaceId: receipt.regionId }),
    state: 'active',
  });
  return Object.freeze({ task: receipt.task, results: Object.freeze(results), current, target });
}
