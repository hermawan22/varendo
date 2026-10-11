import type { Catalog, CommitPreconditions, Diagnostic, Task, TaskStructure } from '@varendo/core';
import type { AgentBindingOutcome, AgentTaskProposal } from '@varendo/core/agent';
import type { QueryPlanner } from '@varendo/core/query';
import type { AgentHostContext } from '../binder-types.js';

export type BindingFailureState = Extract<
  AgentBindingOutcome,
  { readonly state: 'unsupported' | 'denied' | 'invalid' | 'stale' }
>['state'];

export interface NormalizedHostContext extends AgentHostContext {
  readonly catalog: Catalog;
  readonly current: CommitPreconditions;
  readonly planner: QueryPlanner;
}

export interface ValidatedProposal {
  readonly proposal: AgentTaskProposal;
  readonly task: Task;
  readonly structure: TaskStructure;
  readonly context: NormalizedHostContext;
  readonly plans: readonly { readonly outputId: string; readonly canonical: string; readonly planKey: string }[];
}

export interface InspectionFailure {
  readonly ok: false;
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
  readonly state?: AgentBindingOutcome;
}

export type Inspection = { readonly ok: true; readonly value: ValidatedProposal } | InspectionFailure;
