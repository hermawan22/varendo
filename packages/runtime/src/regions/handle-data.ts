import { WIRE_LIMITS } from '@varendo/core';
import type { ResultRef } from '@varendo/core';
import type { ResultHandle } from '../results/types.js';
import { exportRegionDocument } from '../persistence/index.js';
import type { RegionDocument } from '../persistence/types.js';
import type {
  RegionDataPublication,
  RegionAuthority,
  RegionHistoryEntry,
  RegionObserverFunction,
  RegionObserverOptions,
  RegionOutcome,
  RegionReadSet,
  RegionSnapshot,
  RegionUpdate,
} from './types.js';
import {
  FAILURE,
  authorityReadSet,
  failure,
  frozen,
  logicalRefKey,
  normalizeRefs,
  refKey,
  validText,
  validateResultRef,
} from './region-contracts.js';
import {
  bindResultHandleToAuthority,
  releaseLeases,
  resultRefFromHandle,
  retainResultHandle,
} from './result-handles.js';
import type { OwnedResultLease } from './result-handles.js';
import { RegionCommitHandle } from './handle-commit.js';
import type { ObserverRecord } from './handle-base.js';

interface ParsedPublication {
  readonly explicit: boolean;
  readonly refs: readonly ResultRef[];
  readonly handles?: readonly ResultHandle[];
  readonly reason?: string;
}

interface PublicationMetadata {
  readonly explicit: boolean;
  readonly handles?: readonly ResultHandle[];
  readonly results?: readonly ResultRef[];
  readonly reason?: string;
}

interface PublicationAuthority {
  readonly authority: RegionAuthority;
  readonly scopeDigest: string;
  readonly currentPins: RegionReadSet;
}

interface PreparedPublicationUpdate {
  readonly authority: RegionAuthority;
  readonly explicit: boolean;
  readonly changed: readonly ResultRef[];
  readonly reason?: string;
  readonly noOp: boolean;
}

function observerResultRef(candidate: unknown): RegionOutcome<ResultRef> {
  const possibleHandle = candidate as ResultHandle | null;
  if (typeof possibleHandle?.snapshot === 'function') return resultRefFromHandle(possibleHandle);
  if (validateResultRef(candidate)) return { ok: true, value: candidate };
  return failure('runtime.region-invalid', FAILURE.invalid);
}

function closedObserver(): RegionObserverFunction {
  const closed = (() => {}) as unknown as RegionObserverFunction;
  Object.defineProperties(closed, {
    closed: { value: true, enumerable: true },
    unsubscribe: { value: closed, enumerable: true },
  });
  return closed;
}

function observerChangeFilter(explicit: boolean, changed: readonly ResultRef[]): readonly ResultRef[] | undefined {
  if (!explicit && changed.length === 0) return undefined;
  return changed;
}

function publicationIsExplicit(publication: RegionDataPublication | undefined): boolean {
  return publication?.resultHandles !== undefined || publication?.results !== undefined;
}

function publicationHasUnknownFields(publication: RegionDataPublication): boolean {
  const allowed = ['resultHandles', 'results', 'reason'];
  return Object.keys(publication).some((key) => !allowed.includes(key));
}

function validatePublicationShape(publication: RegionDataPublication | undefined): RegionOutcome<void> {
  if (publication !== undefined && publicationHasUnknownFields(publication))
    return failure('runtime.region-invalid', FAILURE.invalid);
  if (publication?.reason !== undefined && !validText(publication.reason))
    return failure('runtime.region-invalid', 'The publication reason is not bounded.');
  if (publication?.resultHandles !== undefined && publication.results !== undefined)
    return failure('runtime.region-invalid', 'Publish either ResultHandles or canonical references, not both.');
  return { ok: true, value: undefined };
}

function toPublicationMetadata(publication: RegionDataPublication | undefined): PublicationMetadata {
  return {
    explicit: publicationIsExplicit(publication),
    ...(publication?.resultHandles === undefined ? {} : { handles: publication.resultHandles }),
    ...(publication?.results === undefined ? {} : { results: publication.results }),
    ...(publication?.reason === undefined ? {} : { reason: publication.reason }),
  };
}

export class RegionDataHandle extends RegionCommitHandle {
  private publicationMetadata(publication: RegionDataPublication | undefined): RegionOutcome<PublicationMetadata> {
    const shape = validatePublicationShape(publication);
    if (!shape.ok) return shape as RegionOutcome<PublicationMetadata>;
    return { ok: true, value: toPublicationMetadata(publication) };
  }

  private retainPublicationHandle(
    handle: ResultHandle,
    epoch: number,
    leases: OwnedResultLease[],
  ): RegionOutcome<ResultRef> {
    const ref = resultRefFromHandle(handle);
    if (!ref.ok) return ref;
    if (!this.live(epoch)) return this.closedOutcome();
    const lease = retainResultHandle(handle);
    if (!lease.ok) return lease as RegionOutcome<ResultRef>;
    leases.push({ ref: ref.value, lease: lease.value });
    if (!this.live(epoch)) return this.closedOutcome();
    return ref;
  }

  private collectPublicationRefs(
    metadata: PublicationMetadata,
    epoch: number,
    leases: OwnedResultLease[],
  ): RegionOutcome<readonly ResultRef[]> {
    const refs: ResultRef[] = [];
    if (metadata.handles !== undefined) {
      if (!Array.isArray(metadata.handles) || metadata.handles.length > WIRE_LIMITS.array)
        return failure('runtime.region-budget', FAILURE.budget);
      for (const handle of metadata.handles) {
        const ref = this.retainPublicationHandle(handle, epoch, leases);
        if (!ref.ok) return ref;
        refs.push(ref.value);
      }
      return { ok: true, value: refs };
    }
    if (metadata.results === undefined) return { ok: true, value: refs };
    if (!Array.isArray(metadata.results)) return failure('runtime.region-invalid', FAILURE.invalid);
    refs.push(...metadata.results);
    return { ok: true, value: refs };
  }

  private parsePublication(
    publication: RegionDataPublication | undefined,
    epoch: number,
    leases: OwnedResultLease[],
  ): RegionOutcome<ParsedPublication> {
    if (!this.live(epoch)) return this.closedOutcome();
    const metadata = this.publicationMetadata(publication);
    if (!metadata.ok) return metadata as RegionOutcome<ParsedPublication>;
    const collected = this.collectPublicationRefs(metadata.value, epoch, leases);
    if (!collected.ok) return collected as RegionOutcome<ParsedPublication>;
    return {
      ok: true,
      value: {
        ...metadata.value,
        refs: collected.value,
      },
    };
  }

  private preparePublicationAuthority(
    publication: ParsedPublication,
    epoch: number,
  ): RegionOutcome<PublicationAuthority> {
    const scopeDigest = this.readSet?.scopeDigest;
    if (scopeDigest === undefined) return this.closedOutcome();
    const authority = this.currentAuthority(epoch);
    if (!authority.ok) return authority as RegionOutcome<PublicationAuthority>;
    if (!this.live(epoch)) return this.closedOutcome();
    if (authority.value.principalKey !== this.principalKey) return failure('runtime.region-stale', FAILURE.stale);
    for (const handle of publication.handles ?? []) {
      const binding = bindResultHandleToAuthority(handle, authority.value);
      if (!binding.ok) return binding as RegionOutcome<PublicationAuthority>;
      if (!this.live(epoch)) return this.closedOutcome();
    }
    const currentPins = this.readSet;
    if (!this.pinsMatchAuthority(currentPins, authority.value)) return failure('runtime.region-stale', FAILURE.stale);
    return { ok: true, value: { authority: authority.value, scopeDigest, currentPins } };
  }

  private pinsMatchAuthority(pins: RegionReadSet | undefined, authority: RegionAuthority): pins is RegionReadSet {
    return (
      pins !== undefined &&
      authority.scopeDigest === pins.scopeDigest &&
      authority.policyRevision === pins.policyRevision &&
      authority.catalogRevision === pins.catalogRevision &&
      authority.experienceRevision === pins.experienceRevision &&
      authority.functionRegistryDigest === pins.functionRegistryDigest
    );
  }

  private explicitPublicationIsNoop(
    explicit: boolean,
    refs: readonly ResultRef[],
    authority: RegionAuthority,
    pins: RegionReadSet,
  ): RegionOutcome<boolean> {
    if (!explicit || refs.length !== 0) return { ok: true, value: false };
    if (authority.results.length !== pins.results.length) return failure('runtime.region-stale', FAILURE.stale);
    for (let index = 0; index < authority.results.length; index++) {
      if (refKey(authority.results[index]!) !== refKey(pins.results[index]!))
        return failure('runtime.region-stale', FAILURE.stale);
    }
    return { ok: true, value: true };
  }

  private changedPublicationResults(
    refs: readonly ResultRef[],
    authority: RegionAuthority,
    pins: RegionReadSet,
  ): RegionOutcome<readonly ResultRef[]> {
    if (this.dataRevision >= Number.MAX_SAFE_INTEGER) return failure('runtime.region-budget', FAILURE.budget);
    const currentRefKeys = new Set(pins.results.map(refKey));
    const authorityRefKeys = new Set(authority.results.map(refKey));
    for (const ref of refs) {
      if (!authorityRefKeys.has(refKey(ref))) return failure('runtime.region-stale', FAILURE.stale);
    }
    const changedByLogical = new Map<string, { readonly ref: ResultRef; readonly priority: number }>();
    for (const ref of refs) changedByLogical.set(logicalRefKey(ref), { ref, priority: 1 });
    for (const ref of authority.results) {
      if (!currentRefKeys.has(refKey(ref))) changedByLogical.set(logicalRefKey(ref), { ref, priority: 2 });
    }
    for (const ref of pins.results) {
      if (!authorityRefKeys.has(refKey(ref)) && !changedByLogical.has(logicalRefKey(ref)))
        changedByLogical.set(logicalRefKey(ref), { ref, priority: 0 });
    }
    const changed = [...changedByLogical.values()]
      .sort((left, right) => right.priority - left.priority)
      .map((entry) => entry.ref);
    if (changed.length > WIRE_LIMITS.array) return failure('runtime.region-budget', FAILURE.budget);
    return { ok: true, value: changed };
  }

  private applyPublication(
    authority: RegionAuthority,
    changed: readonly ResultRef[],
    reason: string | undefined,
    epoch: number,
    leases: readonly OwnedResultLease[],
  ): RegionOutcome<boolean> {
    // Read host clock metadata before changing the materialized revision.
    const at = this.now();
    if (!this.live(epoch)) return this.closedOutcome();
    this.dataRevision += 1;
    this.readSet = authorityReadSet(authority, this.taskRevision, this.regionRevision, this.dataRevision);
    this.entries = [...this.entries, this.makeHistory('data', changed, undefined, reason, at)];
    this.trimHistory();
    // Reconcile against fresh authority to release revoked or retired refs.
    const transferLive = this.mergeResultLeases(leases, authority.results, epoch);
    return { ok: true, value: transferLive };
  }

  private preparePublicationUpdate(
    publication: ParsedPublication,
    epoch: number,
  ): RegionOutcome<PreparedPublicationUpdate> {
    const authorized = this.preparePublicationAuthority(publication, epoch);
    if (!authorized.ok) return authorized as RegionOutcome<PreparedPublicationUpdate>;
    const normalized = normalizeRefs(publication.refs, authorized.value.scopeDigest);
    if (!normalized.ok) return normalized as RegionOutcome<PreparedPublicationUpdate>;
    const noOp = this.explicitPublicationIsNoop(
      publication.explicit,
      normalized.value,
      authorized.value.authority,
      authorized.value.currentPins,
    );
    if (!noOp.ok) return noOp as RegionOutcome<PreparedPublicationUpdate>;
    if (noOp.value)
      return {
        ok: true,
        value: { authority: authorized.value.authority, explicit: publication.explicit, changed: [], noOp: true },
      };
    const changed = this.changedPublicationResults(
      normalized.value,
      authorized.value.authority,
      authorized.value.currentPins,
    );
    if (!changed.ok) return changed as RegionOutcome<PreparedPublicationUpdate>;
    return {
      ok: true,
      value: {
        authority: authorized.value.authority,
        explicit: publication.explicit,
        changed: changed.value,
        ...(publication.reason === undefined ? {} : { reason: publication.reason }),
        noOp: false,
      },
    };
  }

  private completePublication(prepared: PreparedPublicationUpdate, epoch: number): RegionOutcome<RegionSnapshot> {
    if (!this.live(epoch)) return this.closedOutcome();
    const snapshot = this.snapshotValue();
    const update: RegionUpdate = frozen({
      kind: 'data',
      snapshot,
      ...(prepared.changed.length === 0 ? {} : { changedResults: prepared.changed }),
      ...(prepared.reason === undefined ? {} : { reason: prepared.reason }),
    });
    this.notify(update, observerChangeFilter(prepared.explicit, prepared.changed));
    return { ok: true, value: snapshot };
  }

  private publishQueuedData(
    publication: RegionDataPublication | undefined,
    epoch: number,
  ): RegionOutcome<RegionSnapshot> {
    const leases: OwnedResultLease[] = [];
    let transferred = false;
    try {
      if (!this.live(epoch)) return this.closedOutcome();
      const parsed = this.parsePublication(publication, epoch, leases);
      if (!parsed.ok) return parsed as RegionOutcome<RegionSnapshot>;
      const prepared = this.preparePublicationUpdate(parsed.value, epoch);
      if (!prepared.ok) return prepared as RegionOutcome<RegionSnapshot>;
      if (prepared.value.noOp) return { ok: true, value: this.snapshotValue() };
      const applied = this.applyPublication(
        prepared.value.authority,
        prepared.value.changed,
        prepared.value.reason,
        epoch,
        leases,
      );
      if (!applied.ok) return applied as RegionOutcome<RegionSnapshot>;
      transferred = true;
      if (!applied.value) return this.closedOutcome();
      return this.completePublication(prepared.value, epoch);
    } finally {
      if (!transferred) releaseLeases(leases);
    }
  }

  publishData(publication?: RegionDataPublication): Promise<RegionOutcome<RegionSnapshot>> {
    const epoch = this.epoch;
    return this.enqueue(() => this.publishQueuedData(publication, epoch));
  }

  private normalizeObserverDependencies(
    options: RegionObserverOptions,
    epoch: number,
  ): readonly ResultRef[] | undefined | null {
    if (options.results === undefined) return undefined;
    if (!Array.isArray(options.results)) throw new TypeError('Observer result dependencies must be an array.');
    const refs: ResultRef[] = [];
    for (const candidate of options.results) {
      const ref = observerResultRef(candidate);
      if (!ref.ok) throw new TypeError(ref.diagnostics[0]!.message);
      if (!this.live(epoch)) return null;
      if (ref.value.scopeDigest !== this.readSet?.scopeDigest)
        throw new TypeError('Observer dependencies must belong to the region authorization scope.');
      refs.push(ref.value);
    }
    return Object.freeze(refs);
  }

  private registerObserver(
    listener: (update: RegionUpdate) => void,
    dependencies: readonly ResultRef[] | undefined,
  ): RegionObserverFunction {
    const record: ObserverRecord = {
      listener,
      ...(dependencies === undefined ? {} : { results: dependencies }),
      closed: false,
    };
    this.observers.add(record);
    const unsubscribe = (() => {
      if (record.closed) return;
      record.closed = true;
      this.observers.delete(record);
    }) as unknown as RegionObserverFunction;
    Object.defineProperties(unsubscribe, {
      closed: { get: () => record.closed, enumerable: true },
      unsubscribe: { value: unsubscribe, enumerable: true },
    });
    return unsubscribe;
  }

  observe(listener: (update: RegionUpdate) => void, options: RegionObserverOptions = {}): RegionObserverFunction {
    if (typeof listener !== 'function') throw new TypeError('A region observer must be a function.');
    if (this.status !== 'active') return closedObserver();
    const observedEpoch = this.epoch;
    const dependencies = this.normalizeObserverDependencies(options, observedEpoch);
    if (dependencies === null || !this.live(observedEpoch)) return closedObserver();
    return this.registerObserver(listener, dependencies);
  }

  history(): readonly RegionHistoryEntry[] {
    return this.entries;
  }
  export(): RegionDocument {
    return exportRegionDocument(this.snapshotValue(), this.entries);
  }

  revoke(reason?: string): boolean {
    if (this.status !== 'active') return false;
    if (reason !== undefined && !validText(reason)) throw new TypeError('The revocation reason is not bounded.');
    this.epoch++;
    this.status = 'revoked';
    this.abortPendingAuthorizations();
    this.state = undefined;
    this.readSet = undefined;
    for (const record of this.staged.values()) record.consumed = true;
    for (const record of this.inFlight) record.consumed = true;
    for (const record of this.staged.values()) releaseLeases(record.resultLeases);
    for (const record of this.inFlight) releaseLeases(record.resultLeases);
    this.staged.clear();
    this.inFlight.clear();
    this.stagedBytes = 0;
    releaseLeases(this.currentResultLeases);
    this.currentResultLeases = Object.freeze([]);
    this.entries = Object.freeze([]) as unknown as RegionHistoryEntry[];
    const observers = [...this.observers];
    this.observers.clear();
    this.notify(
      frozen({ kind: 'revoke', snapshot: this.snapshotValue(), ...(reason === undefined ? {} : { reason }) }),
      undefined,
      observers,
    );
    for (const observer of observers) observer.closed = true;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.epoch++;
    this.disposed = true;
    this.status = 'disposed';
    this.abortPendingAuthorizations();
    this.state = undefined;
    this.readSet = undefined;
    for (const record of this.staged.values()) record.consumed = true;
    for (const record of this.inFlight) record.consumed = true;
    for (const record of this.staged.values()) releaseLeases(record.resultLeases);
    for (const record of this.inFlight) releaseLeases(record.resultLeases);
    this.staged.clear();
    this.inFlight.clear();
    this.stagedBytes = 0;
    releaseLeases(this.currentResultLeases);
    this.currentResultLeases = Object.freeze([]);
    this.entries = Object.freeze([]) as unknown as RegionHistoryEntry[];
    this.queue.close();
    const observers = [...this.observers];
    this.observers.clear();
    this.notify(frozen({ kind: 'dispose', snapshot: this.snapshotValue() }), undefined, observers);
    for (const observer of observers) observer.closed = true;
    this.removeFromStore(this.id);
  }
}
