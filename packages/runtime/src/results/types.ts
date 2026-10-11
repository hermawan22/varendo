import type { Contract, Diagnostic, Result } from '@varendo/core';

export type ResultEvent = Contract<'result-event'>;

export type ResultBatch = Extract<ResultEvent, { readonly kind: 'batch' }>;

export type ResultStatus =
  | 'loading'
  | 'refreshing'
  | 'partial'
  | 'ready'
  | 'stale'
  | 'denied'
  | 'unsupported'
  | 'failed'
  | 'cancelled'
  | 'disposed';

/**
 * Host-owned cache partition and all semantic pins needed to reuse a result.
 * `principalKey` is an opaque application key; it is never put on the wire.
 */
export interface ResultCacheKey {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly populationDigest?: string;
  readonly queryDigest: string;
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly sourceRevision: string;
  /** Stable source identity from the accepted plan, distinct from a revision. */
  readonly sourceLineage?: string;
  /** The accepted plan that authorizes the result shape, when available. */
  readonly planDigest?: string;
  /** Trusted expected output shape; scalar aggregate exceptions require this pin. */
  readonly resultShape?: 'rows' | 'global-aggregate';
  /** Canonical digest of the accepted result-input lineage. */
  readonly lineageDigest?: string;
  readonly outputId: string;
  readonly taskId: string;
}

/** Public semantic pins; the host cache partition is intentionally omitted. */
export type ResultPins = Omit<ResultCacheKey, 'principalKey'>;

export interface ResultBeginInput extends ResultCacheKey {
  readonly requestId: string;
}

export interface ResultStoreOptions {
  /** Maximum number of cached generations retained by this store. */
  readonly maxEntries?: number;
  /** Maximum encoded bytes retained across descriptors and batches. */
  readonly maxBytes?: number;
  /** Maximum idle age for retained handles. */
  readonly ttlMs?: number;
  /** Injected wall clock used only for bounded cache expiry. */
  readonly now?: () => number;
}

export interface ResultSnapshot {
  readonly status: ResultStatus;
  readonly generation: number;
  readonly key: ResultPins;
  readonly descriptor?: Result;
  readonly batches: readonly ResultBatch[];
  readonly loadedRows: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly lastEvent?: ResultEvent;
}

export type ResultUpdate =
  { readonly snapshot: ResultSnapshot; readonly event: ResultEvent } | { readonly snapshot: ResultSnapshot };

export interface ResultSubscription extends AsyncIterableIterator<ResultUpdate> {
  /** Requests cancellation without waiting for an uncooperative source. */
  cancel(): void;
}

export interface ResultLease {
  readonly released: boolean;
  release(): void;
}

export interface ResultHandle {
  readonly key: ResultCacheKey;
  readonly generation: number;
  snapshot(): ResultSnapshot;
  subscribe(
    source: AsyncIterable<unknown> | AsyncIterator<unknown>,
    options?: { readonly signal?: AbortSignal },
  ): ResultSubscription;
  retain(): ResultLease;
  release(): void;
  dispose(): void;
}

export interface ResultRevokeRequest {
  readonly principalKey: string;
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
}

export interface ResultStore {
  begin(input: ResultBeginInput): ResultHandle;
  get(input: ResultCacheKey): ResultHandle | undefined;
  revoke(request: ResultRevokeRequest): void;
  dispose(): void;
}

export type ResultDescriptor = Contract<'result'>;
