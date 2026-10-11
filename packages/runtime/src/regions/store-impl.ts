import { WIRE_LIMITS, validateCommitReadSet } from '@varendo/core';
import type { ResultRef } from '@varendo/core';
import { parseRegionDocument } from '../persistence/index.js';
import type { RegionDocument } from '../persistence/types.js';
import type { ResultHandle } from '../results/types.js';
import { RegionHandleImpl } from './handle.js';
import type { OwnedResultLease } from './result-handles.js';
import type {
  AuthorizeRegionCommit,
  ReadAuthority,
  RegionAuthority,
  RegionCreateInput,
  RegionContent,
  RegionHandle,
  RegionHistoryEntry,
  RegionOutcome,
  RegionRestoreMaterialization,
  RegionStore,
  RegionStoreOptions,
  RestoreRegion,
} from './types.js';
import {
  FAILURE,
  authorityReadSet,
  bindCandidateToReadSet,
  failure,
  newRegionRevision,
  normalizeHostOutcome,
  requiredResultReferences,
  stripData,
  validateAuthority,
  validateState,
  validId,
} from './region-contracts.js';
import {
  bindResultHandleToAuthority,
  releaseLeases,
  resultRefFromHandle,
  retainResultHandle,
} from './result-handles.js';
import { resolveStoreConfiguration } from './store-options.js';
import { restoreWithDeadline } from './deadline.js';

interface RestorePreparation {
  readonly document: RegionDocument;
  readonly epoch: number;
}

interface ValidatedRestore {
  readonly state: RegionContent;
  readonly authority: RegionAuthority;
  readonly incarnation: string;
}

interface RetainedRestoreResults {
  readonly leases: readonly OwnedResultLease[];
  readonly required: readonly ResultRef[];
}

interface RegionHandleSeed {
  readonly taskRevision: string;
  readonly regionRevision: string;
  readonly dataRevision: number;
  readonly history: readonly RegionHistoryEntry[];
}

type RegionAdmissionFailure = Extract<RegionOutcome<never>, { readonly ok: false }>;

function sameRestoreAuthority(left: RegionAuthority, right: RegionAuthority): boolean {
  return (
    left.principalKey === right.principalKey &&
    left.scopeDigest === right.scopeDigest &&
    left.policyRevision === right.policyRevision &&
    left.catalogRevision === right.catalogRevision &&
    left.experienceRevision === right.experienceRevision &&
    left.functionRegistryDigest === right.functionRegistryDigest
  );
}

function taskMatchesAuthority(task: RegionContent['task'], authority: RegionAuthority): boolean {
  return (
    task.catalogRevision === authority.catalogRevision &&
    task.functionRegistryDigest === authority.functionRegistryDigest
  );
}

function releaseRestoreFailure<T>(result: RegionOutcome<T>, leases: readonly OwnedResultLease[]): RegionOutcome<T> {
  releaseLeases(leases);
  return result;
}

export class RegionStoreImpl implements RegionStore {
  private readonly regions = new Map<string, RegionHandleImpl>();
  private readonly maxRegions: number;
  private readonly maxHistory: number;
  private readonly maxQueuedCommands: number;
  private readonly maxStagedCommits: number;
  private readonly maxStagedBytes: number;
  private readonly maxCommitAuthorizationMilliseconds: number;
  private readonly maxRestoreMilliseconds: number;
  private readonly now: () => number;
  private readonly readAuthority: ReadAuthority;
  private readonly authorizeCommit: AuthorizeRegionCommit;
  private readonly restoreRegion: RestoreRegion | undefined;
  private readonly authorityConfigured: boolean;
  private readonly authorizationConfigured: boolean;
  private disposed = false;
  private epoch = 0;
  private readonly restoreControllers = new Set<AbortController>();
  private pendingRestores = 0;

  constructor(options: RegionStoreOptions) {
    const configuration = resolveStoreConfiguration(options);
    this.maxRegions = configuration.maxRegions;
    this.maxHistory = configuration.maxHistory;
    this.maxQueuedCommands = configuration.maxQueuedCommands;
    this.maxStagedCommits = configuration.maxStagedCommits;
    this.maxStagedBytes = configuration.maxStagedBytes;
    this.maxCommitAuthorizationMilliseconds = configuration.maxCommitAuthorizationMilliseconds;
    this.maxRestoreMilliseconds = configuration.maxRestoreMilliseconds;
    this.now = configuration.now;
    this.readAuthority = configuration.readAuthority;
    this.authorizeCommit = configuration.authorizeCommit;
    this.restoreRegion = configuration.restoreRegion;
    this.authorityConfigured = configuration.authorityConfigured;
    this.authorizationConfigured = configuration.authorizationConfigured;
  }

  remove(id: string): void {
    this.regions.delete(id);
  }

  private admissionFailure(id: string, reservedRestore: boolean): RegionAdmissionFailure | undefined {
    if (this.disposed) return failure('runtime.region-disposed', FAILURE.disposed) as RegionAdmissionFailure;
    if (this.regions.has(id))
      return failure(
        'runtime.region-invalid',
        'A region with this stable ID already exists.',
      ) as RegionAdmissionFailure;
    const otherPendingRestores = this.pendingRestores - (reservedRestore ? 1 : 0);
    if (this.regions.size + otherPendingRestores >= this.maxRegions)
      return failure('runtime.region-budget', FAILURE.budget) as RegionAdmissionFailure;
    return undefined;
  }

  private validateCreateInput(input: RegionCreateInput): RegionOutcome<RegionContent> {
    if (this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
    if (!this.authorizationConfigured) return failure('runtime.region-denied', FAILURE.denied);
    if (input === null || typeof input !== 'object' || !validId(input.id))
      return failure('runtime.region-invalid', FAILURE.invalid);
    if (!Object.hasOwn(input, 'state'))
      return failure('runtime.region-invalid', 'A region requires canonical initial state.');
    if (this.regions.has(input.id))
      return failure('runtime.region-invalid', 'A region with this stable ID already exists.');
    if (this.regions.size + this.pendingRestores >= this.maxRegions)
      return failure('runtime.region-budget', FAILURE.budget);
    return validateState(input.state, input.id);
  }

  private validateInitialBinding(
    state: RegionContent,
    authority: RegionAuthority,
    incarnation: string,
  ): RegionOutcome<void> {
    if (
      state.task.catalogRevision !== authority.catalogRevision ||
      state.task.functionRegistryDigest !== authority.functionRegistryDigest
    )
      return failure('runtime.region-stale', 'The initial Task is bound to a different catalog or function registry.');
    const readSet = authorityReadSet(authority, state.task.revision, incarnation, 0);
    const binding = bindCandidateToReadSet(state, readSet);
    if (!binding.ok) return binding;
    const required = validateCommitReadSet(stripData(readSet), stripData(readSet), requiredResultReferences(state));
    if (!required.ok) return failure('runtime.region-stale', required.diagnostics[0]!.message);
    return { ok: true, value: undefined };
  }

  private constructRegionHandle(
    input: RegionCreateInput,
    authority: RegionAuthority,
    seed: RegionHandleSeed | undefined,
    maxHistory: number,
  ): RegionHandleImpl {
    const options = {
      maxHistory,
      maxQueuedCommands: this.maxQueuedCommands,
      maxStagedCommits: this.maxStagedCommits,
      maxStagedBytes: this.maxStagedBytes,
      maxCommitAuthorizationMilliseconds: this.maxCommitAuthorizationMilliseconds,
      now: this.now,
      readAuthority: this.readAuthority,
      authorizeCommit: this.authorizeCommit,
      authorizationConfigured: this.authorizationConfigured,
    };
    return new RegionHandleImpl((id) => this.remove(id), input, options, {
      authority,
      taskRevision: seed?.taskRevision ?? input.state.task.revision,
      regionRevision: seed?.regionRevision ?? newRegionRevision(),
      dataRevision: seed?.dataRevision ?? 0,
      history: seed?.history ?? [],
    });
  }

  private authority(id: string, expectedEpoch = this.epoch): RegionOutcome<RegionAuthority> {
    if (!this.authorityConfigured) return failure('runtime.region-denied', FAILURE.denied);
    try {
      const result = this.readAuthority(id);
      if (expectedEpoch !== this.epoch || this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
      const normalized = normalizeHostOutcome<RegionAuthority>(result);
      if (expectedEpoch !== this.epoch || this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
      if (!normalized.ok) return normalized as RegionOutcome<RegionAuthority>;
      return validateAuthority(normalized.value);
    } catch {
      if (expectedEpoch !== this.epoch || this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
      return failure('runtime.region-denied', FAILURE.denied);
    }
  }

  private restoreWithDeadline(
    document: RegionDocument,
    authority: RegionAuthority,
    expectedEpoch: number,
  ): Promise<RegionOutcome<RegionRestoreMaterialization>> {
    return restoreWithDeadline({
      document,
      authority,
      maxRestoreMilliseconds: this.maxRestoreMilliseconds,
      restoreRegion: this.restoreRegion,
      isCurrent: () => expectedEpoch === this.epoch && !this.disposed,
      controllers: this.restoreControllers,
    });
  }

  private abortPendingRestores(): void {
    for (const controller of [...this.restoreControllers]) {
      try {
        controller.abort();
      } catch {
        /* cancellation is best effort for host code */
      }
    }
  }

  private createInternal(
    input: RegionCreateInput,
    authority: RegionAuthority,
    seed?: RegionHandleSeed,
    initialResultLeases: readonly OwnedResultLease[] = [],
    reservedRestore = false,
  ): RegionOutcome<RegionHandle> {
    const admission = this.admissionFailure(input.id, reservedRestore);
    if (admission !== undefined) return admission;
    const maxHistory = input.maxHistory ?? this.maxHistory;
    if (!Number.isSafeInteger(maxHistory) || maxHistory < 1 || maxHistory > WIRE_LIMITS.array)
      return failure('runtime.region-budget', FAILURE.budget);
    try {
      const handle = this.constructRegionHandle(input, authority, seed, maxHistory);
      // Construction can invoke the injected clock, so recheck admission before
      // transferring caller-owned leases into the handle.
      if (this.disposed) {
        handle.dispose();
        return failure('runtime.region-disposed', FAILURE.disposed);
      }
      const postConstructionAdmission = this.admissionFailure(input.id, reservedRestore);
      if (postConstructionAdmission !== undefined) {
        handle.dispose();
        return postConstructionAdmission;
      }
      handle.adoptInitialResultLeases(initialResultLeases);
      this.regions.set(input.id, handle);
      return { ok: true, value: handle };
    } catch (error) {
      return failure('runtime.region-invalid', error instanceof Error ? error.message : FAILURE.invalid);
    }
  }

  create(input: RegionCreateInput): RegionOutcome<RegionHandle> {
    const state = this.validateCreateInput(input);
    if (!state.ok) return state;
    const authority = this.authority(input.id);
    if (!authority.ok) return authority as RegionOutcome<RegionHandle>;
    const incarnation = newRegionRevision();
    const binding = this.validateInitialBinding(state.value, authority.value, incarnation);
    if (!binding.ok) return binding as RegionOutcome<RegionHandle>;
    return this.createInternal({ ...input, state: state.value }, authority.value, {
      taskRevision: state.value.task.revision,
      regionRevision: incarnation,
      dataRevision: 0,
      history: [],
    });
  }

  private prepareRestore(documentInput: unknown): RegionOutcome<RestorePreparation> {
    const restoreEpoch = this.epoch;
    if (this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
    if (!this.authorizationConfigured) return failure('runtime.region-denied', FAILURE.denied);
    if (this.restoreRegion === undefined)
      return failure('runtime.region-denied', 'Restoring a region requires a host requery callback.');
    const document = parseRegionDocument(documentInput as RegionDocument | string);
    if (!document.ok) return document;
    if (this.regions.has(document.value.id))
      return failure('runtime.region-invalid', 'A region with this stable ID already exists.');
    if (this.regions.size + this.pendingRestores >= this.maxRegions)
      return failure('runtime.region-budget', FAILURE.budget);
    return { ok: true, value: { document: document.value, epoch: restoreEpoch } };
  }

  async restore(documentInput: unknown): Promise<RegionOutcome<RegionHandle>> {
    const prepared = this.prepareRestore(documentInput);
    if (!prepared.ok) return prepared;
    this.pendingRestores++;
    try {
      return await this.restorePrepared(prepared.value);
    } finally {
      this.pendingRestores--;
    }
  }

  private async restorePrepared({ document, epoch }: RestorePreparation): Promise<RegionOutcome<RegionHandle>> {
    const authority = this.authority(document.id, epoch);
    if (!authority.ok) return authority as RegionOutcome<RegionHandle>;
    if (!taskMatchesAuthority(document.task, authority.value))
      return failure(
        'runtime.region-stale',
        'The persisted Task is bound to a different catalog or function registry.',
      );
    const materialization = await this.restoreWithDeadline(document, authority.value, epoch);
    if (!materialization.ok) return materialization as RegionOutcome<RegionHandle>;
    const validated = this.validateRestoreMaterialization(document, materialization.value, authority.value, epoch);
    if (!validated.ok) return validated as RegionOutcome<RegionHandle>;
    const retained = this.retainRestoreResults(
      materialization.value.resultHandles ?? [],
      validated.value.state,
      validated.value.authority,
      epoch,
    );
    if (!retained.ok) return retained as RegionOutcome<RegionHandle>;
    return this.commitRestoredRegion(validated.value, retained.value, epoch);
  }

  private validateRestoreMaterialization(
    document: RegionDocument,
    materialization: RegionRestoreMaterialization,
    originalAuthority: RegionAuthority,
    epoch: number,
  ): RegionOutcome<ValidatedRestore> {
    if (epoch !== this.epoch || this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
    const checked = validateState(materialization.state, document.id);
    if (!checked.ok) return checked;
    if (checked.value.task.id !== document.task.id)
      return failure('runtime.region-stale', 'The restored Task does not match the persisted Task identity.');
    const authority = this.authority(document.id, epoch);
    if (!authority.ok) return authority;
    if (!sameRestoreAuthority(authority.value, originalAuthority))
      return failure('runtime.region-stale', 'The host authorization changed while restoring the region.');
    if (!taskMatchesAuthority(checked.value.task, authority.value))
      return failure('runtime.region-stale', 'The restored Task is bound to a different catalog or function registry.');
    const incarnation = newRegionRevision();
    const readSet = authorityReadSet(authority.value, checked.value.task.revision, incarnation, 0);
    const binding = bindCandidateToReadSet(checked.value, readSet);
    if (!binding.ok) return binding as RegionOutcome<ValidatedRestore>;
    return { ok: true, value: { state: checked.value, authority: authority.value, incarnation } };
  }

  private retainRestoreResults(
    handles: readonly ResultHandle[],
    state: RegionContent,
    authority: RegionAuthority,
    epoch: number,
  ): RegionOutcome<RetainedRestoreResults> {
    if (!Array.isArray(handles) || handles.length > WIRE_LIMITS.array)
      return failure('runtime.region-budget', FAILURE.budget);
    const leases: OwnedResultLease[] = [];
    const required = [...requiredResultReferences(state)];
    for (const handle of handles) {
      const retained = this.retainRestoreResult(handle, authority, epoch);
      if (!retained.ok) return releaseRestoreFailure(retained, leases);
      leases.push(retained.value.lease);
      required.push(retained.value.ref);
    }
    return { ok: true, value: { leases, required } };
  }

  private retainRestoreResult(
    handle: ResultHandle,
    authority: RegionAuthority,
    epoch: number,
  ): RegionOutcome<{ readonly ref: ResultRef; readonly lease: OwnedResultLease }> {
    const ref = resultRefFromHandle(handle);
    if (!ref.ok) return ref as RegionOutcome<{ readonly ref: ResultRef; readonly lease: OwnedResultLease }>;
    if (epoch !== this.epoch || this.disposed) return failure('runtime.region-disposed', FAILURE.disposed);
    const binding = bindResultHandleToAuthority(handle, authority);
    if (!binding.ok) return binding as RegionOutcome<{ readonly ref: ResultRef; readonly lease: OwnedResultLease }>;
    const lease = retainResultHandle(handle);
    if (!lease.ok) return lease as RegionOutcome<{ readonly ref: ResultRef; readonly lease: OwnedResultLease }>;
    return { ok: true, value: { ref: ref.value, lease: { ref: ref.value, lease: lease.value } } };
  }

  private commitRestoredRegion(
    restored: ValidatedRestore,
    retained: RetainedRestoreResults,
    epoch: number,
  ): RegionOutcome<RegionHandle> {
    const { state, authority, incarnation } = restored;
    const readSet = authorityReadSet(authority, state.task.revision, incarnation, 0);
    const readCheck = validateCommitReadSet(stripData(readSet), stripData(readSet), retained.required);
    if (!readCheck.ok)
      return releaseRestoreFailure(failure('runtime.region-stale', readCheck.diagnostics[0]!.message), retained.leases);
    const finalState = validateState(state, state.task.regionId);
    if (!finalState.ok) return releaseRestoreFailure(finalState, retained.leases);
    if (epoch !== this.epoch || this.disposed)
      return releaseRestoreFailure(failure('runtime.region-disposed', FAILURE.disposed), retained.leases);
    if (this.regions.has(state.task.regionId))
      return releaseRestoreFailure(
        failure('runtime.region-invalid', 'A region with this stable ID already exists.'),
        retained.leases,
      );
    // Persisted history is metadata; restoration starts with fresh live state.
    const created = this.createInternal(
      { id: state.task.regionId, state: finalState.value },
      authority,
      { taskRevision: finalState.value.task.revision, regionRevision: incarnation, dataRevision: 0, history: [] },
      retained.leases,
      true,
    );
    if (!created.ok) releaseLeases(retained.leases);
    return created;
  }

  get(id: string): RegionHandle | undefined {
    return this.regions.get(id);
  }
  revoke(id: string, reason?: string): boolean {
    return this.regions.get(id)?.revoke(reason) ?? false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.epoch++;
    this.disposed = true;
    this.abortPendingRestores();
    for (const region of [...this.regions.values()]) region.dispose();
    this.regions.clear();
  }
}

export function createRegionStore(options: RegionStoreOptions): RegionStore {
  return new RegionStoreImpl(options);
}
