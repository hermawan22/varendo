import type { Outcome } from '@varendo/core';
import type { RegionContent, RegionHandle, RegionSnapshot } from '../regions/types.js';
import type { RuntimePresentationInput } from './types.js';
import { applyPrepared, projectionTransaction } from './render-projection.js';
import { failure, sameTask, validId } from './runtime-state.js';

export async function commitRuntimePresentation(
  region: RegionHandle,
  input: RuntimePresentationInput,
): Promise<Outcome<RegionSnapshot>> {
  const current = region.snapshot();
  if (!validId(input.requestId))
    return failure('runtime.presentation-invalid', 'Presentation request ID must be bounded.', ['requestId']);
  if (!sameTask(current, input.task) || current.readSet === undefined)
    return failure('runtime.presentation-stale', 'Presentation Task is not the current committed Task.');
  const projection = input.projection === undefined ? undefined : projectionTransaction(input.projection);
  if (projection !== undefined && !projection.ok) return projection;
  const transaction = projection?.value;
  let published = false;
  try {
    const staged = await region.stage({
      requestId: input.requestId,
      expected: current.readSet,
      state: presentationState(input),
    });
    if (!staged.ok) return staged;
    const committed = await region.commit(staged.value, {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      recheck: (next) => {
        if (next === undefined || next.state?.task.id !== input.task.id)
          return failure('runtime.presentation-stale', 'Presentation Task changed before commit.');
        return applyPrepared(transaction, next);
      },
    });
    published = committed.ok;
    return committed;
  } finally {
    if (!published) transaction?.rollback();
  }
}

function presentationState(input: RuntimePresentationInput): RegionContent {
  return {
    task: input.task,
    presentation: input.presentation,
    ...(input.interaction === undefined ? {} : { interaction: input.interaction }),
  };
}
