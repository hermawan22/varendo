import type { Diagnostic, Result } from '@varendo/core';
import type {
  ResultBatch,
  ResultEvent,
  ResultHandle,
  ResultSnapshot,
  ResultStatus,
  ResultSubscription,
} from './types.js';

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] };

export type ResultRow = ResultBatch['rows'][number];
export type ResultCell = ResultRow[string];

export interface CarryData {
  readonly descriptor: Result;
  readonly batches: readonly ResultBatch[];
  readonly loadedRows: number;
  readonly lastEvent?: ResultEvent;
  readonly bytes: number;
}

export interface MutableState {
  status: ResultStatus;
  descriptor: Result | undefined;
  batches: readonly ResultBatch[];
  loadedRows: number;
  diagnostics: readonly Diagnostic[];
  lastEvent: ResultEvent | undefined;
  nextSequence: number;
  seenIdentity: Set<string>;
  progress: Map<string, number>;
  terminal: boolean;
  bytes: number;
}

export interface InternalResultHandle extends ResultHandle {
  readonly pinned: boolean;
  readonly touchedAt: number;
  readonly retainedBytes: number;
  supersede(): void;
  revoke(): void;
}

export interface InternalStore {
  readonly handles: Set<InternalResultHandle>;
  readonly slots: Map<string, InternalResultHandle>;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly now: () => number;
  totalBytes(): number;
  remove(handle: InternalResultHandle): void;
}

export interface ManagedResultSubscription extends ResultSubscription {
  listenForAbort(): void;
  closeWithoutPull(): void;
  closeAsSuperseded(): void;
}

export interface ResultSubscriptionController {
  snapshot(): ResultSnapshot;
  subscriptionClosed(subscription: ManagedResultSubscription): void;
  isSuperseded(): boolean;
  isTerminal(): boolean;
  cancel(): void;
  truncated(): void;
  streamFailure(): void;
  ingest(raw: unknown): Promise<Outcome<ResultEvent>>;
}
