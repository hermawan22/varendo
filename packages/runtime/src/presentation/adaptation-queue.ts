import type { PresentationEnvironment } from '@varendo/core/presentation';
import type { RegionOutcome } from '../regions/types.js';
import type { PresentationAdaptationRequestOptions, PresentationAdaptationResult } from './adaptation-types.js';

export interface AdaptationQueueRequest {
  readonly environment: PresentationEnvironment;
  readonly options: PresentationAdaptationRequestOptions;
}

type Settler = (outcome: RegionOutcome<PresentationAdaptationResult>) => void;

export interface AdaptationQueueOptions {
  readonly now: () => number;
  readonly lastCommitAt: () => number | undefined;
  readonly schedule: (callback: () => void, delay: number) => unknown;
  readonly cancelSchedule: (handle: unknown) => void;
  readonly dwellMs: number;
  readonly maxPending: number;
  readonly unavailable: () => boolean;
  readonly abortActive: () => void;
  readonly run: (request: AdaptationQueueRequest) => Promise<RegionOutcome<PresentationAdaptationResult>>;
}

function failure<T>(code: string, message: string): RegionOutcome<T> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

export class AdaptationRequestQueue {
  private readonly options: AdaptationQueueOptions;
  private pendingRequest: AdaptationQueueRequest | undefined;
  private waiters: Settler[] = [];
  private scheduledHandle: unknown;
  private scheduledActive = false;
  private scheduleEpoch = 0;
  private running: Promise<RegionOutcome<PresentationAdaptationResult>> | undefined;
  private runningWaiters: readonly Settler[] = [];
  private closed = false;

  constructor(options: AdaptationQueueOptions) {
    this.options = options;
  }

  private settle(waiters: readonly Settler[], outcome: RegionOutcome<PresentationAdaptationResult>): void {
    for (const resolve of waiters) resolve(outcome);
  }

  private clearPending(outcome: RegionOutcome<PresentationAdaptationResult>): void {
    const current = this.waiters;
    this.waiters = [];
    this.settle(current, outcome);
  }

  private settleRunning(outcome: RegionOutcome<PresentationAdaptationResult>): void {
    const current = this.runningWaiters;
    this.runningWaiters = [];
    this.settle(current, outcome);
  }

  private cancelScheduled(): void {
    this.scheduleEpoch++;
    if (!this.scheduledActive) return;
    if (this.scheduledHandle !== undefined) {
      try {
        this.options.cancelSchedule(this.scheduledHandle);
      } catch {
        // The epoch check makes a stale callback harmless.
      }
    }
    this.scheduledHandle = undefined;
    this.scheduledActive = false;
  }

  private scheduleStart(delay: number): void {
    if (this.isClosed() || this.scheduledActive || this.running !== undefined || this.pendingRequest === undefined)
      return;
    const epoch = ++this.scheduleEpoch;
    try {
      const handle = this.options.schedule(() => this.onScheduledStart(epoch), delay);
      if (this.running === undefined && this.pendingRequest !== undefined) {
        this.scheduledHandle = handle;
        this.scheduledActive = true;
      }
    } catch {
      this.scheduledHandle = undefined;
      this.scheduledActive = false;
      this.pendingRequest = undefined;
      this.clearPending(failure('runtime.presentation-schedule', 'The adaptation scheduler failed.'));
    }
  }

  private isClosed(): boolean {
    return this.closed || this.options.unavailable();
  }

  private onScheduledStart(epoch: number): void {
    if (epoch !== this.scheduleEpoch || this.isClosed()) return;
    this.scheduleEpoch++;
    this.scheduledHandle = undefined;
    this.scheduledActive = false;
    this.startPending();
  }

  private startPending(): void {
    if (this.pendingRequest === undefined || this.isClosed()) return;
    const request = this.pendingRequest;
    this.pendingRequest = undefined;
    const waiters = this.waiters;
    this.waiters = [];
    this.startRunning(request, waiters);
  }

  private startRunning(
    request: AdaptationQueueRequest,
    waiters: readonly Settler[],
  ): Promise<RegionOutcome<PresentationAdaptationResult>> {
    this.runningWaiters = waiters;
    this.running = this.options
      .run(request)
      .then(
        (outcome) => {
          this.settleRunning(outcome);
          return outcome;
        },
        () => {
          const outcome = failure<PresentationAdaptationResult>(
            'runtime.presentation-context',
            'The adaptation failed before publication.',
          );
          this.settleRunning(outcome);
          return outcome;
        },
      )
      .finally(() => this.finishRunning());
    return this.running;
  }

  private finishRunning(): void {
    this.running = undefined;
    if (this.pendingRequest === undefined || this.isClosed()) return;
    const lastCommitAt = this.options.lastCommitAt();
    const delay =
      lastCommitAt === undefined ? 0 : Math.max(0, this.options.dwellMs - (this.options.now() - lastCommitAt));
    this.scheduleStart(delay);
  }

  private execute(): Promise<RegionOutcome<PresentationAdaptationResult>> {
    if (this.running !== undefined) return this.running;
    if (this.pendingRequest === undefined)
      return Promise.resolve(failure('runtime.presentation-queue', 'No adaptation request is queued.'));
    this.cancelScheduled();
    const request = this.pendingRequest;
    this.pendingRequest = undefined;
    const waiters = this.waiters;
    this.waiters = [];
    return this.startRunning(request, waiters);
  }

  request(
    environment: PresentationEnvironment,
    options: PresentationAdaptationRequestOptions = {},
  ): Promise<RegionOutcome<PresentationAdaptationResult>> {
    if (this.isClosed())
      return Promise.resolve(failure('runtime.presentation-disposed', 'The adaptation controller is disposed.'));
    if (this.waiters.length >= this.options.maxPending)
      return Promise.resolve(failure('runtime.presentation-budget', 'The adaptation request queue is full.'));
    this.options.abortActive();
    return new Promise((resolve) => {
      this.pendingRequest = { environment, options };
      this.waiters.push(resolve);
      if (this.running !== undefined) return;
      const lastCommitAt = this.options.lastCommitAt();
      const delay =
        lastCommitAt === undefined ? 0 : Math.max(0, this.options.dwellMs - (this.options.now() - lastCommitAt));
      this.scheduleStart(delay);
    });
  }

  flush(): Promise<RegionOutcome<PresentationAdaptationResult>> {
    if (this.isClosed())
      return Promise.resolve(failure('runtime.presentation-disposed', 'The adaptation controller is disposed.'));
    if (this.running !== undefined) return this.running;
    return this.execute();
  }

  get pending(): boolean {
    return !this.isClosed() && (this.pendingRequest !== undefined || this.running !== undefined);
  }

  close(outcome: RegionOutcome<PresentationAdaptationResult>): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelScheduled();
    this.pendingRequest = undefined;
    this.clearPending(outcome);
    this.settleRunning(outcome);
  }
}
