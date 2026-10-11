import { type Diagnostic, type Outcome, type ResultRef, type Task } from '@varendo/core';
import type { AgentTaskProposal } from '@varendo/core/agent';
import type { QueryPlanner } from '@varendo/core/query';
import {
  GRANT_RESULT_INSPECT,
  diagnostic,
  hasGrant,
  inspectionState,
  decisionFor,
  decisionOutcome,
  stateOutcome,
  sameResultRef,
} from './common.js';
import type { InspectionFailure, NormalizedHostContext, ValidatedProposal } from './types.js';

export type TaskValidation =
  | { readonly ok: true; readonly plans: ValidatedProposal['plans'] }
  | { readonly ok: false; readonly failure: InspectionFailure };

function validateRequiredResults(refs: readonly ResultRef[], context: NormalizedHostContext): Outcome<void> {
  const available = context.current.results;
  for (const ref of refs) {
    if (
      ref.scopeDigest !== context.current.scopeDigest ||
      !available.some((candidate) => sameResultRef(candidate, ref))
    ) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('agent.stale', 'A referenced result is no longer available in the current authority scope.'),
        ],
      };
    }
  }
  return { ok: true, value: undefined };
}

function isUnsupportedQuery(item: Diagnostic | undefined): boolean {
  if (item === undefined) return false;
  return item.code === 'query.meaning' || item.code.startsWith('query.unsupported');
}

function plannerFailure(
  result: Extract<ReturnType<QueryPlanner['plan']>, { readonly ok: false }>,
  context: NormalizedHostContext,
): InspectionFailure {
  const first = result.diagnostics[0];
  const decision = first === undefined ? undefined : decisionFor(first, context);
  if (decision !== undefined) return inspectionState(decisionOutcome(decision));
  if (first?.code.startsWith('query.stale')) return inspectionState(stateOutcome('stale', result.diagnostics));
  if (isUnsupportedQuery(first)) return inspectionState(stateOutcome('unsupported', result.diagnostics));
  return inspectionState(stateOutcome('invalid', result.diagnostics));
}

function taskIdentityFailure(
  proposal: AgentTaskProposal,
  task: Task,
  context: NormalizedHostContext,
): InspectionFailure | undefined {
  if (task.regionId !== proposal.targetRegionId || task.regionId !== context.regionId)
    return inspectionState(
      stateOutcome('stale', [
        diagnostic('agent.stale-region', 'The Task region does not match the authorized target region.'),
      ]),
    );
  if (task.revision !== context.current.taskRevision)
    return inspectionState(
      stateOutcome('stale', [
        diagnostic('agent.stale-task', 'The Task revision does not match the current host task revision.'),
      ]),
    );
  if (
    task.catalogRevision !== context.current.catalogRevision ||
    task.functionRegistryDigest !== context.current.functionRegistryDigest
  )
    return inspectionState(
      stateOutcome('stale', [diagnostic('agent.stale-pins', 'The Task catalog or function registry pin is stale.')]),
    );
  return undefined;
}

function resultAccessFailure(
  refs: readonly ResultRef[],
  context: NormalizedHostContext,
): InspectionFailure | undefined {
  const required = validateRequiredResults(refs, context);
  if (!required.ok) return inspectionState(stateOutcome('stale', required.diagnostics));
  if (refs.length > 0 && !hasGrant(context, GRANT_RESULT_INSPECT))
    return inspectionState(
      stateOutcome('denied', [
        diagnostic(
          'agent.denied-result-inspect',
          'The host did not grant result inspection for the referenced population.',
        ),
      ]),
    );
  return undefined;
}

function unsupportedForm(task: Task): InspectionFailure | undefined {
  if (task.kind !== 'form') return undefined;
  return inspectionState(
    stateOutcome('unsupported', [
      diagnostic('agent.form-unsupported', 'Form action binding is owned by the action and meaning dispatcher.'),
    ]),
  );
}

function planDataOutputs(task: Task, context: NormalizedHostContext): TaskValidation {
  const plans: { outputId: string; canonical: string; planKey: string }[] = [];
  if (task.kind !== 'data') return { ok: true, plans };
  for (const output of task.outputs) {
    if (output.kind === 'reuse') continue;
    if (output.query.population.kind !== 'all-authorized')
      return {
        ok: false,
        failure: inspectionState(
          stateOutcome('unsupported', [
            diagnostic(
              'agent.population-unsupported',
              'Fixed and live populations require an authorized result lineage and are not rewritten during binding.',
              ['outputs', output.id, 'query', 'population'],
            ),
          ]),
        ),
      };
    const planned = context.planner.plan(output.query);
    if (!planned.ok) return { ok: false, failure: plannerFailure(planned, context) };
    plans.push({ outputId: output.id, canonical: planned.value.canonical, planKey: planned.value.planKey });
  }
  return { ok: true, plans };
}

export function validateTaskSemantics(
  proposal: AgentTaskProposal,
  task: Task,
  structure: ValidatedProposal['structure'],
  context: NormalizedHostContext,
): TaskValidation {
  const identity = taskIdentityFailure(proposal, task, context);
  if (identity !== undefined) return { ok: false, failure: identity };
  const access = resultAccessFailure(structure.resultReferences, context);
  if (access !== undefined) return { ok: false, failure: access };
  const form = unsupportedForm(task);
  if (form !== undefined) return { ok: false, failure: form };
  return planDataOutputs(task, context);
}
