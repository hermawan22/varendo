import type { InteractionState, PresentationPlan as CorePresentationPlan, Task } from '@varendo/core';

/** The only state a region owns. Records remain in the result store. */
export type PresentationPlan = CorePresentationPlan;

export interface RegionContent {
  readonly task: Task;
  readonly presentation?: PresentationPlan;
  /** Semantic control values and domain drafts, committed with the Task. */
  readonly interaction?: InteractionState;
}

export type RegionStatus = 'active' | 'revoked' | 'disposed';
