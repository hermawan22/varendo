import type { Outcome } from '@varendo/core';
import type {
  AgentCapabilityAuthority,
  AgentCapabilityContext,
  AgentCapabilityManifest,
  AgentCapabilityReceipt,
  AgentCapabilityRequest,
  AgentCapabilityTransport,
} from './types.js';

export type ReceiptOutcome = Outcome<AgentCapabilityReceipt>;

export type FlowStep<T> =
  { readonly kind: 'ready'; readonly value: T } | { readonly kind: 'finished'; readonly result: ReceiptOutcome };

export interface PreparedDispatch {
  readonly request: AgentCapabilityRequest;
  readonly transport: AgentCapabilityTransport;
  readonly manifest: AgentCapabilityManifest<unknown, unknown>;
}

export interface AuthorizedCapability {
  readonly authority: AgentCapabilityAuthority;
  readonly context: AgentCapabilityContext;
  readonly input: unknown;
}

export function flowReady<T>(value: T): FlowStep<T> {
  return { kind: 'ready', value };
}

export function flowFinished<T = never>(result: ReceiptOutcome): FlowStep<T> {
  return { kind: 'finished', result };
}
