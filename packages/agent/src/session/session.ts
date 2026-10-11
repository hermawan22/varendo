import type { AgentSession, AgentSessionOptions, AgentSessionRunInput } from './types.js';
import { runSession } from './run.js';
import { cancelSession, createSessionState, disposeSession, inspectSession } from './state.js';

/** Session orchestration is transport-neutral and dispatches one operation at a time. */
export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const state = createSessionState(options);
  return Object.freeze({
    run: (input: AgentSessionRunInput) => runSession(state, input),
    cancel: (reason?: string) => cancelSession(state, reason),
    inspect: () => inspectSession(state),
    dispose: () => disposeSession(state),
  });
}

export const runAgentSession = (session: AgentSession, input: AgentSessionRunInput) => session.run(input);
