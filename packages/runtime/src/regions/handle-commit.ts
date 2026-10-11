import { validateCommitReadSet } from '@varendo/core';
import type {
  RegionAuthority,
  RegionCommitAuthorizationInput,
  RegionCommitOptions,
  RegionCommitToken,
  RegionOutcome,
  RegionContent,
  RegionReadSet,
  RegionSnapshot,
} from './types.js';
import {
  FAILURE,
  authorityReadSet,
  failure,
  frozen,
  nextRevision,
  normalizeHostOutcome,
  normalizeRefs,
  refKey,
  stripData,
  validateState,
} from './region-contracts.js';
import {
  bindResultHandleToAuthority,
  releaseLeases,
  resultHandleGeneration,
  resultRefFromHandle,
} from './result-handles.js';
import type { StageRecord } from './handle-base.js';
import { RegionStageHandle } from './handle-stage.js';
import { authorizeWithDeadline } from './deadline.js';

interface PreparedCommit {
  readonly taskRevision: string;
  readonly regionRevision: string;
  readonly state: RegionContent;
  readonly readSet: RegionReadSet;
  readonly snapshot: RegionSnapshot;
  readonly at: number;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as PromiseLike<unknown>).then === 'function';
}

export class RegionCommitHandle extends RegionStageHandle {
  private validateToken(token: RegionCommitToken): RegionOutcome<StageRecord> {
    if (token === null || typeof token !== 'object')
      return failure('runtime.region-invalid', 'The commit token is not recognized by this region.');
    const record = this.staged.get(token);
    if (record === undefined || record.token !== token)
      return failure('runtime.region-invalid', 'The commit token is not recognized by this region.');
    if (record.consumed) return failure('runtime.region-stale', 'A region commit token can only be used once.');
    record.consumed = true;
    this.staged.delete(token);
    this.stagedBytes = Math.max(0, this.stagedBytes - record.bytes);
    this.inFlight.add(record);
    return { ok: true, value: record };
  }

  private handleGenerationsCurrent(
    record: StageRecord,
    authority: RegionAuthority,
    expectedEpoch = this.epoch,
  ): RegionOutcome<void> {
    for (const handle of record.resultHandles) {
      const ref = resultRefFromHandle(handle);
      if (!ref.ok) return ref;
      if (!this.live(expectedEpoch)) return this.closedOutcome();
      const binding = bindResultHandleToAuthority(handle, authority);
      if (!binding.ok) return binding;
      if (!this.live(expectedEpoch)) return this.closedOutcome();
      const generation = resultHandleGeneration(handle);
      if (!generation.ok) return generation;
      if (record.handleGenerations.get(refKey(ref.value)) !== generation.value)
        return failure('runtime.region-stale', FAILURE.stale);
    }
    return { ok: true, value: undefined };
  }

  private authorizeWithDeadline(
    input: Omit<RegionCommitAuthorizationInput, 'signal'>,
    expectedEpoch: number,
    callerSignal?: AbortSignal,
  ): Promise<RegionOutcome<void>> {
    return authorizeWithDeadline({
      input,
      callerSignal,
      maxMilliseconds: this.maxCommitAuthorizationMilliseconds,
      authorize: this.authorizeCommit,
      isLive: () => this.live(expectedEpoch),
      closedOutcome: () => this.closedOutcome(),
      controllers: this.authorizationControllers,
    });
  }

  private settleStageRecord(record: StageRecord, transferred: boolean): void {
    this.inFlight.delete(record);
    if (!transferred) releaseLeases(record.resultLeases);
  }

  private baseRevisionIsCurrent(record: StageRecord): boolean {
    return (
      this.taskRevision === record.baseTaskRevision &&
      this.regionRevision === record.baseRegionRevision &&
      this.dataRevision === record.baseDataRevision
    );
  }

  private prepareAuthorizationInput(
    record: StageRecord,
    token: RegionCommitToken,
    epoch: number,
    signal?: AbortSignal,
  ): RegionOutcome<Omit<RegionCommitAuthorizationInput, 'signal'>> {
    if (!this.live(epoch)) return this.closedOutcome();
    if (signal?.aborted)
      return failure('runtime.region-cancelled', 'The region commit was cancelled before publication.');
    if (!this.baseRevisionIsCurrent(record)) return failure('runtime.region-stale', FAILURE.stale);
    const authority = this.currentAuthority(epoch);
    if (!authority.ok) return authority as RegionOutcome<Omit<RegionCommitAuthorizationInput, 'signal'>>;
    if (!this.live(epoch)) return this.closedOutcome();
    const principalMatches =
      authority.value.principalKey === this.principalKey && authority.value.principalKey === record.principalKey;
    if (!principalMatches) return failure('runtime.region-stale', FAILURE.stale);
    if (!this.authorizationConfigured) return failure('runtime.region-denied', FAILURE.denied);
    return {
      ok: true,
      value: {
        regionId: this.id,
        token,
        state: record.state,
        current: this.snapshotValue(),
        authority: authority.value,
      },
    };
  }

  private commitAuthorityIsCurrent(record: StageRecord, authority: RegionAuthority): boolean {
    const actual = authorityReadSet(authority, this.taskRevision, this.regionRevision, this.dataRevision);
    return (
      authority.principalKey === this.principalKey &&
      authority.principalKey === record.principalKey &&
      record.capturedReadSet.dataRevision === actual.dataRevision &&
      validateCommitReadSet(stripData(record.capturedReadSet), stripData(actual), record.requiredResults).ok
    );
  }

  private validateCommitAuthority(record: StageRecord, epoch: number): RegionOutcome<RegionAuthority> {
    if (!this.live(epoch)) return this.closedOutcome();
    const authority = this.currentAuthority(epoch);
    if (!authority.ok) return authority;
    // readAuthority is host code and may synchronously revoke/dispose while returning.
    if (!this.live(epoch)) return this.closedOutcome();
    if (!this.commitAuthorityIsCurrent(record, authority.value)) return failure('runtime.region-stale', FAILURE.stale);
    const generations = this.handleGenerationsCurrent(record, authority.value, epoch);
    if (!generations.ok) return generations as RegionOutcome<RegionAuthority>;
    if (!this.live(epoch)) return this.closedOutcome();
    if (!this.baseRevisionIsCurrent(record)) return failure('runtime.region-stale', FAILURE.stale);
    return authority;
  }

  private prepareCommittedSnapshot(
    record: StageRecord,
    authority: RegionAuthority,
    epoch: number,
    signal?: AbortSignal,
  ): RegionOutcome<PreparedCommit> {
    const taskRevision = nextRevision(this.taskRevision);
    const regionRevision = nextRevision(this.regionRevision);
    const task = frozen({ ...record.state.task, revision: taskRevision });
    const presentation =
      record.state.presentation === undefined
        ? undefined
        : frozen({
            ...record.state.presentation,
            preconditions: frozen({
              ...record.state.presentation.preconditions,
              taskRevision,
              regionRevision,
            }),
          });
    const nextState = validateState(
      {
        task,
        ...(presentation === undefined ? {} : { presentation }),
        ...(record.state.interaction === undefined ? {} : { interaction: record.state.interaction }),
      },
      this.id,
    );
    if (!nextState.ok) return nextState as RegionOutcome<PreparedCommit>;
    // Obtain host clock metadata before changing state; injected clocks are callbacks too.
    const at = this.now();
    if (!this.live(epoch)) return this.closedOutcome();
    if (signal?.aborted)
      return failure('runtime.region-cancelled', 'The region commit was cancelled before publication.');
    const retainedResults = normalizeRefs(record.requiredResults, authority.scopeDigest);
    if (!retainedResults.ok) return retainedResults as RegionOutcome<PreparedCommit>;
    const readSet = frozen({
      ...authorityReadSet(authority, taskRevision, regionRevision, this.dataRevision),
      results: retainedResults.value,
    });
    const snapshot: RegionSnapshot = frozen({
      id: this.id,
      taskRevision,
      regionRevision,
      dataRevision: this.dataRevision,
      status: 'active',
      state: nextState.value,
      readSet,
    });
    return { ok: true, value: { taskRevision, regionRevision, state: nextState.value, readSet, snapshot, at } };
  }

  private runFinalCommitRecheck(
    recheck: RegionCommitOptions['recheck'],
    snapshot: RegionSnapshot,
    epoch: number,
    signal?: AbortSignal,
  ): RegionOutcome<void> {
    if (recheck === undefined) return { ok: true, value: undefined };
    try {
      const raw: unknown = recheck(snapshot);
      if (isPromiseLike(raw)) {
        void Promise.resolve(raw).catch(() => {});
        return failure('runtime.region-denied', 'The final commit recheck must return a synchronous outcome.');
      }
      const checked = normalizeHostOutcome<unknown>(raw);
      if (!checked.ok) return checked as RegionOutcome<void>;
      if (checked.value !== undefined)
        return failure('runtime.region-denied', 'The final commit recheck must return an empty success value.');
    } catch {
      return failure('runtime.region-denied', 'The final commit recheck failed.');
    }
    if (!this.live(epoch)) return this.closedOutcome();
    if (signal?.aborted)
      return failure('runtime.region-cancelled', 'The region commit was cancelled before publication.');
    return { ok: true, value: undefined };
  }

  private publishCommit(
    record: StageRecord,
    authority: RegionAuthority,
    prepared: PreparedCommit,
    epoch: number,
    markTransferred: () => void,
  ): RegionOutcome<RegionSnapshot> {
    this.taskRevision = prepared.taskRevision;
    this.principalKey = authority.principalKey;
    this.regionRevision = prepared.regionRevision;
    this.state = prepared.state;
    this.readSet = prepared.readSet;
    this.entries = [...this.entries, this.makeHistory('commit', undefined, record.requestId, undefined, prepared.at)];
    this.trimHistory();
    // Keep leases for committed references even when this commit adds no result handle.
    const transferLive = this.mergeResultLeases(record.resultLeases, record.requiredResults, epoch);
    markTransferred();
    if (!transferLive) return this.closedOutcome();
    const snapshot = this.snapshotValue();
    this.notify(frozen({ kind: 'commit', snapshot, requestId: record.requestId }));
    return { ok: true, value: snapshot };
  }

  private async executeCommit(
    record: StageRecord,
    token: RegionCommitToken,
    epoch: number,
    signal: AbortSignal | undefined,
    recheck: RegionCommitOptions['recheck'],
    markTransferred: () => void,
  ): Promise<RegionOutcome<RegionSnapshot>> {
    const authorizationInput = this.prepareAuthorizationInput(record, token, epoch, signal);
    if (!authorizationInput.ok) return authorizationInput as RegionOutcome<RegionSnapshot>;
    const authorized = await this.authorizeWithDeadline(authorizationInput.value, epoch, signal);
    if (!authorized.ok) return authorized as RegionOutcome<RegionSnapshot>;
    const authority = this.validateCommitAuthority(record, epoch);
    if (!authority.ok) return authority as RegionOutcome<RegionSnapshot>;
    const prepared = this.prepareCommittedSnapshot(record, authority.value, epoch, signal);
    if (!prepared.ok) return prepared as RegionOutcome<RegionSnapshot>;
    const checked = this.runFinalCommitRecheck(recheck, prepared.value.snapshot, epoch, signal);
    if (!checked.ok) return checked as RegionOutcome<RegionSnapshot>;
    // The final projection is host code and can synchronously change authority or results.
    const finalAuthority = this.validateCommitAuthority(record, epoch);
    if (!finalAuthority.ok) return finalAuthority as RegionOutcome<RegionSnapshot>;
    if (signal?.aborted)
      return failure('runtime.region-cancelled', 'The region commit was cancelled before publication.');
    return this.publishCommit(record, finalAuthority.value, prepared.value, epoch, markTransferred);
  }

  private async executeQueuedCommit(
    record: StageRecord,
    token: RegionCommitToken,
    epoch: number,
    signal: AbortSignal | undefined,
    recheck: RegionCommitOptions['recheck'],
  ): Promise<RegionOutcome<RegionSnapshot>> {
    let transferred = false;
    try {
      return await this.executeCommit(record, token, epoch, signal, recheck, () => (transferred = true));
    } finally {
      this.settleStageRecord(record, transferred);
    }
  }

  commit(token: RegionCommitToken, options: RegionCommitOptions = {}): Promise<RegionOutcome<RegionSnapshot>> {
    if (this.status !== 'active') return Promise.resolve(this.closedOutcome());
    const recordCheck = this.validateToken(token);
    if (!recordCheck.ok) return Promise.resolve(recordCheck);
    const record = recordCheck.value;
    const epoch = this.epoch;
    const signal = options.signal;
    const recheck = options.recheck;
    this.inFlight.add(record);
    const queued = this.enqueue(() => this.executeQueuedCommit(record, token, epoch, signal, recheck));
    return queued.then((result) => {
      // A closed/full queue can reject before this command gets a turn.
      if (this.inFlight.has(record)) this.settleStageRecord(record, false);
      return result;
    });
  }
}
