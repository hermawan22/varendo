import type { AgentBindingOutcome, AgentLoopBudget, AgentStopReason } from '@varendo/core/agent';
import type { Diagnostic, Outcome } from '@varendo/core';
import type { AgentBinder } from './binder-types.js';

export type AgentAttemptProgress = 'new' | 'gap-closed' | 'scope-changed' | 'none';

/** Bounded metadata; it deliberately excludes transcripts and model internals. */
export interface AgentAttempt {
  readonly turn: number;
  readonly state: AgentBindingOutcome['state'];
  readonly fingerprint: string;
  readonly proposalBytes: number;
  readonly progress: AgentAttemptProgress;
}

export interface AgentRepairRequest {
  readonly turn: number;
  readonly previous: readonly AgentAttempt[];
  readonly diagnostics: readonly Diagnostic[];
  readonly signal: AbortSignal;
}

export interface AgentContainmentInput {
  readonly requestId: string;
  readonly targetRegionId: string;
  /** Captured by the application before the model loop begins. */
  readonly goalEpoch: string;
  readonly budget: AgentLoopBudget;
  readonly signal?: AbortSignal;
  /** Optional first candidate. If absent, the provider is called for turn one. */
  readonly initial?: unknown;
  /** Produces one candidate per repair turn; it receives diagnostics, not authority. */
  readonly propose: (input: AgentRepairRequest) => unknown | Promise<unknown>;
  readonly binder: AgentBinder;
  readonly now?: () => number;
}

export interface AgentContainmentReceipt {
  readonly stop: AgentStopReason;
  readonly attempts: readonly AgentAttempt[];
  readonly outcome?: AgentBindingOutcome;
}

export type AgentContainmentOutcome = Outcome<AgentContainmentReceipt>;
