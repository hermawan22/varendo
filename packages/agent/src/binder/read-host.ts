import type { AgentTaskProposal } from '@varendo/core/agent';
import type { Outcome } from '@varendo/core';
import type { AgentBinderOptions, AgentHostContext } from '../binder-types.js';
import { failure } from './common.js';

const ABORTED = Symbol('agent-host-aborted');

export async function readHost(
  host: AgentBinderOptions['host'],
  proposal: AgentTaskProposal,
  signal: AbortSignal,
): Promise<Outcome<AgentHostContext>> {
  if (signal.aborted) return failure('agent.cancelled', 'Agent binding was cancelled.');
  let removeAbort = (): void => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
  });
  const work = Promise.resolve().then(async (): Promise<Outcome<AgentHostContext> | typeof ABORTED | undefined> => {
    if (signal.aborted) return ABORTED;
    try {
      return await host.readContext({
        requestId: proposal.requestId,
        targetRegionId: proposal.targetRegionId,
        signal,
      });
    } catch {
      return undefined;
    }
  });
  try {
    const result = await Promise.race([work, aborted]);
    if (result === ABORTED) return failure('agent.cancelled', 'Agent binding was cancelled.');
    if (result === undefined) return failure('agent.denied', 'The host authority context failed safely.');
    return result;
  } finally {
    removeAbort();
  }
}
