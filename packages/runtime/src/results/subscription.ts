import type { Outcome, ResultSubscriptionController } from './internal-types.js';
import type { ResultEvent, ResultSubscription, ResultUpdate } from './types.js';
import { raceAbort } from './store-utils.js';

export class ResultSubscriptionImpl implements ResultSubscription {
  private readonly controller: ResultSubscriptionController;
  private readonly iterator: AsyncIterator<unknown>;
  private readonly signal: AbortSignal | undefined;
  private readonly localAbort = new AbortController();
  private pending: Promise<IteratorResult<ResultUpdate>> | undefined;
  private closed = false;
  private finalUpdateReturned = false;

  constructor(
    controller: ResultSubscriptionController,
    iterator: AsyncIterator<unknown>,
    signal: AbortSignal | undefined,
  ) {
    this.controller = controller;
    this.iterator = iterator;
    this.signal = signal;
  }

  private readonly onAbort = (): void => {
    this.cancel();
  };

  listenForAbort(): void {
    if (this.signal === undefined) return;
    if (this.signal.aborted) {
      this.cancel();
      return;
    }
    this.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ResultUpdate> {
    return this;
  }

  private releaseIterator(): void {
    this.signal?.removeEventListener('abort', this.onAbort);
    this.localAbort.abort();
    try {
      const cleanup = this.iterator.return?.();
      if (cleanup !== undefined) void Promise.resolve(cleanup).catch(() => {});
    } catch {
      /* cleanup is deliberately nonblocking */
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseIterator();
    this.controller.subscriptionClosed(this);
  }

  closeWithoutPull(): void {
    this.finish();
  }

  closeAsSuperseded(): void {
    this.closed = true;
    this.releaseIterator();
    this.controller.subscriptionClosed(this);
  }

  cancel(): void {
    if (this.closed) return;
    if (!this.controller.isSuperseded()) this.controller.cancel();
    this.finish();
  }

  private terminalUpdate(): IteratorResult<ResultUpdate> {
    if (this.finalUpdateReturned) return { done: true, value: undefined };
    this.finalUpdateReturned = true;
    return { done: false, value: { snapshot: this.controller.snapshot() } };
  }

  private preflight(): IteratorResult<ResultUpdate> | undefined {
    if (this.closed) return { done: true, value: undefined };
    if (this.signal?.aborted) {
      this.cancel();
      return this.terminalUpdate();
    }
    if (!this.controller.isTerminal()) return undefined;
    this.finish();
    return this.terminalUpdate();
  }

  private requestNext(): Promise<IteratorResult<unknown>> | undefined {
    try {
      return Promise.resolve(this.iterator.next());
    } catch {
      this.controller.streamFailure();
      this.finish();
      return undefined;
    }
  }

  private handleAbortRace(): IteratorResult<ResultUpdate> {
    if (this.closed) return this.signal?.aborted ? this.terminalUpdate() : { done: true, value: undefined };
    this.cancel();
    return this.terminalUpdate();
  }

  private async handleSourceResult(result: IteratorResult<unknown> | undefined): Promise<IteratorResult<ResultUpdate>> {
    if (result === undefined) {
      this.controller.streamFailure();
      this.finish();
      return this.terminalUpdate();
    }
    if (result.done) {
      if (!this.controller.isTerminal()) this.controller.truncated();
      this.finish();
      return this.terminalUpdate();
    }
    return this.commitEvent(result.value);
  }

  private async commitEvent(raw: unknown): Promise<IteratorResult<ResultUpdate>> {
    const event: Outcome<ResultEvent> = await this.controller.ingest(raw);
    if (!event.ok) {
      this.finish();
      return this.terminalUpdate();
    }
    const update: ResultUpdate = { snapshot: this.controller.snapshot(), event: event.value };
    if (this.controller.isTerminal()) this.finish();
    return { done: false, value: update };
  }

  private async consumeNext(pending: Promise<IteratorResult<unknown>>): Promise<IteratorResult<ResultUpdate>> {
    const raced = await raceAbort(pending, [this.signal, this.localAbort.signal]);
    if (raced.aborted) return this.handleAbortRace();
    if (this.closed) return { done: true, value: undefined };
    return this.handleSourceResult(raced.value);
  }

  private async pull(): Promise<IteratorResult<ResultUpdate>> {
    const early = this.preflight();
    if (early !== undefined) return early;
    const pending = this.requestNext();
    if (pending === undefined) return this.terminalUpdate();
    return this.consumeNext(pending);
  }

  next(): Promise<IteratorResult<ResultUpdate>> {
    if (this.pending !== undefined) return this.pending;
    const pending = this.pull();
    this.pending = pending.finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  return(): Promise<IteratorResult<ResultUpdate>> {
    this.cancel();
    return Promise.resolve({ done: true, value: undefined });
  }

  throw(error?: unknown): Promise<IteratorResult<ResultUpdate>> {
    this.cancel();
    return Promise.reject(error);
  }
}
