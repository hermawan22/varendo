import { parseInteraction, WIRE_LIMITS } from '@varendo/core';
import { createSerialQueue, type SerialQueue } from '../scheduling/index.js';
import type { RegionObserver, RegionHandle, RegionUpdate } from '../regions/types.js';
import {
  DEFAULT_MAX_EVENT_MILLISECONDS,
  DEFAULT_MAX_HOPS,
  DEFAULT_MAX_QUEUED_EVENTS,
  eventIdentity,
  failure,
  monotonicNow,
  publicState,
} from './controller-common.js';
import type { EventDeadline, SeenEvent } from './controller-common.js';
import { processInteractionEvent } from './controller-process.js';
import type {
  InteractionController,
  InteractionControllerOptions,
  InteractionDispatchOptions,
  InteractionEvent,
  InteractionOutcome,
  InteractionReceipt,
  InteractionState,
} from './types.js';

interface ControllerLimits {
  readonly maxEventMilliseconds: number;
  readonly maxHops: number;
}

function validateProcessingLimits(
  options: InteractionControllerOptions,
): Pick<ControllerLimits, 'maxEventMilliseconds' | 'maxHops'> {
  const maxEventMilliseconds = options.maxEventMilliseconds ?? DEFAULT_MAX_EVENT_MILLISECONDS;
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;
  if (!Number.isSafeInteger(maxEventMilliseconds) || maxEventMilliseconds < 1 || maxEventMilliseconds > 86_400_000)
    throw new TypeError('maxEventMilliseconds must be a bounded positive duration.');
  if (!Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > WIRE_LIMITS.array)
    throw new TypeError('maxHops must be a bounded positive integer.');
  return { maxEventMilliseconds, maxHops };
}

function validateQueueLimit(options: InteractionControllerOptions): number {
  const maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
  if (!Number.isSafeInteger(maxQueuedEvents) || maxQueuedEvents < 1 || maxQueuedEvents > WIRE_LIMITS.array)
    throw new TypeError('maxQueuedEvents must be a bounded positive integer.');
  return maxQueuedEvents;
}

function dispatchError(error: unknown): InteractionOutcome<InteractionReceipt> {
  return failure(
    'runtime.interaction-invalid',
    error instanceof Error ? error.message : 'The interaction queue rejected the event.',
  );
}

class InteractionControllerImpl implements InteractionController {
  private readonly queue: SerialQueue;
  private readonly maxEventMilliseconds: number;
  private readonly maxHops: number;
  private readonly maxQueuedEvents: number;
  private readonly pending = new Map<string, AbortController>();
  private readonly seen = new Map<string, SeenEvent>();
  private readonly seenOrder: string[] = [];
  private seenBytes = 0;
  private readonly region: RegionHandle;
  private readonly options: InteractionControllerOptions;
  private observer: RegionObserver | undefined;
  private revoked = false;
  private disposed = false;

  constructor(options: InteractionControllerOptions) {
    if (options === null || typeof options !== 'object')
      throw new TypeError('Interaction controller options are required.');
    this.region = options.region;
    this.options = options;
    const limits = validateProcessingLimits(options);
    this.maxEventMilliseconds = limits.maxEventMilliseconds;
    this.maxHops = limits.maxHops;
    if (this.region.snapshot().status !== 'active')
      throw new TypeError('An interaction controller requires an active region.');
    this.maxQueuedEvents = validateQueueLimit(options);
    this.queue = createSerialQueue(this.maxQueuedEvents);
    this.observer = this.region.observe((update) => this.observeRegion(update));
  }

  /**
   * Controller revocation closes this event channel and aborts work. The host
   * owns read-access revocation and must revoke the region/result partition
   * when its authorization is withdrawn; controller.revoke() does not mutate
   * application-owned region data by itself.
   */
  state(): InteractionState {
    return publicState(this.region.snapshot());
  }

  dispatch(input: unknown, options: InteractionDispatchOptions = {}): Promise<InteractionOutcome<InteractionReceipt>> {
    if (this.disposed)
      return Promise.resolve(failure('runtime.interaction-disposed', 'The interaction controller has been disposed.'));
    if (this.revoked)
      return Promise.resolve(failure('runtime.interaction-revoked', 'The interaction controller has been revoked.'));
    const parsed = parseInteraction(input);
    if (!parsed.ok)
      return Promise.resolve(
        failure('runtime.interaction-invalid', 'The interaction event is not a valid canonical wire event.'),
      );
    const event = parsed.value;
    const identity = eventIdentity(event, options.sourcePortId);
    const rejected = this.admissionFailure(event, identity);
    if (rejected !== undefined) return Promise.resolve(rejected);
    return this.enqueueEvent(event, options);
  }

  private admissionFailure(
    event: InteractionEvent,
    identity: string,
  ): InteractionOutcome<InteractionReceipt> | undefined {
    const seen = this.seen.get(event.eventId);
    if (seen !== undefined && seen.identity !== identity)
      return failure(
        'runtime.interaction-invalid',
        'The interaction event ID was already completed with different canonical input.',
      );
    if (this.pending.has(event.eventId))
      return failure('runtime.interaction-stale', 'An interaction with this event ID is already pending.');
    // Reserve capacity synchronously so rejected promises cannot exceed the queue budget.
    if (this.pending.size >= this.maxQueuedEvents)
      return failure('runtime.interaction-budget', 'The interaction queue is full.');
    return undefined;
  }

  private enqueueEvent(
    event: InteractionEvent,
    options: InteractionDispatchOptions,
  ): Promise<InteractionOutcome<InteractionReceipt>> {
    const controller = new AbortController();
    const forward = () => controller.abort();
    options.signal?.addEventListener('abort', forward, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.pending.set(event.eventId, controller);
    const run = this.queue.enqueue<InteractionOutcome<InteractionReceipt>>(() =>
      this.process(event, options.sourcePortId, controller),
    );
    return run
      .then(
        (result): InteractionOutcome<InteractionReceipt> => result,
        (error: unknown) => dispatchError(error),
      )
      .finally(() => {
        options.signal?.removeEventListener('abort', forward);
        this.pending.delete(event.eventId);
      });
  }

  cancel(eventId: string): boolean {
    const controller = this.pending.get(eventId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  revoke(_reason?: string): boolean {
    if (this.disposed || this.revoked) return false;
    this.revoked = true;
    this.abortPending();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revoked = true;
    this.abortPending();
    this.observer?.unsubscribe();
    this.observer = undefined;
    this.queue.close();
  }

  private observeRegion(update: RegionUpdate): void {
    if (update.kind !== 'revoke' && update.kind !== 'dispose') return;
    this.revoked = true;
    this.abortPending();
  }

  private abortPending(): void {
    for (const controller of this.pending.values()) controller.abort();
  }

  private deadlineExpired(deadline: EventDeadline, controller: AbortController): boolean {
    if (deadline.expired) return true;
    if (monotonicNow() < deadline.expiresAt) return false;
    deadline.expired = true;
    controller.abort();
    return true;
  }

  private remember(eventId: string, identity: string): void {
    if (this.seen.has(eventId)) return;
    const bytes = new TextEncoder().encode(eventId + '\u0000' + identity).byteLength;
    this.seen.set(eventId, { identity, bytes });
    this.seenOrder.push(eventId);
    this.seenBytes += bytes;
    this.evictOldReceipts();
  }

  private evictOldReceipts(): void {
    while (
      (this.seenOrder.length > this.maxQueuedEvents * 4 || this.seenBytes > WIRE_LIMITS.bytes) &&
      this.seenOrder.length > 0
    ) {
      const old = this.seenOrder.shift();
      if (old === undefined) continue;
      const entry = this.seen.get(old);
      if (entry !== undefined) this.seenBytes -= entry.bytes;
      this.seen.delete(old);
    }
  }

  private async process(
    event: InteractionEvent,
    sourcePortId: string | undefined,
    controller: AbortController,
  ): Promise<InteractionOutcome<InteractionReceipt>> {
    const deadline: EventDeadline = {
      expiresAt: monotonicNow() + this.maxEventMilliseconds,
      expired: false,
    };
    const timer = setTimeout(() => {
      deadline.expired = true;
      controller.abort();
    }, this.maxEventMilliseconds);
    try {
      return await processInteractionEvent(event, sourcePortId, controller, deadline, {
        options: this.options,
        region: this.region,
        graph: this.options.graph,
        maxHops: this.maxHops,
        maxEventMilliseconds: this.maxEventMilliseconds,
        isDisposed: () => this.disposed,
        isRevoked: () => this.revoked,
        abortPending: () => this.abortPending(),
        remember: (eventId, identity) => this.remember(eventId, identity),
        seen: (eventId) => this.seen.get(eventId),
        deadlineExpired: (currentDeadline, currentController) =>
          this.deadlineExpired(currentDeadline, currentController),
        markRevoked: () => {
          this.revoked = true;
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createInteractionController(options: InteractionControllerOptions): InteractionController {
  return new InteractionControllerImpl(options);
}
