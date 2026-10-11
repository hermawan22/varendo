import type { AgentLoopBudget, AgentStopReason } from '@varendo/core/agent';
import type { Diagnostic, Outcome, ResultRef } from '@varendo/core';
import type {
  AgentCapabilityReceipt,
  AgentCapabilityRequest,
  AgentCapabilityTransport,
} from '../capabilities/types.js';

export type AgentSessionAttemptProgress = 'new' | 'gap-closed' | 'scope-changed' | 'none';

/** Compact, inspectable metadata. It intentionally excludes transcripts and
 * private model reasoning. */
export interface AgentSessionAttempt {
  readonly turn: number;
  readonly state: AgentCapabilityReceipt['state'];
  readonly fingerprint: string;
  readonly proposalBytes: number;
  readonly progress: AgentSessionAttemptProgress;
  readonly receipt?: AgentCapabilityReceipt;
}

export interface AgentSessionRepairRequest {
  readonly turn: number;
  readonly previous: readonly Omit<AgentSessionAttempt, 'receipt'>[];
  readonly diagnostics: readonly Diagnostic[];
  readonly signal: AbortSignal;
}

export interface AgentSessionIncumbent {
  readonly regionRevision?: string;
  readonly results?: readonly ResultRef[];
}

export type AgentRecoveryState = 'preserved-incumbent' | 'cleared-revoked' | 'manual-required';

export interface AgentRecoveryReceipt {
  readonly state: AgentRecoveryState;
  readonly reason: string;
  readonly safeToRetry: boolean;
  readonly regionRevision?: string;
  readonly results?: readonly ResultRef[];
}

export interface AgentSessionRunInput {
  readonly request: AgentCapabilityRequest;
  readonly budget: AgentLoopBudget;
  readonly signal?: AbortSignal;
  /** Optional bounded repair provider. It receives diagnostics only. */
  readonly propose?: (input: AgentSessionRepairRequest) => unknown | Promise<unknown>;
  readonly incumbent?: AgentSessionIncumbent;
}

export interface AgentSessionReceipt {
  readonly version: '1';
  readonly requestId: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly capability: AgentCapabilityRequest['capability'];
  readonly operation: AgentCapabilityRequest['operation'];
  readonly transport: AgentCapabilityTransport;
  readonly stop: AgentStopReason;
  readonly attempts: readonly AgentSessionAttempt[];
  readonly last?: AgentCapabilityReceipt;
  readonly recovery?: AgentRecoveryReceipt;
}

export interface AgentSessionSnapshot {
  readonly status: 'idle' | 'running' | 'completed' | 'cancelled' | 'closed';
  readonly requestId?: string;
  readonly attempts: readonly AgentSessionAttempt[];
  readonly receipt?: AgentSessionReceipt;
}

export interface AgentSessionOptions {
  /** Trusted host transport. Wire request metadata cannot change this boundary. */
  readonly transport?: AgentCapabilityTransport;
  readonly dispatcher: import('../capabilities/types.js').AgentCapabilityDispatcher;
  /** Host-owned recovery callback. It must clear data when authority is revoked. */
  readonly recover?: (input: {
    readonly receipt: AgentCapabilityReceipt | undefined;
    readonly incumbent: AgentSessionIncumbent | undefined;
    readonly signal: AbortSignal;
  }) => Outcome<AgentRecoveryReceipt> | Promise<Outcome<AgentRecoveryReceipt>>;
  readonly now?: () => number;
}

export interface AgentSession {
  readonly run: (input: AgentSessionRunInput) => Promise<Outcome<AgentSessionReceipt>>;
  readonly cancel: (reason?: string) => boolean;
  readonly inspect: () => AgentSessionSnapshot;
  readonly dispose: () => void;
}
