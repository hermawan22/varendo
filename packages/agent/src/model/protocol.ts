import type { ToolModelRequest, ToolModelResponse } from './types.js';

/** Features implemented by a wire adapter, not a statement about vendor trust. */
export type ToolModelCapability =
  'tool-calls' | 'usage' | 'request-cancellation' | 'input-token-estimate' | 'request-retry';

export interface ToolModelAdapterRequest {
  readonly request: ToolModelRequest;
  readonly model: string;
}

export interface ToolModelResponseContext {
  readonly model: string;
  readonly estimatedInputTokens: number;
}

/**
 * A wire protocol adapter is deliberately independent of provider identity.
 * The connection supplies secret/auth/base URL/policy; the adapter only maps
 * normalized tool-loop messages to one protocol and back.
 */
export interface ToolModelProtocolAdapter {
  readonly id: string;
  readonly endpointPath: string;
  readonly capabilities: readonly ToolModelCapability[];
  readonly encodeRequest: (input: ToolModelAdapterRequest) => unknown;
  readonly estimateInputTokens: (request: ToolModelRequest) => number;
  readonly decodeResponse: (input: unknown, context: ToolModelResponseContext) => ToolModelResponse;
}
