import { parseContract, type Outcome, type Task, type VersionRef } from '@varendo/core';
import type { AgentBindingOutcome, AgentTaskProposal } from '@varendo/core/agent';
import type { AgentBinder } from '../binder-types.js';
import type { AgentCapabilityContext, AgentCapabilityHandlerResult, AgentCapabilityManifest } from './types.js';

const DEFAULT_REF: VersionRef = Object.freeze({ id: 'aeliqo.task.binding', revision: '1' });

function stateResult(outcome: AgentBindingOutcome): AgentCapabilityHandlerResult<Task | AgentBindingOutcome> {
  switch (outcome.state) {
    case 'bound':
      return { state: 'bound', value: outcome.value };
    case 'needs-choice':
      return { state: 'needs-choice', value: outcome, diagnostics: [] };
    case 'needs-meaning':
      return { state: 'needs-meaning', value: outcome, diagnostics: [] };
    default:
      return { state: outcome.state, diagnostics: outcome.diagnostics };
  }
}

/** Adapter for the production binder. It deliberately performs no query or
 * presentation effect, so task proposal and task evaluation remain separate
 * registered operations. */
export function createTaskBindingCapability(options: {
  readonly binder: AgentBinder;
  readonly ref?: VersionRef;
}): AgentCapabilityManifest<AgentTaskProposal, Task | AgentBindingOutcome> {
  if (
    options === null ||
    typeof options !== 'object' ||
    options.binder === null ||
    typeof options.binder?.bind !== 'function'
  )
    throw new TypeError('A task binder is required.');
  const ref = options.ref ?? DEFAULT_REF;
  return Object.freeze({
    ref: Object.freeze({ id: ref.id, revision: ref.revision }),
    operation: 'task.propose' as const,
    label: 'Bind a typed task proposal',
    description:
      'Validate a bounded task proposal against the current host authority without evaluating or presenting it.',
    parse(input: unknown): Outcome<AgentTaskProposal> {
      return parseContract('task-proposal', input);
    },
    async invoke(
      input: AgentTaskProposal,
      context: AgentCapabilityContext,
    ): Promise<AgentCapabilityHandlerResult<Task | AgentBindingOutcome>> {
      let result: Awaited<ReturnType<AgentBinder['bind']>>;
      try {
        result = await options.binder.bind(input, { signal: context.signal, goalEpoch: context.goalEpoch });
      } catch {
        return {
          state: 'failed',
          diagnostics: [{ code: 'agent.task.binding', message: 'Task binding failed safely.', retryable: false }],
        };
      }
      if (!result.ok) return { state: 'invalid', diagnostics: result.diagnostics };
      return stateResult(result.value) as AgentCapabilityHandlerResult<Task | AgentBindingOutcome>;
    },
  });
}
