import type { RegionDocument } from '../persistence/types.js';
import type {
  AuthorizeRegionCommit,
  RegionAuthority,
  RegionCommitAuthorizationInput,
  RegionOutcome,
  RegionRestoreMaterialization,
  RestoreRegion,
} from './types.js';
import { FAILURE, failure, normalizeHostOutcome } from './region-contracts.js';
import { validateRestoreMaterialization } from './result-handles.js';

const MAX_TIMER_MILLISECONDS = 2_147_483_647;

interface RegionDeadlineOptions<T> {
  readonly maxMilliseconds: number;
  readonly callerSignal?: AbortSignal | undefined;
  readonly controllers: Set<AbortController>;
  /** Outcome when the linked controller aborts; `timedOut` marks timer expiry. */
  readonly onAbort: (timedOut: boolean) => RegionOutcome<T>;
  /** Outcome when the host operation throws or rejects. */
  readonly onRejected: () => RegionOutcome<T>;
  /** Host callback; its resolved value is validated by `settle`. */
  readonly start: (signal: AbortSignal) => unknown;
  /** Settle a fulfilled host value into `finish`; runs only while unsettled. */
  readonly settle: (value: unknown, finish: (result: RegionOutcome<T>) => void) => void;
}

/**
 * Run one host callback under a tracked abort controller and a bounded timer.
 * Cancellation and the timeout both abort the linked signal; the outcome is
 * then resolved by `onAbort`/`settle` so late host completions cannot publish.
 */
function runRegionDeadline<T>(options: RegionDeadlineOptions<T>): Promise<RegionOutcome<T>> {
  const controller = new AbortController();
  options.controllers.add(controller);
  let timedOut = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult: (result: RegionOutcome<T>) => void = () => {};
  const finish = (result: RegionOutcome<T>): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    options.callerSignal?.removeEventListener('abort', onCallerAbort);
    options.controllers.delete(controller);
    resolveResult(result);
  };
  const onAbort = (): void => finish(options.onAbort(timedOut));
  const onCallerAbort = (): void => controller.abort();
  const result = new Promise<RegionOutcome<T>>((resolve) => {
    resolveResult = resolve;
  });
  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (options.callerSignal?.aborted) {
    onCallerAbort();
    return result;
  }
  timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.min(options.maxMilliseconds, MAX_TIMER_MILLISECONDS),
  );
  let pending: Promise<unknown>;
  try {
    pending = Promise.resolve(options.start(controller.signal));
  } catch {
    finish(options.onRejected());
    return result;
  }
  pending.then(
    (value) => {
      if (!settled) options.settle(value, finish);
    },
    () => finish(options.onRejected()),
  );
  return result;
}

export interface CommitDeadlineOptions {
  readonly input: Omit<RegionCommitAuthorizationInput, 'signal'>;
  readonly callerSignal: AbortSignal | undefined;
  readonly maxMilliseconds: number;
  readonly authorize: AuthorizeRegionCommit;
  readonly isLive: () => boolean;
  readonly closedOutcome: () => RegionOutcome<void>;
  readonly controllers: Set<AbortController>;
}

export function authorizeWithDeadline({
  input,
  callerSignal,
  maxMilliseconds,
  authorize,
  isLive,
  closedOutcome,
  controllers,
}: CommitDeadlineOptions): Promise<RegionOutcome<void>> {
  if (!isLive()) return Promise.resolve(closedOutcome());
  if (callerSignal?.aborted) return Promise.resolve(cancelled());
  return runRegionDeadline<void>({
    callerSignal,
    maxMilliseconds,
    controllers,
    onAbort: (timedOut) => {
      if (!isLive()) return closedOutcome();
      if (callerSignal?.aborted) return cancelled();
      if (timedOut) return failure('runtime.region-budget', FAILURE.authorizationTimeout);
      return closedOutcome();
    },
    onRejected: () => failure('runtime.region-denied', FAILURE.denied),
    start: (signal) => authorize({ ...input, signal }),
    settle: (value, finish) => settleAuthorization(value, { isLive, callerSignal, closedOutcome, finish }),
  });
}

function cancelled(): RegionOutcome<void> {
  return failure('runtime.region-cancelled', 'The region commit was cancelled before publication.');
}

function settleAuthorization(
  authorized: unknown,
  options: Pick<CommitDeadlineOptions, 'isLive' | 'callerSignal' | 'closedOutcome'> & {
    readonly finish: (result: RegionOutcome<void>) => void;
  },
): void {
  try {
    if (!options.isLive()) {
      options.finish(options.closedOutcome());
      return;
    }
    const normalized = normalizeHostOutcome<void>(authorized);
    if (!options.isLive()) options.finish(options.closedOutcome());
    else if (options.callerSignal?.aborted) options.finish(cancelled());
    else options.finish(normalized);
  } catch {
    options.finish(failure('runtime.region-denied', FAILURE.denied));
  }
}

export interface RestoreDeadlineOptions {
  readonly document: RegionDocument;
  readonly authority: RegionAuthority;
  readonly maxRestoreMilliseconds: number;
  readonly restoreRegion: RestoreRegion | undefined;
  readonly isCurrent: () => boolean;
  readonly controllers: Set<AbortController>;
}

export function restoreWithDeadline({
  document,
  authority,
  maxRestoreMilliseconds,
  restoreRegion,
  isCurrent,
  controllers,
}: RestoreDeadlineOptions): Promise<RegionOutcome<RegionRestoreMaterialization>> {
  if (restoreRegion === undefined)
    return Promise.resolve(failure('runtime.region-denied', 'Restoring a region requires a host requery callback.'));
  if (!isCurrent()) return Promise.resolve(failure('runtime.region-disposed', FAILURE.disposed));
  return runRegionDeadline<RegionRestoreMaterialization>({
    maxMilliseconds: maxRestoreMilliseconds,
    controllers,
    onAbort: (timedOut) =>
      timedOut
        ? failure<RegionRestoreMaterialization>(
            'runtime.region-budget',
            'The host restore/requery exceeded its bounded time budget.',
          )
        : failure<RegionRestoreMaterialization>('runtime.region-disposed', FAILURE.disposed),
    onRejected: () => failure('runtime.region-denied', FAILURE.denied),
    start: (signal) => restoreRegion({ regionId: document.id, document, authority, signal }),
    settle: (value, finish) => settleRestore(value, { isCurrent, finish }),
  });
}

function settleRestore(
  value: unknown,
  options: {
    readonly isCurrent: () => boolean;
    readonly finish: (result: RegionOutcome<RegionRestoreMaterialization>) => void;
  },
): void {
  try {
    const { isCurrent, finish } = options;
    if (!isCurrent()) {
      finish(failure('runtime.region-disposed', FAILURE.disposed));
      return;
    }
    const normalized = normalizeHostOutcome<RegionRestoreMaterialization>(value);
    if (!isCurrent()) {
      finish(failure('runtime.region-disposed', FAILURE.disposed));
      return;
    }
    if (!normalized.ok) {
      finish(normalized);
      return;
    }
    finish(validateRestoreMaterialization(normalized.value));
  } catch {
    options.finish(failure('runtime.region-denied', FAILURE.denied));
  }
}
