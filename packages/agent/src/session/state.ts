import type { AgentSessionOptions, AgentSessionSnapshot } from './types.js';
import type { AgentSessionReceipt, AgentSessionAttempt } from './types.js';

export interface AgentSessionState {
  readonly options: AgentSessionOptions;
  readonly now: () => number;
  readonly transport: NonNullable<AgentSessionOptions['transport']>;
  status: AgentSessionSnapshot['status'];
  active: AbortController | undefined;
  attempts: readonly AgentSessionAttempt[];
  receipt: AgentSessionReceipt | undefined;
  requestId: string | undefined;
  closed: boolean;
}

const transports = new Set(['direct', 'manual', 'mcp', 'webmcp', 'byok']);

function hasDispatcher(options: AgentSessionOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    options.dispatcher !== null &&
    typeof options.dispatcher?.dispatch === 'function'
  );
}

export function createSessionState(options: AgentSessionOptions): AgentSessionState {
  if (!hasDispatcher(options)) throw new TypeError('A capability dispatcher is required.');
  const transport = options.transport ?? 'direct';
  if (!transports.has(transport)) throw new TypeError('A valid trusted session transport is required.');
  return {
    options,
    now: options.now ?? Date.now,
    transport,
    status: 'idle',
    active: undefined,
    attempts: Object.freeze([]),
    receipt: undefined,
    requestId: undefined,
    closed: false,
  };
}

export function inspectSession(state: AgentSessionState): AgentSessionSnapshot {
  return Object.freeze({
    status: state.status,
    ...(state.requestId === undefined ? {} : { requestId: state.requestId }),
    attempts: Object.freeze([...state.attempts]),
    ...(state.receipt === undefined ? {} : { receipt: state.receipt }),
  });
}

export function cancelSession(state: AgentSessionState, reason?: string): boolean {
  if (state.active === undefined) return false;
  state.active.abort(reason);
  return true;
}

export function disposeSession(state: AgentSessionState): void {
  if (state.closed) return;
  state.closed = true;
  state.active?.abort('disposed');
  state.active = undefined;
  state.status = 'closed';
  state.attempts = Object.freeze([]);
  state.receipt = undefined;
  state.requestId = undefined;
}
