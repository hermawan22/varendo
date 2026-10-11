/** A bounded, FIFO, per-owner command queue. */
export interface SerialQueue {
  enqueue<T>(command: () => Promise<T> | T): Promise<T>;
  close(): void;
  readonly pending: number;
}

export function createSerialQueue(maxPending = 64): SerialQueue {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 10_000)
    throw new TypeError('maxPending must be a bounded positive safe integer.');
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let closed = false;
  const enqueue = <T>(command: () => Promise<T> | T): Promise<T> => {
    if (closed) return Promise.reject(new Error('The queue is closed.'));
    if (pending >= maxPending) return Promise.reject(new Error('The region command queue is full.'));
    pending++;
    const run = tail.then(command, command);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      pending--;
    });
  };
  return {
    enqueue,
    close: () => {
      closed = true;
    },
    get pending() {
      return pending;
    },
  };
}
