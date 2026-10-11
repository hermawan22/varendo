import type { ToolModelPort, ToolModelRequest } from './types.js';
import { normalizeToolModelConnection } from './connection-config.js';
import { completeToolModelRequest, estimateToolModelTokens } from './connection-http.js';

export { createOpaqueModelSecret } from './auth-handle.js';
export { ToolModelProviderError, isToolModelProviderError } from './connection-error.js';
export { withToolModelCost } from './connection-cost.js';
export type {
  ModelExecutionEnvironment,
  OpaqueModelSecret,
  ToolModelAuth,
  ToolModelAuthScheme,
  ToolModelConnectionBudget,
  ToolModelConnectionOptions,
  ToolModelConnectionPolicy,
  ToolModelCostPolicy,
  ToolModelFetch,
  ToolModelProviderErrorKind,
  ToolModelProviderObservation,
  ToolModelRetryPolicy,
} from './connection-types.js';

/** Build a server-only transport around any validated protocol adapter. */
export function createToolModelConnection(
  options: import('./connection-types.js').ToolModelConnectionOptions,
): ToolModelPort {
  const config = normalizeToolModelConnection(options);
  return Object.freeze({
    estimateInputTokens: (request: ToolModelRequest) => estimateToolModelTokens(config, request),
    complete: (request: ToolModelRequest, input: { readonly signal: AbortSignal }) =>
      completeToolModelRequest(config, request, input.signal),
  });
}
