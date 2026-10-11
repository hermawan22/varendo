import { parseContract, validateCommitReadSet, validateTaskStructure } from '@varendo/core';
import type { AgentTaskProposal } from '@varendo/core/agent';
import type { QueryLimits } from '@varendo/core/query';
import type { AgentBindOptions, AgentBinderOptions } from '../binder-types.js';
import {
  GRANT_CATALOG_READ,
  GRANT_TASK_PROPOSE,
  failure,
  goalDecision,
  hasGrant,
  inspectionState,
  decisionOutcome,
} from './common.js';
import { authorityKey } from './fingerprint.js';
import { normalizeHost } from './host.js';
import { readHost } from './read-host.js';
import { validateTaskSemantics } from './task.js';
import type { Inspection, InspectionFailure, NormalizedHostContext, ValidatedProposal } from './types.js';

interface InitialInspection {
  readonly proposal: AgentTaskProposal;
  readonly task: ValidatedProposal['task'];
  readonly structure: ValidatedProposal['structure'];
  readonly context: NormalizedHostContext;
}

function hostGoalMatches(goalEpoch: string | undefined, context: NormalizedHostContext): boolean {
  return goalEpoch === undefined || goalEpoch === context.goalEpoch;
}

function hostHasBindingGrants(context: NormalizedHostContext): boolean {
  return hasGrant(context, GRANT_TASK_PROPOSE) && hasGrant(context, GRANT_CATALOG_READ);
}

async function inspectInitial(
  proposal: AgentTaskProposal,
  bindOptions: AgentBindOptions,
  host: AgentBinderOptions['host'],
  queryLimits: Partial<QueryLimits> | undefined,
): Promise<Inspection | InitialInspection> {
  const signal = bindOptions.signal ?? new AbortController().signal;
  const hostResult = await readHost(host, proposal, signal);
  if (!hostResult.ok) return hostResult;
  const context = normalizeHost(hostResult.value, queryLimits);
  if (!context.ok) return context;
  if (!hostGoalMatches(bindOptions.goalEpoch, context.value))
    return failure('agent.stale-epoch', 'The agent goal epoch changed before binding.');
  if (!hostHasBindingGrants(context.value))
    return failure('agent.denied', 'The host did not grant Task proposal and catalog binding.');
  if (proposal.effect !== 'read')
    return failure('agent.unsupported', 'This binder accepts only no-effect read Task proposals.');
  const structure = validateTaskStructure(proposal.value);
  if (!structure.ok) return structure;
  const readSet = validateCommitReadSet(
    proposal.preconditions,
    context.value.current,
    structure.value.resultReferences,
  );
  if (!readSet.ok) return readSet;
  const semantics = validateTaskSemantics(proposal, structure.value.task, structure.value, context.value);
  if (!semantics.ok) return semantics.failure;
  return {
    proposal,
    task: structure.value.task,
    structure: structure.value,
    context: context.value,
  };
}

function refreshedReadSet(initial: InitialInspection, context: NormalizedHostContext): InspectionFailure | undefined {
  const checked = validateCommitReadSet(
    initial.proposal.preconditions,
    context.current,
    initial.structure.resultReferences,
  );
  return checked.ok ? undefined : checked;
}

async function inspectFresh(
  initial: InitialInspection,
  bindOptions: AgentBindOptions,
  host: AgentBinderOptions['host'],
  queryLimits: Partial<QueryLimits> | undefined,
): Promise<Inspection> {
  const signal = bindOptions.signal ?? new AbortController().signal;
  const hostResult = await readHost(host, initial.proposal, signal);
  if (!hostResult.ok) return hostResult;
  const fresh = normalizeHost(hostResult.value, queryLimits);
  if (!fresh.ok) return fresh;
  if (authorityKey(initial.context) !== authorityKey(fresh.value))
    return failure('agent.stale-authority', 'Host authority changed while the proposal was being inspected.');
  if (!hostGoalMatches(bindOptions.goalEpoch, fresh.value))
    return failure('agent.stale-epoch', 'The agent goal epoch changed before binding.');
  const readSet = refreshedReadSet(initial, fresh.value);
  if (readSet !== undefined) return readSet;
  const semantics = validateTaskSemantics(initial.proposal, initial.task, initial.structure, fresh.value);
  if (!semantics.ok) return semantics.failure;
  const materialDecision = goalDecision(fresh.value);
  if (materialDecision !== undefined) return inspectionState(decisionOutcome(materialDecision));
  return {
    ok: true,
    value: {
      proposal: initial.proposal,
      task: initial.task,
      structure: initial.structure,
      context: fresh.value,
      plans: semantics.plans,
    },
  };
}

function initialInspectionFailure(value: Inspection | InitialInspection): value is Inspection {
  return 'ok' in value;
}

export async function inspectProposal(
  input: unknown,
  bindOptions: AgentBindOptions,
  host: AgentBinderOptions['host'],
  queryLimits: Partial<QueryLimits> | undefined,
): Promise<Inspection> {
  const parsed = parseContract('task-proposal', input);
  if (!parsed.ok) return parsed;
  if (bindOptions.signal?.aborted) return failure('agent.cancelled', 'Agent binding was cancelled.');
  const initial = await inspectInitial(parsed.value, bindOptions, host, queryLimits);
  if (initialInspectionFailure(initial)) return initial;
  return inspectFresh(initial, bindOptions, host, queryLimits);
}
