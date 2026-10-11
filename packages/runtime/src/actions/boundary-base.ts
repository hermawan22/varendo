import { WIRE_LIMITS } from '@varendo/core';
import type { Outcome } from '@varendo/core';
import type {
  ActionBoundaryOptions,
  ActionEntity,
  ActionHistoryEntry,
  ActionOutcome,
  ActionPayload,
  ActionRegistration,
  TrustedActionContext,
} from './types.js';
import {
  bounded,
  bytes,
  canonical,
  context,
  failure,
  frozen,
  normalizeOutcome,
  payload,
  DEFAULTS,
  MAX_CALLBACK_MS,
} from './boundary-common.js';
import type {
  ActionPartition,
  ActiveCall,
  HistoryRecord,
  HostCall,
  LedgerRecord,
  PreviewRecord,
  ReceiptRecord,
} from './boundary-common.js';

interface ActionLimits {
  readonly maxPreviews: number;
  readonly maxPending: number;
  readonly maxHistory: number;
  readonly maxIdempotencyEntries: number;
  readonly maxIdentityBytes: number;
  readonly maxLedgerBytes: number;
  readonly maxOutputBytes: number;
  readonly maxInputBytes: number;
  readonly maxCallbackMilliseconds: number;
  readonly maxInFlight: number;
}

function resolveLimits(options: ActionBoundaryOptions): ActionLimits {
  return {
    maxPreviews: bounded(options.maxPreviews ?? DEFAULTS.previews, 1, WIRE_LIMITS.array, 'maxPreviews'),
    maxPending: bounded(options.maxPending ?? DEFAULTS.pending, 1, WIRE_LIMITS.array, 'maxPending'),
    maxHistory: bounded(options.maxHistory ?? DEFAULTS.history, 1, WIRE_LIMITS.array, 'maxHistory'),
    maxIdempotencyEntries: bounded(
      options.maxIdempotencyEntries ?? DEFAULTS.idempotency,
      1,
      WIRE_LIMITS.array,
      'maxIdempotencyEntries',
    ),
    maxIdentityBytes: bounded(
      options.maxIdentityBytes ?? DEFAULTS.identityBytes,
      1,
      WIRE_LIMITS.bytes,
      'maxIdentityBytes',
    ),
    maxLedgerBytes: bounded(options.maxLedgerBytes ?? DEFAULTS.ledgerBytes, 1, WIRE_LIMITS.bytes, 'maxLedgerBytes'),
    maxOutputBytes: bounded(options.maxOutputBytes ?? DEFAULTS.outputBytes, 1, WIRE_LIMITS.bytes, 'maxOutputBytes'),
    maxInputBytes: bounded(options.maxInputBytes ?? DEFAULTS.inputBytes, 1, WIRE_LIMITS.bytes, 'maxInputBytes'),
    maxCallbackMilliseconds: bounded(
      options.maxCallbackMilliseconds ?? DEFAULTS.callbackMilliseconds,
      1,
      MAX_CALLBACK_MS,
      'maxCallbackMilliseconds',
    ),
    maxInFlight: bounded(options.maxInFlight ?? DEFAULTS.inFlight, 1, WIRE_LIMITS.array, 'maxInFlight'),
  };
}

export class ActionPortBase {
  protected readonly host: ActionBoundaryOptions['host'];
  protected readonly registry: ActionBoundaryOptions['registry'];
  protected readonly maxPreviews: number;
  protected readonly maxPending: number;
  protected readonly maxHistory: number;
  protected readonly maxIdempotencyEntries: number;
  protected readonly maxIdentityBytes: number;
  protected readonly maxLedgerBytes: number;
  protected readonly maxOutputBytes: number;
  protected readonly maxInputBytes: number;
  protected readonly maxCallbackMilliseconds: number;
  protected readonly maxInFlight: number;
  protected readonly now: () => number;
  protected readonly previews = new Map<string, PreviewRecord>();
  protected readonly receipts = new Map<string, ReceiptRecord>();
  protected readonly idempotency = new Map<string, LedgerRecord>();
  protected readonly activeCalls = new Set<ActiveCall>();
  protected readonly historyEntries: HistoryRecord[] = [];
  protected ledgerBytes = 0;
  /** Reservations made before an asynchronous context read completes. */
  protected pendingPreviewReservations = 0;
  protected sequence = 0;
  protected epoch = 0;
  protected status: 'active' | 'revoked' | 'disposed' = 'active';

  constructor(options: ActionBoundaryOptions) {
    this.host = options.host;
    this.registry = options.registry;
    const limits = resolveLimits(options);
    this.maxPreviews = limits.maxPreviews;
    this.maxPending = limits.maxPending;
    this.maxHistory = limits.maxHistory;
    this.maxIdempotencyEntries = limits.maxIdempotencyEntries;
    this.maxIdentityBytes = limits.maxIdentityBytes;
    this.maxLedgerBytes = limits.maxLedgerBytes;
    this.maxOutputBytes = limits.maxOutputBytes;
    this.maxInputBytes = limits.maxInputBytes;
    this.maxCallbackMilliseconds = limits.maxCallbackMilliseconds;
    this.maxInFlight = limits.maxInFlight;
    this.now = options.now ?? (() => Date.now());
    if (typeof options.host?.readContext !== 'function')
      throw new TypeError('An action host context callback is required.');
    if (typeof this.now !== 'function') throw new TypeError('now must be a function.');
  }

  protected outcome<T>(code: string, message: string, path: readonly (string | number)[] = []): ActionOutcome<T> {
    return failure(code, message, path);
  }
  protected lifecycle<T>(): ActionOutcome<T> {
    return this.status === 'disposed'
      ? this.outcome('action.disposed', 'The action port has been disposed.')
      : this.outcome('action.revoked', 'The action port has been revoked.');
  }
  protected live(): boolean {
    return this.status === 'active';
  }

  protected clock(): { readonly ok: true; readonly value: number } | { readonly ok: false } {
    try {
      const value = this.now();
      return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  protected tryHistory(entry: Omit<ActionHistoryEntry, 'at'>, historyPartition: ActionPartition): boolean {
    if (!this.live()) return false;
    const at = this.clock();
    if (!at.ok || !this.live()) return false;
    this.addHistory({ ...entry, at: at.value }, historyPartition);
    return this.live();
  }

  protected addHistoryAt(entry: Omit<ActionHistoryEntry, 'at'>, at: number, historyPartition: ActionPartition): void {
    this.addHistory({ ...entry, at }, historyPartition);
  }

  protected consumePreview(record: PreviewRecord): void {
    record.consumed = true;
    record.confirming = false;
    record.input = undefined;
    this.previews.delete(record.id);
  }

  protected reservePreview(): boolean {
    if (
      this.previews.size + this.pendingPreviewReservations >= this.maxPreviews ||
      this.previews.size + this.receipts.size + this.pendingPreviewReservations >= this.maxPending
    )
      return false;
    this.pendingPreviewReservations++;
    return true;
  }

  protected releasePreviewReservation(): void {
    if (this.pendingPreviewReservations > 0) this.pendingPreviewReservations--;
  }

  protected addHistory(entry: ActionHistoryEntry, historyPartition: ActionPartition): void {
    this.historyEntries.push({ entry: frozen(entry), partition: historyPartition });
    if (this.historyEntries.length > this.maxHistory)
      this.historyEntries.splice(0, this.historyEntries.length - this.maxHistory);
  }

  protected nextId(prefix: string): string {
    this.sequence = this.sequence >= Number.MAX_SAFE_INTEGER ? 1 : this.sequence + 1;
    return `${prefix}-${this.sequence}`.slice(0, WIRE_LIMITS.id);
  }

  protected async callHost<T>(
    callback: (signal: AbortSignal) => T | Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<HostCall<T>> {
    if (!this.live()) return { state: 'lifecycle' };
    if (signal?.aborted) return { state: 'cancelled' };
    if (this.activeCalls.size >= this.maxInFlight) return { state: 'budget' };
    const controller = new AbortController();
    let finished = false;
    let stop: (state: 'cancelled' | 'timeout' | 'lifecycle') => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const call = new Promise<HostCall<T>>((resolve) => {
      const finish = (result: HostCall<T>): void => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
        this.activeCalls.delete(active);
        resolve(result);
      };
      const onCallerAbort = (): void => {
        stop('cancelled');
      };
      const active: ActiveCall = { abort: (state) => stop(state) };
      stop = (state): void => {
        if (finished) return;
        controller.abort();
        finish({ state });
      };
      this.activeCalls.add(active);
      signal?.addEventListener('abort', onCallerAbort, { once: true });
      timer = setTimeout(() => stop('timeout'), this.maxCallbackMilliseconds);
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(callback(controller.signal));
      } catch {
        finish({ state: 'completed', value: undefined as unknown as T });
        return;
      }
      pending.then(
        (value) => {
          if (!finished) finish({ state: 'completed', value });
        },
        () => {
          if (!finished) finish({ state: 'completed', value: undefined as unknown as T });
        },
      );
    });
    return call;
  }

  protected async readContext(signal: AbortSignal | undefined): Promise<ActionOutcome<TrustedActionContext>> {
    const host = await this.callHost((hostSignal) => this.host.readContext({ signal: hostSignal }), signal);
    if (host.state === 'completed') {
      const outcome = normalizeOutcome<unknown>(host.value);
      if (outcome === undefined || !outcome.ok)
        return this.outcome('action.denied', 'The host action context could not be authenticated.');
      return context(outcome.value);
    }
    switch (host.state) {
      case 'lifecycle':
        return this.lifecycle();
      case 'cancelled':
        return this.outcome('action.cancelled', 'The action context read was cancelled.');
      case 'budget':
        return this.outcome('action.budget', 'The host callback budget is full.');
      default:
        return this.outcome('action.budget', 'The action context read exceeded its bounded time budget.');
    }
  }

  protected normalizedInput(registration: ActionRegistration, input: ActionPayload): ActionOutcome<ActionPayload> {
    let parsed: Outcome<unknown> | undefined;
    try {
      parsed = registration.inputSchema.parse(input);
    } catch {
      return this.outcome('action.invalid', 'The action input does not satisfy its registered schema.');
    }
    const outcome = normalizeOutcome<unknown>(parsed);
    if (outcome === undefined || !outcome.ok)
      return this.outcome('action.invalid', 'The action input does not satisfy its registered schema.');
    const checked = payload(outcome.value);
    if (!checked.ok) return checked;
    if (bytes(canonical(checked.value)) > this.maxInputBytes)
      return this.outcome('action.budget', 'The action input exceeds its bounded resource budget.');
    return checked;
  }

  protected idempotencyIdentity(
    registration: ActionRegistration,
    input: ActionPayload,
    entityValue: ActionEntity | undefined,
    key: string,
  ): string {
    return canonical({
      key,
      action: registration.descriptor.ref,
      input,
      ...(entityValue === undefined ? {} : { entity: entityValue }),
      inputSchema: registration.descriptor.input,
      outputSchema: registration.descriptor.output,
    });
  }
}
