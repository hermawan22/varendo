import type { AgentBindingOutcome, OperationGrant } from '@varendo/core/agent';
import type { CommitPreconditions, Diagnostic, Outcome, ResultRef, VersionRef } from '@varendo/core';

/** Local public alias because @varendo/core intentionally keeps the wire value
 * helper internal to its contract barrel. */
export type AgentJsonValue =
  null | boolean | number | string | readonly AgentJsonValue[] | { readonly [key: string]: AgentJsonValue };

/** The operation families are deliberately the same independent grants used by
 * the binder.  A transport or model label never widens this union. */
export type AgentCapabilityOperation = OperationGrant;

export type AgentCapabilityTransport = 'direct' | 'manual' | 'mcp' | 'webmcp' | 'byok';

export type AgentCapabilityState =
  | 'accepted'
  | 'bound'
  | 'data-ready'
  | 'plan-committed'
  | 'renderer-ready'
  | 'partial'
  | 'cancelled'
  | 'failed'
  | 'denied'
  | 'stale'
  | 'unsupported'
  | 'invalid'
  | 'needs-choice'
  | 'needs-meaning';

export interface AgentCapabilityLimits {
  /** Maximum wire bytes accepted for one capability input. */
  readonly maxInputBytes?: number;
  /** Maximum wire bytes accepted for one handler result. */
  readonly maxOutputBytes?: number;
}

/** Host authority is intentionally small.  Rich catalog/task authority can be
 * exposed through a trusted host closure or the existing AgentHostContext; it
 * is never copied from the request. */
export interface AgentCapabilityAuthority {
  readonly principalKey: string;
  readonly regionId: string;
  readonly goalEpoch: string;
  readonly grants: readonly OperationGrant[];
  /** Optional host-owned pins for handlers which need a fuller context. */
  readonly current?: CommitPreconditions;
  readonly context?: AgentJsonValue;
}

export interface AgentCapabilityContext {
  readonly requestId: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly signal: AbortSignal;
  readonly transport: AgentCapabilityTransport;
  readonly authority: AgentCapabilityAuthority;
}

/** A trusted local handler returns a bounded, effect-specific stage. */
export interface AgentCapabilityHandlerResult<TOutput = AgentJsonValue> {
  readonly state: AgentCapabilityState;
  readonly value?: TOutput;
  readonly diagnostics?: readonly Diagnostic[];
  readonly affectedResults?: readonly ResultRef[];
  /** Required for renderer-ready receipts; the dispatcher never invents it. */
  readonly regionRevision?: string;
  /** Optional trusted explanation for a partial/recovery stage. */
  readonly reason?: string;
}

export type AgentCapabilityHandlerOutcome<TOutput = AgentJsonValue> =
  AgentCapabilityHandlerResult<TOutput> | Outcome<AgentCapabilityHandlerResult<TOutput>>;

/** Registration is host code, never a model operation. */
export interface AgentCapabilityManifest<TInput = AgentJsonValue, TOutput = AgentJsonValue> {
  readonly ref: VersionRef;
  readonly operation: AgentCapabilityOperation;
  readonly label: string;
  readonly description?: string;
  readonly limits?: AgentCapabilityLimits;
  /** Converts untrusted wire data into the handler's typed input. */
  readonly parse: (input: unknown) => Outcome<TInput>;
  /** Executes one already-authorized capability call. */
  readonly invoke: (
    input: TInput,
    context: AgentCapabilityContext,
  ) => AgentCapabilityHandlerOutcome<TOutput> | Promise<AgentCapabilityHandlerOutcome<TOutput>>;
}

export interface AgentCapabilityRequest {
  readonly version: '1';
  readonly requestId: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly capability: VersionRef;
  readonly operation: AgentCapabilityOperation;
  readonly input: unknown;
  /** Advisory only. It is never used to choose the trusted transport, derive grants, actor or approval. */
  readonly metadata?: unknown;
  /** Untrusted wire metadata. Ports and trusted dispatch options choose the actual transport. */
  readonly transport?: AgentCapabilityTransport;
}

export interface AgentCapabilityHostContext {
  readonly principalKey: string;
  readonly regionId: string;
  readonly goalEpoch: string;
  readonly grants: readonly OperationGrant[];
  readonly current?: CommitPreconditions;
  readonly context?: AgentJsonValue;
}

export interface AgentCapabilityContextRequest {
  readonly requestId: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly signal: AbortSignal;
}

export interface AgentCapabilityHost {
  readonly readContext: (
    input: AgentCapabilityContextRequest,
  ) => Outcome<AgentCapabilityHostContext> | Promise<Outcome<AgentCapabilityHostContext>>;
}

export interface AgentCapabilityReceipt {
  readonly version: '1';
  readonly requestId: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly capability: VersionRef;
  readonly operation: AgentCapabilityOperation;
  readonly transport: AgentCapabilityTransport;
  /** State and status are aliases so inspector consumers need no inference. */
  readonly state: AgentCapabilityState;
  readonly status: AgentCapabilityState;
  readonly stage: AgentCapabilityState;
  readonly value?: AgentJsonValue;
  readonly diagnostics: readonly Diagnostic[];
  readonly affectedResults?: readonly ResultRef[];
  readonly regionRevision?: string;
  readonly reason?: string;
  /** Metadata is advisory and bounded; it is never an authority token. */
  readonly metadata?: AgentJsonValue;
}

export interface AgentCapabilityDispatcherOptions {
  readonly host: AgentCapabilityHost;
  readonly registry: AgentCapabilityRegistry;
  readonly maxPending?: number;
  readonly maxMilliseconds?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
}

export interface AgentCapabilityDispatcher {
  readonly dispatch: (
    input: AgentCapabilityRequest | unknown,
    options?: { readonly signal?: AbortSignal; readonly transport?: AgentCapabilityTransport },
  ) => Promise<Outcome<AgentCapabilityReceipt>>;
  /** All adapters call the same dispatch implementation. */
  readonly port: (transport: AgentCapabilityTransport) => AgentCapabilityPort;
  readonly manual: AgentCapabilityPort;
  readonly tool: AgentCapabilityPort;
  readonly direct: AgentCapabilityPort;
  readonly mcp: AgentCapabilityPort;
  readonly webmcp: AgentCapabilityPort;
  readonly byok: AgentCapabilityPort;
  readonly pending: () => number;
}

export interface AgentCapabilityPort {
  readonly transport: AgentCapabilityTransport;
  readonly invoke: (
    input: AgentCapabilityRequest | unknown,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Outcome<AgentCapabilityReceipt>>;
}

export interface AgentCapabilityRegistry {
  readonly register: <TInput, TOutput>(manifest: AgentCapabilityManifest<TInput, TOutput>) => Outcome<void>;
  /** Registered handlers cross the untrusted dispatcher boundary as unknown;
   * each manifest's parser establishes its concrete input type. */
  readonly get: (ref: VersionRef) => AgentCapabilityManifest<unknown, unknown> | undefined;
  readonly list: () => readonly AgentCapabilityManifest<unknown, unknown>[];
}

/** Common result values for the task-binding capability. */
export type AgentTaskBindingResult = Extract<AgentBindingOutcome, { readonly state: 'bound' }>['value'];
