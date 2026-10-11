import { parseContract, type Diagnostic, type Outcome, type ResultRef, type Task } from '@varendo/core';
import type { AgentBindingOutcome, OperationGrant } from '@varendo/core/agent';
import type { AgentBindingDecision, AgentHostContext } from '../binder-types.js';
import type { BindingFailureState, InspectionFailure, NormalizedHostContext } from './types.js';

export const GRANT_TASK_PROPOSE: OperationGrant = 'task.propose';
export const GRANT_CATALOG_READ: OperationGrant = 'catalog.read';
export const GRANT_RESULT_INSPECT: OperationGrant = 'result.inspect';

export function diagnostic(
  code: string,
  message: string,
  path?: readonly (string | number)[],
  retryable = false,
  remedies?: readonly string[],
): Diagnostic {
  return {
    code,
    message,
    retryable,
    ...(path === undefined || path.length === 0 ? {} : { path: [...path] }),
    ...(remedies === undefined || remedies.length === 0 ? {} : { remedies: [...remedies] }),
  };
}

export function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return { ok: false, diagnostics: [diagnostic(code, message, path)] };
}

export { boundedId as validId, boundedString as validText } from '../guards.js';

export function sameResultRef(left: ResultRef, right: ResultRef): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.outputId === right.outputId &&
    left.queryDigest === right.queryDigest &&
    left.scopeDigest === right.scopeDigest
  );
}

function samePath(
  left: readonly (string | number)[] | undefined,
  right: readonly (string | number)[] | undefined,
): boolean {
  if (left === undefined || left.length === 0) return right === undefined || right.length === 0;
  if (right === undefined || left.length !== right.length) return false;
  return left.every((part, index) => part === right[index]);
}

export function hasGrant(context: AgentHostContext, grant: OperationGrant): boolean {
  return context.grants.includes(grant);
}

export function stateOutcome(
  state: BindingFailureState,
  diagnostics: readonly Diagnostic[],
): Outcome<AgentBindingOutcome> {
  const checked = parseContract('binding-outcome', {
    state,
    diagnostics:
      diagnostics.length === 0 ? [diagnostic('agent.failure', 'The proposal could not be bound.')] : diagnostics,
  });
  if (checked.ok) return checked;
  return failure('agent.internal', 'The runtime produced an invalid binding diagnostic.');
}

export function inspectionState(outcome: Outcome<AgentBindingOutcome>): InspectionFailure {
  if (!outcome.ok) return { ok: false, diagnostics: outcome.diagnostics };
  return {
    ok: false,
    diagnostics: [diagnostic('agent.internal', 'The binding state was unexpectedly successful.')],
    state: outcome.value,
  };
}

export function boundOutcome(task: Task): Outcome<AgentBindingOutcome> {
  const checked = parseContract('binding-outcome', {
    state: 'bound',
    value: task,
    interpretation: 'Task structure and supported query semantics are bound; no effect was executed.',
    assumptions: [
      'Business intent remains a residual application risk.',
      'Evaluation and presentation are separate authorized operations.',
    ],
  });
  if (checked.ok) return checked;
  return failure('agent.internal', 'The runtime produced an invalid bound Task.');
}

export function decisionOutcome(decision: AgentBindingDecision): Outcome<AgentBindingOutcome> {
  if (decision.state === 'needs-choice') {
    const checked = parseContract('binding-outcome', { state: 'needs-choice', choices: decision.choices });
    if (checked.ok) return checked;
  } else {
    const checked = parseContract('binding-outcome', {
      state: 'needs-meaning',
      concept: decision.concept,
      authoringRoutes: decision.authoringRoutes,
    });
    if (checked.ok) return checked;
  }
  return stateOutcome('invalid', [diagnostic('agent.host-decision', 'The host binding decision is malformed.')]);
}

export function decisionFor(item: Diagnostic, context: NormalizedHostContext): AgentBindingDecision | undefined {
  return context.decisions?.find(
    (candidate) =>
      candidate.scope === 'diagnostic' &&
      candidate.goalEpoch === context.goalEpoch &&
      candidate.diagnosticCode === item.code &&
      samePath(candidate.diagnosticPath, item.path),
  );
}

export function goalDecision(context: NormalizedHostContext): AgentBindingDecision | undefined {
  return context.decisions?.find(
    (candidate) => candidate.scope === 'goal' && candidate.goalEpoch === context.goalEpoch,
  );
}
