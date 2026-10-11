import type { ResultRef } from '@varendo/core';
import type { ResultHandle } from '../results/types.js';
import { createSerialQueue, type SerialQueue } from '../scheduling/index.js';
import type {
  AuthorizeRegionCommit,
  ReadAuthority,
  RegionAuthority,
  RegionCommitToken,
  RegionCreateInput,
  RegionHistoryEntry,
  RegionOutcome,
  RegionReadSet,
  RegionSnapshot,
  RegionUpdate,
  RegionContent,
} from './types.js';
import { FAILURE, authorityReadSet, digest, failure, frozen, logicalRefKey, refKey } from './region-contracts.js';
import { releaseLeases } from './result-handles.js';
import type { OwnedResultLease } from './result-handles.js';

export interface StageRecord {
  readonly token: RegionCommitToken;
  readonly state: RegionContent;
  readonly requestId: string;
  readonly capturedReadSet: RegionReadSet;
  readonly requiredResults: readonly ResultRef[];
  readonly resultHandles: readonly ResultHandle[];
  readonly resultLeases: readonly OwnedResultLease[];
  readonly handleGenerations: ReadonlyMap<string, number>;
  readonly baseTaskRevision: string;
  readonly baseRegionRevision: string;
  readonly baseDataRevision: number;
  readonly principalKey: string;
  readonly bytes: number;
  consumed: boolean;
}

function intersects(
  dependencies: readonly ResultRef[] | undefined,
  changed: readonly ResultRef[] | undefined,
): boolean {
  if (dependencies === undefined) return true;
  if (changed === undefined) return true;
  const changedKeys = new Set(changed.map(logicalRefKey));
  return dependencies.some((ref) => changedKeys.has(logicalRefKey(ref)));
}

export type ObserverRecord = {
  readonly listener: (update: RegionUpdate) => void;
  readonly results?: readonly ResultRef[];
  closed: boolean;
};

interface InitialRegionValues {
  readonly taskRevision: string;
  readonly principalKey: string;
  readonly regionRevision: string;
  readonly dataRevision: number;
  readonly state: RegionContent;
  readonly authority: RegionAuthority | undefined;
  readonly history: readonly RegionHistoryEntry[] | undefined;
}

function initialRegionValues(
  input: RegionCreateInput,
  seed:
    | {
        readonly taskRevision: string;
        readonly regionRevision: string;
        readonly dataRevision: number;
        readonly authority: RegionAuthority;
        readonly history: readonly RegionHistoryEntry[];
      }
    | undefined,
): InitialRegionValues {
  const authority = seed?.authority;
  return {
    taskRevision: seed?.taskRevision ?? input.state.task.revision,
    principalKey: authority?.principalKey ?? '',
    regionRevision: seed?.regionRevision ?? '1',
    dataRevision: seed?.dataRevision ?? 0,
    state: frozen(input.state),
    authority,
    history: seed?.history,
  };
}

function shouldStopNotifications(update: RegionUpdate, status: 'active' | 'revoked' | 'disposed'): boolean {
  return (update.kind === 'commit' || update.kind === 'data') && status !== 'active';
}

function shouldSkipObserver(
  observer: ObserverRecord,
  update: RegionUpdate,
  changedResults: readonly ResultRef[] | undefined,
): boolean {
  return observer.closed || (update.kind === 'data' && !intersects(observer.results, changedResults));
}

function deliverObserver(observer: ObserverRecord, update: RegionUpdate): void {
  try {
    const result = observer.listener(update);
    if (isPromiseLike(result)) void Promise.resolve(result).catch(() => {});
  } catch {
    /* observer exceptions never affect committed state */
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  if (value === undefined || value === null) return false;
  return typeof (value as PromiseLike<void>).then === 'function';
}

export class RegionHandleBase {
  readonly id: string;
  protected readonly queue: SerialQueue;
  protected readonly now: () => number;
  protected readonly readAuthority: ReadAuthority;
  protected readonly authorizeCommit: AuthorizeRegionCommit;
  protected readonly authorizationConfigured: boolean;
  protected readonly observers = new Set<ObserverRecord>();
  protected readonly staged = new Map<RegionCommitToken, StageRecord>();
  protected stagedBytes = 0;
  protected readonly maxHistory: number;
  protected readonly maxStagedCommits: number;
  protected readonly maxStagedBytes: number;
  protected readonly maxCommitAuthorizationMilliseconds: number;
  protected taskRevision: string;
  protected principalKey: string;
  protected regionRevision: string;
  protected dataRevision: number;
  protected status: 'active' | 'revoked' | 'disposed' = 'active';
  protected state: RegionContent | undefined;
  protected readSet: RegionReadSet | undefined;
  protected entries: RegionHistoryEntry[];
  protected epoch = 0;
  protected disposed = false;
  protected readonly inFlight = new Set<StageRecord>();
  protected readonly authorizationControllers = new Set<AbortController>();
  protected currentResultLeases: readonly OwnedResultLease[] = Object.freeze([]);

  constructor(
    protected readonly removeFromStore: (id: string) => void,
    input: RegionCreateInput,
    options: {
      readonly maxHistory: number;
      readonly maxQueuedCommands: number;
      readonly maxStagedCommits: number;
      readonly maxStagedBytes: number;
      readonly maxCommitAuthorizationMilliseconds: number;
      readonly now: () => number;
      readonly readAuthority: ReadAuthority;
      readonly authorizeCommit: AuthorizeRegionCommit;
      readonly authorizationConfigured: boolean;
    },
    seed?: {
      readonly taskRevision: string;
      readonly regionRevision: string;
      readonly dataRevision: number;
      readonly authority: RegionAuthority;
      readonly history: readonly RegionHistoryEntry[];
    },
  ) {
    const initial = initialRegionValues(input, seed);
    this.id = input.id;
    this.queue = createSerialQueue(options.maxQueuedCommands);
    this.maxHistory = input.maxHistory ?? options.maxHistory;
    this.maxStagedCommits = options.maxStagedCommits;
    this.maxStagedBytes = options.maxStagedBytes;
    this.maxCommitAuthorizationMilliseconds = options.maxCommitAuthorizationMilliseconds;
    this.now = options.now;
    this.readAuthority = options.readAuthority;
    this.authorizeCommit = options.authorizeCommit;
    this.authorizationConfigured = options.authorizationConfigured;
    this.taskRevision = initial.taskRevision;
    this.principalKey = initial.principalKey;
    this.regionRevision = initial.regionRevision;
    this.dataRevision = initial.dataRevision;
    this.state = initial.state;
    const authority = initial.authority;
    if (authority === undefined) throw new TypeError('A region requires a current host authority.');
    this.readSet = authorityReadSet(authority, this.taskRevision, this.regionRevision, this.dataRevision);
    this.entries = initial.history?.length ? [...initial.history] : [this.makeHistory('commit')];
    this.trimHistory();
  }

  protected makeHistory(
    kind: 'commit' | 'data' | 'revoke',
    changedResults?: readonly ResultRef[],
    requestId?: string,
    reason?: string,
    at = this.now(),
  ): RegionHistoryEntry {
    return frozen({
      kind,
      taskRevision: this.taskRevision,
      regionRevision: this.regionRevision,
      dataRevision: this.dataRevision,
      ...(this.state === undefined ? {} : { stateDigest: digest(this.state) }),
      ...(changedResults === undefined || changedResults.length === 0
        ? {}
        : { changedResults: frozen([...changedResults]) }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(reason === undefined ? {} : { reason }),
      at,
    });
  }

  protected trimHistory(): void {
    if (this.entries.length > this.maxHistory) this.entries = this.entries.slice(this.entries.length - this.maxHistory);
    this.entries = Object.freeze(this.entries.slice()) as unknown as RegionHistoryEntry[];
  }

  protected snapshotValue(): RegionSnapshot {
    return frozen({
      id: this.id,
      taskRevision: this.taskRevision,
      regionRevision: this.regionRevision,
      dataRevision: this.dataRevision,
      status: this.status,
      ...(this.state === undefined ? {} : { state: this.state }),
      ...(this.readSet === undefined ? {} : { readSet: this.readSet }),
    });
  }

  protected notify(
    update: RegionUpdate,
    changedResults?: readonly ResultRef[],
    observers: readonly ObserverRecord[] = [...this.observers],
  ): void {
    for (const observer of observers) {
      if (shouldStopNotifications(update, this.status)) return;
      if (shouldSkipObserver(observer, update, changedResults)) continue;
      deliverObserver(observer, update);
    }
  }

  protected closedOutcome<T>(): RegionOutcome<T> {
    if (this.disposed || this.status === 'disposed') return failure('runtime.region-disposed', FAILURE.disposed);
    if (this.status === 'revoked') return failure('runtime.region-revoked', FAILURE.revoked);
    return failure('runtime.region-invalid', FAILURE.invalid);
  }

  protected live(epoch: number): boolean {
    return epoch === this.epoch && this.status === 'active';
  }

  protected abortPendingAuthorizations(): void {
    for (const controller of [...this.authorizationControllers]) {
      try {
        controller.abort();
      } catch {
        /* AbortController implementations should not break revocation. */
      }
    }
  }

  protected transferResultLeases(next: readonly OwnedResultLease[], expectedEpoch = this.epoch): boolean {
    const byRef = new Map<string, OwnedResultLease>();
    const replaced: OwnedResultLease[] = [];
    for (const owned of next) {
      const key = refKey(owned.ref);
      const previous = byRef.get(key);
      if (previous !== undefined && previous !== owned) replaced.push(previous);
      byRef.set(key, owned);
    }
    const previous = this.currentResultLeases;
    this.currentResultLeases = Object.freeze([...byRef.values()]);
    releaseLeases([...previous, ...replaced]);
    return this.live(expectedEpoch);
  }

  protected mergeResultLeases(
    next: readonly OwnedResultLease[],
    authorized: readonly ResultRef[],
    expectedEpoch = this.epoch,
  ): boolean {
    if (!this.live(expectedEpoch)) return false;
    const authorizedKeys = new Set(authorized.map(refKey));
    const byRef = new Map<string, OwnedResultLease>();
    const replaced: OwnedResultLease[] = [];
    for (const owned of this.currentResultLeases) {
      const key = refKey(owned.ref);
      if (!authorizedKeys.has(key)) {
        replaced.push(owned);
        continue;
      }
      const previous = byRef.get(key);
      if (previous !== undefined && previous !== owned) replaced.push(previous);
      byRef.set(key, owned);
    }
    for (const owned of next) {
      const key = refKey(owned.ref);
      const previous = byRef.get(key);
      if (previous !== undefined && previous !== owned) replaced.push(previous);
      byRef.set(key, owned);
    }
    this.currentResultLeases = Object.freeze([...byRef.values()]);
    releaseLeases(replaced);
    return this.live(expectedEpoch);
  }

  adoptInitialResultLeases(leases: readonly OwnedResultLease[]): void {
    this.transferResultLeases(leases);
  }

  protected enqueue<T>(command: () => Promise<RegionOutcome<T>> | RegionOutcome<T>): Promise<RegionOutcome<T>> {
    return this.queue.enqueue(command).catch((error: unknown) => {
      if (this.status === 'revoked') return failure<T>('runtime.region-revoked', FAILURE.revoked);
      if (this.disposed || this.status === 'disposed') return failure<T>('runtime.region-disposed', FAILURE.disposed);
      if (error instanceof Error && error.message.includes('queue'))
        return failure<T>('runtime.region-queue', FAILURE.queue);
      return failure<T>('runtime.region-invalid', error instanceof Error ? error.message : FAILURE.invalid);
    });
  }

  snapshot(): RegionSnapshot {
    return this.snapshotValue();
  }

  discard(token: RegionCommitToken): boolean {
    if (this.status !== 'active' || token === null || typeof token !== 'object') return false;
    const record = this.staged.get(token);
    if (record === undefined || record.consumed) return false;
    record.consumed = true;
    this.staged.delete(token);
    this.stagedBytes = Math.max(0, this.stagedBytes - record.bytes);
    releaseLeases(record.resultLeases);
    return true;
  }
}
