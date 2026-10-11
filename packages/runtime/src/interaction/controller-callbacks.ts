import type {
  InteractionHostCallback,
  InteractionControllerOptions,
  InteractionMaterialization,
  InteractionOutcome,
  InteractionQueryPayload,
  InteractionResolutionContext,
} from './types.js';
import type { EventDeadline } from './controller-common.js';
import { failure } from './controller-common.js';
import { callbackOutcome, materializationOutcome } from './controller-outcomes.js';

type DeadlineCheck = (deadline: EventDeadline, controller: AbortController) => boolean;

interface CallbackMessages {
  readonly timeout: string;
  readonly rejected: string;
}

type RaceResult<T> =
  { readonly kind: 'value'; readonly value: T } | { readonly kind: 'timeout' } | { readonly kind: 'aborted' };

async function raceOperation<T>(
  operation: () => T | Promise<T>,
  controller: AbortController,
  maxMilliseconds: number,
): Promise<RaceResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let timedOut = false;
  const pending = Promise.resolve().then(operation);
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve('timeout');
    }, maxMilliseconds);
  });
  const aborted = new Promise<'aborted'>((resolve) => {
    onAbort = () => resolve('aborted');
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([pending, timeout, aborted]);
    if (result === 'timeout' || timedOut) return { kind: 'timeout' };
    if (result === 'aborted') return { kind: 'aborted' };
    return { kind: 'value', value: result as T };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) controller.signal.removeEventListener('abort', onAbort);
  }
}

function cancelled<T>(deadline: EventDeadline): InteractionOutcome<T> {
  return deadline.expired
    ? failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.')
    : failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
}

async function invokeBounded<T>(
  operation: () => T | Promise<T>,
  controller: AbortController,
  deadline: EventDeadline,
  maxMilliseconds: number,
  deadlineExpired: DeadlineCheck,
  messages: CallbackMessages,
): Promise<InteractionOutcome<T>> {
  if (deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  if (controller.signal.aborted) return cancelled(deadline);
  let result: RaceResult<T>;
  try {
    result = await raceOperation(operation, controller, maxMilliseconds);
  } catch {
    return failure('runtime.interaction-denied', messages.rejected);
  }
  if (deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  if (result.kind === 'timeout') {
    controller.abort();
    return failure('runtime.interaction-budget', messages.timeout);
  }
  if (result.kind === 'aborted' || controller.signal.aborted) return cancelled(deadline);
  if (result.kind !== 'value') return failure('runtime.interaction-denied', messages.rejected);
  return { ok: true, value: result.value };
}

export async function callInteractionHost<T>(
  callback: InteractionHostCallback<T> | undefined,
  value: T,
  context: InteractionResolutionContext,
  controller: AbortController,
  deadline: EventDeadline,
  maxMilliseconds: number,
  deadlineExpired: DeadlineCheck,
): Promise<InteractionOutcome<void>> {
  if (callback === undefined)
    return failure('runtime.interaction-denied', 'The host has not registered the required interaction callback.');
  const outcome = await invokeBounded(
    () => callback(value, context),
    controller,
    deadline,
    maxMilliseconds,
    deadlineExpired,
    {
      timeout: 'The host interaction callback exceeded its bounded time budget.',
      rejected: 'The host interaction callback failed.',
    },
  );
  return outcome.ok ? callbackOutcome(outcome.value) : outcome;
}

export async function callInteractionMaterializer(
  options: InteractionControllerOptions,
  payloads: readonly InteractionQueryPayload[],
  context: InteractionResolutionContext,
  next: import('@varendo/core').InteractionState,
  controller: AbortController,
  deadline: EventDeadline,
  maxMilliseconds: number,
  deadlineExpired: DeadlineCheck,
): Promise<InteractionOutcome<InteractionMaterialization>> {
  const callback = options.materialize;
  if (callback === undefined)
    return failure(
      'runtime.interaction-denied',
      'The host has not registered a materializer for query-affecting interaction state.',
    );
  const outcome = await invokeBounded(
    () => callback(payloads, context, next),
    controller,
    deadline,
    maxMilliseconds,
    deadlineExpired,
    {
      timeout: 'The host materializer exceeded its bounded time budget.',
      rejected: 'The host materializer failed.',
    },
  );
  if (!outcome.ok) return outcome;
  return materializationOutcome(outcome.value);
}
