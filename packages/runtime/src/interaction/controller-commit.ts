import { parseInteractionState } from '@varendo/core/interaction';
import type { InteractionState as CoreInteractionState } from '@varendo/core';
import type { RegionContent, RegionHandle, RegionReadSet, RegionSnapshot } from '../regions/types.js';
import type { ResultHandle } from '../results/types.js';
import { canonical, failure } from './controller-common.js';
import type { EventDeadline } from './controller-common.js';
import type { InteractionEvent, InteractionOutcome } from './types.js';

type DeadlineCheck = (deadline: EventDeadline, controller: AbortController) => boolean;

interface CommitOptions {
  readonly region: RegionHandle;
  readonly event: InteractionEvent;
  readonly before: RegionSnapshot;
  readonly expected: RegionReadSet;
  readonly next: CoreInteractionState;
  readonly candidate: RegionContent | undefined;
  readonly resultHandles: readonly ResultHandle[];
  readonly controller: AbortController;
  readonly deadline: EventDeadline;
  readonly deadlineExpired: DeadlineCheck;
  readonly recheck: () => InteractionOutcome<void>;
  readonly revoke: () => void;
}

function validateCommit(options: CommitOptions): InteractionOutcome<RegionContent> {
  const { before, candidate, next } = options;
  if (before.readSet === undefined || before.state === undefined)
    return failure('runtime.interaction-disposed', 'The region has no active state or read set.');
  if (options.region.snapshot().regionRevision !== before.regionRevision)
    return failure('runtime.interaction-stale', 'The region changed while the interaction was being prepared.');
  const state = candidate ?? { ...before.state, interaction: next };
  const checked = state.interaction === undefined ? undefined : parseInteractionState(state.interaction);
  if (checked === undefined || !checked.ok || canonical(checked.value) !== canonical(next))
    return failure(
      'runtime.interaction-invalid',
      'The interaction state candidate is not the prepared canonical state.',
    );
  return { ok: true, value: state };
}

function commitFailure(
  options: CommitOptions,
  message: string,
  code: string | undefined,
): InteractionOutcome<RegionSnapshot> {
  if (options.deadline.expired || options.deadlineExpired(options.deadline, options.controller))
    return failure('runtime.interaction-budget', message);
  if (options.controller.signal.aborted || code === 'runtime.region-cancelled')
    return failure('runtime.interaction-cancelled', message);
  return failure('runtime.interaction-stale', message);
}

async function stageAndCommit(
  options: CommitOptions,
  state: RegionContent,
): Promise<InteractionOutcome<RegionSnapshot>> {
  const staged = await options.region.stage({
    requestId: options.event.eventId,
    expected: options.expected,
    state,
    ...(options.resultHandles.length === 0 ? {} : { resultHandles: options.resultHandles }),
  });
  if (!staged.ok) return failure('runtime.interaction-stale', staged.diagnostics[0]!.message);
  if (options.deadlineExpired(options.deadline, options.controller)) {
    options.region.discard(staged.value);
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  }
  if (options.controller.signal.aborted) return cancelledStage(options, staged.value);
  const committed = await options.region.commit(staged.value, {
    signal: options.controller.signal,
    recheck: () => {
      if (options.deadlineExpired(options.deadline, options.controller))
        return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
      return options.recheck();
    },
  });
  if (!committed.ok) return commitFailure(options, committed.diagnostics[0]!.message, committed.diagnostics[0]?.code);
  return committed;
}

function cancelledStage(
  options: CommitOptions,
  staged: Parameters<RegionHandle['discard']>[0],
): InteractionOutcome<RegionSnapshot> {
  options.region.discard(staged);
  return options.deadline.expired
    ? failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.')
    : failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
}

export async function commitInteractionState(options: CommitOptions): Promise<InteractionOutcome<RegionSnapshot>> {
  if (options.deadlineExpired(options.deadline, options.controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  const checked = validateCommit(options);
  if (!checked.ok) return checked;
  try {
    return await stageAndCommit(options, checked.value);
  } finally {
    if (options.region.snapshot().status !== 'active') options.revoke();
  }
}
