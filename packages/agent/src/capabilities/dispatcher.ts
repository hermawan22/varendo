import type {
  AgentCapabilityDispatcher,
  AgentCapabilityDispatcherOptions,
  AgentCapabilityPort,
  AgentCapabilityRequest,
  AgentCapabilityTransport,
} from './types.js';
import { createDispatchConfiguration, type PendingDispatches } from './dispatcher-config.js';
import { dispatchCapability } from './dispatcher-flow.js';

export { normalizeAgentCapabilityRequest } from './dispatcher-input.js';
export { awaitAgentBoundary } from './dispatcher-boundary.js';
export { canonical as capabilityCanonical } from './dispatcher-common.js';
export { normalizeAgentCapabilityAuthority } from './dispatcher-input.js';

function createPort(
  transport: AgentCapabilityTransport,
  dispatch: AgentCapabilityDispatcher['dispatch'],
): AgentCapabilityPort {
  return Object.freeze({
    transport,
    invoke(input: AgentCapabilityRequest | unknown, options: { readonly signal?: AbortSignal } = {}) {
      return dispatch(input, { ...options, transport });
    },
  });
}

export function createAgentCapabilityDispatcher(options: AgentCapabilityDispatcherOptions): AgentCapabilityDispatcher {
  const configuration = createDispatchConfiguration(options);
  const pending: PendingDispatches = { count: 0 };
  const dispatch: AgentCapabilityDispatcher['dispatch'] = (input, dispatchOptions = {}) =>
    dispatchCapability(input, dispatchOptions, configuration, pending);
  const port: AgentCapabilityDispatcher['port'] = (transport) => createPort(transport, dispatch);
  const direct = port('direct');
  const manual = port('manual');
  const mcp = port('mcp');
  const webmcp = port('webmcp');
  const byok = port('byok');
  return Object.freeze({ dispatch, port, manual, tool: mcp, direct, mcp, webmcp, byok, pending: () => pending.count });
}

export function dispatchAgentCapability(
  input: AgentCapabilityRequest | unknown,
  options: AgentCapabilityDispatcherOptions,
  dispatchOptions?: { readonly signal?: AbortSignal; readonly transport?: AgentCapabilityTransport },
) {
  return createAgentCapabilityDispatcher(options).dispatch(input, dispatchOptions);
}
