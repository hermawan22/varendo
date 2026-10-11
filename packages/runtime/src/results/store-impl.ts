import { WIRE_LIMITS } from '@varendo/core';
import type { CarryData, InternalResultHandle, InternalStore } from './internal-types.js';
import { ResultHandleController } from './handle-controller.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS } from './store-defaults.js';
import { byteLength, slotKey, validateBeginInput } from './store-utils.js';
import type {
  ResultBeginInput,
  ResultCacheKey,
  ResultHandle,
  ResultRevokeRequest,
  ResultStore,
  ResultStoreOptions,
} from './types.js';

interface StoreConfiguration {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly now: () => number;
}

function validateEntryLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000)
    throw new TypeError('maxEntries must be a bounded positive safe integer.');
}

function validateByteLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > WIRE_LIMITS.bytes)
    throw new TypeError('maxBytes must be a bounded positive safe integer.');
}

function validateTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000)
    throw new TypeError('ttlMs must be a bounded positive duration.');
}

function resolveConfiguration(options: ResultStoreOptions): StoreConfiguration {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  validateEntryLimit(maxEntries);
  validateByteLimit(maxBytes);
  validateTtl(ttlMs);
  return { maxEntries, maxBytes, ttlMs, now: options.now ?? (() => Date.now()) };
}

export class ResultStoreImpl implements ResultStore, InternalStore {
  readonly handles = new Set<InternalResultHandle>();
  readonly slots = new Map<string, InternalResultHandle>();
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly now: () => number;
  private disposed = false;
  private generation = 0;

  constructor(options: ResultStoreOptions = {}) {
    const configuration = resolveConfiguration(options);
    this.maxEntries = configuration.maxEntries;
    this.maxBytes = configuration.maxBytes;
    this.ttlMs = configuration.ttlMs;
    this.now = configuration.now;
  }

  totalBytes(): number {
    let total = 0;
    for (const handle of this.handles) total += handle.retainedBytes;
    return total;
  }

  remove(handle: InternalResultHandle): void {
    this.handles.delete(handle);
    const key = slotKey(handle.key);
    if (this.slots.get(key) === handle) this.slots.delete(key);
  }

  private expire(): void {
    const now = this.now();
    for (const handle of [...this.handles]) {
      if (!handle.pinned && now - handle.touchedAt >= this.ttlMs) handle.dispose();
    }
  }

  private evict(): void {
    this.expire();
    while (this.handles.size >= this.maxEntries) {
      const candidate = [...this.handles]
        .filter((handle) => !handle.pinned)
        .sort((left, right) => left.touchedAt - right.touchedAt)[0];
      if (candidate === undefined)
        throw new RangeError('The result store is at capacity with live owners, leases or subscriptions.');
      candidate.dispose();
    }
  }

  begin(input: ResultBeginInput): ResultHandle {
    if (this.disposed) throw new Error('The result store has been disposed.');
    validateBeginInput(input);
    this.expire();
    const key = slotKey(input);
    const previous = this.slots.get(key);
    const carrySnapshot = previous === undefined ? undefined : previous.snapshot();
    const carry: CarryData | undefined =
      carrySnapshot?.descriptor === undefined
        ? undefined
        : {
            descriptor: carrySnapshot.descriptor,
            batches: carrySnapshot.batches,
            loadedRows: carrySnapshot.loadedRows,
            ...(carrySnapshot.lastEvent === undefined ? {} : { lastEvent: carrySnapshot.lastEvent }),
            bytes:
              byteLength(carrySnapshot.descriptor) +
              carrySnapshot.batches.reduce((sum, batch) => sum + byteLength(batch), 0),
          };
    this.evict();
    if (this.totalBytes() + (carry?.bytes ?? 0) > this.maxBytes)
      throw new RangeError('The result refresh exceeds the bounded store byte budget.');
    const handle = new ResultHandleController(this, input, ++this.generation, carry);
    this.handles.add(handle);
    this.slots.set(key, handle);
    previous?.supersede();
    return handle;
  }

  get(input: ResultCacheKey): ResultHandle | undefined {
    if (this.disposed) return undefined;
    validateBeginInput({ ...input, requestId: 'lookup' });
    this.expire();
    const handle = this.slots.get(slotKey(input));
    return handle === undefined ? undefined : handle;
  }

  revoke(request: ResultRevokeRequest): void {
    if (this.disposed) return;
    if (typeof request.principalKey !== 'string' || request.principalKey.length === 0)
      throw new TypeError('principalKey is required for result revocation.');
    for (const handle of [...this.handles]) {
      if (handle.key.principalKey !== request.principalKey) continue;
      if (request.scopeDigest !== undefined && handle.key.scopeDigest !== request.scopeDigest) continue;
      if (request.policyRevision !== undefined && handle.key.policyRevision !== request.policyRevision) continue;
      handle.revoke();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of [...this.handles]) handle.dispose();
    this.handles.clear();
    this.slots.clear();
  }
}
