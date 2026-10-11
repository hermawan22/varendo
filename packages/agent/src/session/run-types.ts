import type { Diagnostic } from '@varendo/core';
import type { AgentCapabilityReceipt, AgentCapabilityRequest } from '../capabilities/types.js';
import type { AgentSessionRunInput, AgentSessionAttempt } from './types.js';
import type { AgentSessionState } from './state.js';

export interface SessionRunContext {
  readonly state: AgentSessionState;
  readonly input: AgentSessionRunInput;
  readonly budget: SessionBudget;
  readonly request: AgentCapabilityRequest;
  readonly controller: AbortController;
  readonly parent: AbortSignal | undefined;
  readonly removeParentAbort: (() => void) | undefined;
  readonly start: number;
  readonly attempts: AgentSessionAttempt[];
  candidate: unknown;
  previousFingerprint: string | undefined;
  last: AgentCapabilityReceipt | undefined;
  diagnostics: readonly Diagnostic[];
  repairs: number;
}

export interface SessionBudget {
  readonly maxTurns: number;
  readonly maxRepairs: number;
  readonly maxMilliseconds: number;
  readonly maxProposalBytes: number;
}
