import type { Outcome } from '@varendo/core';
import type {
  AgentCapabilityOperation,
  AgentCapabilityReceipt,
  AgentCapabilityState,
  AgentJsonValue,
} from '../capabilities/types.js';
import type { AgentModelToolEndpoint, AgentToolDefinition } from '../protocol/types.js';

declare const opaqueModelContinuationBrand: unique symbol;
/** In-memory protocol state. Its provider value is non-enumerable and never serializable. */
export interface ToolModelContinuation {
  readonly kind: 'opaque-model-continuation';
  readonly bytes: number;
  readonly [opaqueModelContinuationBrand]: true;
}

export type ToolModelMessage =
  | { readonly role: 'system'; readonly text: string }
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant';
      readonly text?: string;
      readonly calls: readonly ToolModelCall[];
      readonly continuation?: ToolModelContinuation;
    }
  | { readonly role: 'tool'; readonly callId: string; readonly output: AgentJsonValue };
export interface ToolModelCall {
  readonly id: string;
  readonly name: string;
  readonly input: AgentJsonValue;
}
export type ToolModelTokenSource = 'provider' | 'estimated';
export interface ToolModelCost {
  readonly currency: string;
  readonly estimatedUSD?: number;
  readonly inputUSDPerMillion?: number;
  readonly outputUSDPerMillion?: number;
  readonly source?: string;
}
export interface ToolModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly inputTokenSource?: ToolModelTokenSource;
  readonly outputTokenSource?: ToolModelTokenSource;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  /** This is a host-side estimate unless the provider explicitly reports a charge. */
  readonly cost?: ToolModelCost;
}
export interface ToolModelProviderSnapshot {
  /** Protocol identity, not a vendor name or trust level. */
  readonly protocol: string;
  readonly model?: string;
  readonly responseId?: string;
  readonly usage: ToolModelUsage;
}
export interface ToolModelRequest {
  readonly messages: readonly ToolModelMessage[];
  readonly tools: readonly AgentToolDefinition[];
  /** Provider adherence hint only. The loop/dispatcher remain authoritative. */
  readonly toolChoice?: 'auto' | 'required';
  readonly maxOutputTokens: number;
}
export interface ToolModelResponse {
  /** Unverified model prose. Hosts must apply their claim/evidence policy before display. */
  readonly text?: string;
  readonly calls: readonly ToolModelCall[];
  readonly usage: ToolModelUsage;
  /** Opaque in-memory protocol state needed for a subsequent model request. */
  readonly continuation?: ToolModelContinuation;
  /** Sanitized provider metadata; credentials and raw responses never belong here. */
  readonly provider?: ToolModelProviderSnapshot;
}
/**
 * Application-owned model I/O. A host can supply authoritative remote counting,
 * or a bounded local estimate. A model transport is never allowed to require an
 * undocumented counting endpoint merely to make a completion request.
 */
export interface ToolModelPort {
  readonly estimateInputTokens?: (request: ToolModelRequest) => number;
  readonly countInputTokens?: (request: ToolModelRequest, options: { readonly signal: AbortSignal }) => Promise<number>;
  readonly complete: (
    request: ToolModelRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<ToolModelResponse>;
}
export interface ToolModelBudget {
  readonly maxTurns: number;
  readonly maxModelRequests: number;
  readonly maxToolCalls: number;
  readonly maxMilliseconds: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxTotalTokens: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRepeatedCalls: number;
}
export type ToolModelStop =
  | 'text-ready'
  | 'renderer-ready'
  | 'no-commit'
  | 'no-progress'
  | 'required-sequence'
  | 'budget'
  | 'cancelled'
  | 'stale'
  | 'denied'
  | 'failed';
export interface ToolModelRequiredOperation {
  readonly operation: AgentCapabilityOperation;
  readonly acceptedStates: readonly AgentCapabilityState[];
}
export interface ToolModelRunPolicy {
  /** Ordered milestones proven only by trusted dispatcher receipts. */
  readonly requiredOperationSequence: readonly ToolModelRequiredOperation[];
  /** Optional provider adherence hint. Omit for endpoints that reject required tool choice. */
  readonly providerToolChoice?: 'auto' | 'required';
}
export interface ToolModelReceipt {
  readonly stop: ToolModelStop;
  readonly turns: number;
  readonly modelRequests: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** This is a draft, never a verified numerical narrative or business fact. */
  readonly textDraft?: string;
  readonly receipts: readonly AgentCapabilityReceipt[];
  /** Remaining host-required milestones when the run stops before completion. */
  readonly incompleteRequiredOperations?: readonly AgentCapabilityOperation[];
}
export interface ToolModelLoopOptions {
  readonly requestId: string;
  readonly goal: 'chat' | 'experience';
  /** Host-approved text only. The loop does not automatically read page, catalog or host context. */
  readonly prompt: string;
  /** Optional application-owned operating policy; providers cannot grant themselves authority through it. */
  readonly instructions?: string;
  /** Optional host-owned finalization policy. It never grants an operation. */
  readonly policy?: ToolModelRunPolicy;
  readonly endpoint: AgentModelToolEndpoint;
  readonly model: ToolModelPort;
  readonly budget: ToolModelBudget;
  readonly signal?: AbortSignal;
}
export type ToolModelLoopOutcome = Outcome<ToolModelReceipt>;
