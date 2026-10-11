import type { Contract } from '../types.js';

/** Host-owned grants are independent. Wire proposals never carry this authority. */
export type OperationGrant = Contract<'operation-grant'>;
export type AgentTaskProposal = Contract<'task-proposal'>;
export type AgentBindingOutcome = Contract<'binding-outcome'>;
export type AgentLoopBudget = Contract<'agent-loop-budget'>;
export type AgentStopReason = Contract<'agent-stop-reason'>;
export type NarrativeClaim = Contract<'narrative-claim'>;
export type NarrativeCell = Extract<NarrativeClaim, { readonly kind: 'value' }>['cell'];
