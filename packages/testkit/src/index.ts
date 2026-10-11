import type { ResultBatch, ResultEvent, ResultSnapshot } from '@varendo/runtime/results';

export const DEFAULT_MAX_RESULT_EVENTS = 256;
export const DEFAULT_MAX_RESULT_ROWS = 10_000;
export const DEFAULT_RESULT_COLLECTION_TIMEOUT_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

export interface CollectResultEventsOptions {
  /** Maximum number of events retained, including terminal events. */
  readonly maxEvents?: number;
  /** Maximum number of rows retained across batch events. */
  readonly maxRows?: number;
  /** Overall deadline for waiting on the source, in milliseconds. */
  readonly timeoutMs?: number;
  /** Cancels the collection and closes the source iterator. */
  readonly signal?: AbortSignal;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new RangeError(`${name} must be a positive safe integer.`);
  return result;
}

function nonNegativeLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
  return result;
}

function abortError(reason: unknown): Error {
  const error = new Error(reason instanceof Error ? reason.message : 'Result collection was aborted.');
  error.name = 'AbortError';
  return error;
}

function limitError(name: string, limit: number): Error {
  const error = new Error(`Result collection exceeded its ${name} limit of ${limit}.`);
  error.name = 'ResultCollectionLimitError';
  return error;
}

function timeoutLimit(value: number | undefined): number {
  const result = nonNegativeLimit(value, DEFAULT_RESULT_COLLECTION_TIMEOUT_MS, 'timeoutMs');
  if (result > MAX_TIMER_MS) throw new RangeError(`timeoutMs must not exceed ${MAX_TIMER_MS}ms.`);
  return result;
}

function monotonicNow(): number {
  const now = globalThis.performance?.now;
  return typeof now === 'function' ? now.call(globalThis.performance) : Date.now();
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`Result collection exceeded its ${timeoutMs}ms deadline.`);
  error.name = 'ResultCollectionTimeoutError';
  return error;
}

function nextBeforeDeadline(
  iterator: AsyncIterator<ResultEvent>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  remaining: number,
): Promise<IteratorResult<ResultEvent>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortError(signal?.reason)));
    if (signal !== undefined) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    timer = setTimeout(() => finish(() => reject(timeoutError(timeoutMs))), remaining);
    let pending: Promise<IteratorResult<ResultEvent>>;
    try {
      pending = Promise.resolve(iterator.next());
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/**
 * Collects a runtime result stream under explicit event, row and time bounds.
 * On cancellation, timeout or overflow the iterator is asked to close before
 * the error is returned. A source that ignores `return()` cannot extend the
 * collection deadline because its pending `next()` is raced with the signal.
 */
export async function collectResultEvents(
  events: AsyncIterable<ResultEvent>,
  options: CollectResultEventsOptions = {},
): Promise<readonly ResultEvent[]> {
  const maxEvents = positiveLimit(options.maxEvents, DEFAULT_MAX_RESULT_EVENTS, 'maxEvents');
  const maxRows = nonNegativeLimit(options.maxRows, DEFAULT_MAX_RESULT_ROWS, 'maxRows');
  const timeoutMs = timeoutLimit(options.timeoutMs);
  const signal = options.signal;
  const iterator = events[Symbol.asyncIterator]();
  const deadline = monotonicNow() + timeoutMs;
  const collected: ResultEvent[] = [];
  let rows = 0;
  let exhausted = false;
  const close = async (): Promise<void> => {
    try {
      const closing = iterator.return?.();
      if (closing === undefined) return;
      // A hostile iterator may never settle return() after a pending next().
      // Give normal cleanup a chance while retaining a bounded failure path.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(closing).then(
            () => undefined,
            () => undefined,
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.min(100, timeoutMs));
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } catch {
      // A source's close failure must not hide the authorization/limit failure.
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal.reason);
      const remaining = deadline - monotonicNow();
      if (remaining < 0) throw timeoutError(timeoutMs);
      const next = await nextBeforeDeadline(iterator, signal, timeoutMs, remaining);
      if (next.done) {
        exhausted = true;
        return collected;
      }
      collected.push(next.value);
      rows += next.value.kind === 'batch' ? next.value.rows.length : 0;
      if (collected.length > maxEvents) throw limitError('event', maxEvents);
      if (rows > maxRows) throw limitError('row', maxRows);
    }
  } finally {
    if (!exhausted) await close();
  }
}

/** Returns rows carried by runtime batch events, preserving source order. */
export function rowsFromResultEvents(events: readonly ResultEvent[]): ReadonlyArray<ResultBatch['rows'][number]> {
  return events.flatMap((event) => (event.kind === 'batch' ? [...event.rows] : []));
}

/** Returns rows currently retained in a runtime result-store snapshot. */
export function rowsFromResultSnapshot(snapshot: ResultSnapshot): ReadonlyArray<ResultBatch['rows'][number]> {
  return snapshot.batches.flatMap((batch) => [...batch.rows]);
}

/** Fails a host integration check if revoked/cancelled data remains materialized. */
export function assertNoMaterializedRows(value: readonly ResultEvent[] | ResultSnapshot): void {
  const rows = Array.isArray(value)
    ? rowsFromResultEvents(value as readonly ResultEvent[])
    : rowsFromResultSnapshot(value as ResultSnapshot);
  if (rows.length !== 0) {
    throw new Error(`Expected no materialized result rows, found ${rows.length}.`);
  }
}

/** Fails a host integration check unless the result-store state is denied and empty. */
export function assertDeniedSnapshot(snapshot: ResultSnapshot, expectedDiagnosticCode?: string): void {
  if (snapshot.status !== 'denied') {
    throw new Error(`Expected a denied result snapshot, received ${snapshot.status}.`);
  }
  if (snapshot.descriptor !== undefined) {
    throw new Error('A denied result snapshot must not retain a descriptor.');
  }
  assertNoMaterializedRows(snapshot);
  if (
    expectedDiagnosticCode !== undefined &&
    !snapshot.diagnostics.some(({ code }) => code === expectedDiagnosticCode)
  ) {
    throw new Error(`Expected denied snapshot diagnostic ${expectedDiagnosticCode}.`);
  }
}
