import type { CommitPreconditions, Diagnostic, ResultRef } from '@varendo/core';
import type { ResultHandle } from '../results/types.js';
import type { PresentationPlan, RegionContent, RegionStatus } from '../tasks/types.js';

/** The semantic pins in a proposal, plus the runtime materialization revision. */
export interface RegionReadSet extends CommitPreconditions {
  readonly dataRevision: number;
}

/** Host-owned current authorization/materialization pins. */
export interface RegionAuthority {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly catalogRevision: string;
  readonly experienceRevision: string;
  readonly functionRegistryDigest: string;
  readonly results: readonly ResultRef[];
}

export type ReadAuthority = (regionId: string) => RegionOutcome<RegionAuthority>;

export interface RegionCreateInput {
  readonly id: string;
  readonly state: RegionContent;
  readonly maxHistory?: number;
}

export interface RegionStageInput {
  readonly requestId: string;
  readonly expected: RegionReadSet;
  readonly state: RegionContent;
  readonly resultHandles?: readonly ResultHandle[];
}

/** Opaque: only the RegionHandle that staged this token can commit it. */
export interface RegionCommitToken {
  readonly __varendoRegionCommitToken: unique symbol;
}

export interface RegionDataPublication {
  readonly resultHandles?: readonly ResultHandle[];
  readonly results?: readonly ResultRef[];
  readonly reason?: string;
}

/** Fresh task/materialization supplied by the host while restoring metadata. */
export interface RegionRestoreMaterialization {
  readonly state: RegionContent;
  readonly resultHandles?: readonly ResultHandle[];
}

export interface RegionRestoreInput {
  readonly regionId: string;
  readonly document: import('../persistence/types.js').RegionDocument;
  readonly authority: RegionAuthority;
  readonly signal: AbortSignal;
}

export type RestoreRegion = (
  input: RegionRestoreInput,
) => RegionOutcome<RegionRestoreMaterialization> | Promise<RegionOutcome<RegionRestoreMaterialization>>;

export type RegionFailureCode =
  | 'runtime.region-invalid'
  | 'runtime.region-stale'
  | 'runtime.region-denied'
  | 'runtime.region-cancelled'
  | 'runtime.region-revoked'
  | 'runtime.region-disposed'
  | 'runtime.region-budget'
  | 'runtime.region-queue';

export interface RegionFailure extends Diagnostic {
  readonly code: RegionFailureCode | string;
}

export type RegionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly [RegionFailure, ...RegionFailure[]] };

export interface RegionSnapshot {
  readonly id: string;
  readonly taskRevision: string;
  readonly regionRevision: string;
  readonly dataRevision: number;
  readonly status: RegionStatus;
  readonly state?: RegionContent;
  readonly readSet?: RegionReadSet;
}

export type RegionUpdateKind = 'commit' | 'data' | 'revoke' | 'dispose';

export interface RegionUpdate {
  readonly kind: RegionUpdateKind;
  readonly snapshot: RegionSnapshot;
  readonly changedResults?: readonly ResultRef[];
  readonly requestId?: string;
  readonly reason?: string;
}

/** Bounded lifecycle metadata; it never captures region plans or rows. */
export interface RegionHistoryEntry {
  readonly kind: Exclude<RegionUpdateKind, 'dispose'>;
  readonly taskRevision: string;
  readonly regionRevision: string;
  readonly dataRevision: number;
  readonly stateDigest?: string;
  readonly changedResults?: readonly ResultRef[];
  readonly requestId?: string;
  readonly reason?: string;
  readonly at: number;
}

export interface RegionObserverOptions {
  readonly results?: readonly (ResultRef | ResultHandle)[];
}

export interface RegionObserver {
  readonly closed: boolean;
  unsubscribe(): void;
}

export type RegionObserverFunction = ((update: RegionUpdate) => void) & RegionObserver;

export interface RegionCommitAuthorizationInput {
  readonly regionId: string;
  readonly token: RegionCommitToken;
  readonly state: RegionContent;
  readonly current: RegionSnapshot;
  readonly authority: RegionAuthority;
  /** Host callbacks must stop work when the bounded authorization window closes. */
  readonly signal: AbortSignal;
}

export type AuthorizeRegionCommit = (
  input: RegionCommitAuthorizationInput,
) => RegionOutcome<void> | Promise<RegionOutcome<void>>;

export interface RegionStoreOptions {
  readonly readAuthority: ReadAuthority;
  readonly authorizeCommit: AuthorizeRegionCommit;
  /** Requeries and validates persisted task metadata before a region is exposed. */
  readonly restoreRegion?: RestoreRegion;
  /** Maximum time spent awaiting one host commit authorization callback. */
  readonly maxCommitAuthorizationMilliseconds?: number;
  /** Maximum time spent awaiting one host restore/requery callback. */
  readonly maxRestoreMilliseconds?: number;
  readonly maxRegions?: number;
  readonly maxHistory?: number;
  readonly maxQueuedCommands?: number;
  readonly maxStagedCommits?: number;
  readonly maxStagedBytes?: number;
  readonly now?: () => number;
}

export interface RegionCommitOptions {
  /** Cancels before the atomic state swap; cancellation after commit cannot undo it. */
  readonly signal?: AbortSignal;
  /** Additional trusted synchronous precondition, checked after host authorization and the clock. */
  /** Receives the exact prospective snapshot after host authorization and before publication. */
  readonly recheck?: (next?: RegionSnapshot) => RegionOutcome<void>;
}

export interface RegionHandle {
  readonly id: string;
  snapshot(): RegionSnapshot;
  stage(input: RegionStageInput): Promise<RegionOutcome<RegionCommitToken>>;
  discard(token: RegionCommitToken): boolean;
  commit(token: RegionCommitToken, options?: RegionCommitOptions): Promise<RegionOutcome<RegionSnapshot>>;
  publishData(publication?: RegionDataPublication): Promise<RegionOutcome<RegionSnapshot>>;
  observe(listener: (update: RegionUpdate) => void, options?: RegionObserverOptions): RegionObserverFunction;
  history(): readonly RegionHistoryEntry[];
  export(): import('../persistence/types.js').RegionDocument;
  revoke(reason?: string): boolean;
  dispose(): void;
}

export interface RegionStore {
  create(input: RegionCreateInput): RegionOutcome<RegionHandle>;
  restore(document: unknown): Promise<RegionOutcome<RegionHandle>>;
  get(id: string): RegionHandle | undefined;
  revoke(id: string, reason?: string): boolean;
  dispose(): void;
}

export type { PresentationPlan, RegionContent, RegionStatus };
