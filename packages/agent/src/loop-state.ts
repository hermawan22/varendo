import { parseContract, type Diagnostic, type Outcome } from '@varendo/core';
import type { AgentBindingOutcome, AgentLoopBudget, AgentStopReason } from '@varendo/core/agent';
import type { BoundaryResult } from './capabilities/dispatcher-boundary.js';
import type {
  AgentAttempt,
  AgentAttemptProgress,
  AgentContainmentInput,
  AgentContainmentOutcome,
  AgentContainmentReceipt,
} from './loop-types.js';

/** Binding states that continue the loop instead of stopping it. */
const NON_STOP_STATES = new Set<AgentBindingOutcome['state']>(['bound', 'needs-choice', 'needs-meaning']);

/** Boundary failures map to stop reasons; a host signal overrides a failed result, not a deadline. */
const BOUNDARY_STOPS: Readonly<Record<Exclude<BoundaryResult<unknown>['kind'], 'value'>, AgentStopReason>> = {
  deadline: 'time-budget',
  aborted: 'cancelled',
  failed: 'unavailable',
};

/** Binding states that terminate the loop with a receipt. */
const TERMINAL_STOPS: Readonly<Partial<Record<AgentBindingOutcome['state'], AgentStopReason>>> = {
  bound: 'complete',
  'needs-choice': 'needs-choice',
  'needs-meaning': 'needs-meaning',
  unsupported: 'unsupported',
  denied: 'denied',
  stale: 'stale',
};

function diagnostic(code: string, message: string): Diagnostic {
  return { code, message, retryable: false };
}

function safeNow(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

export function elapsed(start: number, now: () => number): number {
  return Math.max(0, safeNow(now) - start);
}

export function receipt(
  stop: AgentStopReason,
  attempts: readonly AgentAttempt[],
  outcome?: AgentBindingOutcome,
): AgentContainmentOutcome {
  const value: AgentContainmentReceipt = Object.freeze({
    stop,
    attempts: Object.freeze([...attempts]),
    ...(outcome === undefined ? {} : { outcome }),
  });
  return { ok: true, value };
}

export function stopOutcome(
  state: AgentBindingOutcome['state'],
  diagnostics?: readonly Diagnostic[],
): AgentBindingOutcome | undefined {
  if (NON_STOP_STATES.has(state)) return undefined;
  const checked = parseContract('binding-outcome', {
    state,
    diagnostics:
      diagnostics === undefined || diagnostics.length === 0
        ? [diagnostic('agent.stop', 'The containment loop stopped before accepting a proposal.')]
        : diagnostics,
  });
  return checked.ok ? checked.value : undefined;
}

interface ContainmentBudget {
  readonly maxTurns: number;
  readonly maxRepairs: number;
  readonly maxMilliseconds: number;
  readonly maxProposalBytes: number;
}

export function normalizeBudget(input: AgentLoopBudget): Outcome<ContainmentBudget> {
  const checked = parseContract('agent-loop-budget', input);
  if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics };
  return { ok: true, value: checked.value as unknown as ContainmentBudget };
}

export interface ContainmentRun {
  readonly input: AgentContainmentInput;
  readonly budget: ContainmentBudget;
  readonly now: () => number;
  readonly start: number;
  readonly attempts: AgentAttempt[];
  candidate: unknown;
  hasCandidate: boolean;
  repairs: number;
  previousFingerprint: string | undefined;
  previousCanonical: string | undefined;
  previousState: AgentBindingOutcome['state'] | undefined;
  lastOutcome: AgentBindingOutcome | undefined;
}

export function createRun(input: AgentContainmentInput, budget: ContainmentBudget): ContainmentRun {
  return {
    input,
    budget,
    now: input.now ?? Date.now,
    start: safeNow(input.now ?? Date.now),
    attempts: [],
    candidate: input.initial,
    hasCandidate: input.initial !== undefined,
    repairs: 0,
    previousFingerprint: undefined,
    previousCanonical: undefined,
    previousState: undefined,
    lastOutcome: undefined,
  };
}

export function loopStop(run: ContainmentRun): AgentContainmentOutcome | undefined {
  if (run.input.signal?.aborted) return receipt('cancelled', run.attempts, run.lastOutcome);
  if (elapsed(run.start, run.now) >= run.budget.maxMilliseconds)
    return receipt('time-budget', run.attempts, run.lastOutcome);
  return undefined;
}

export function proposalDiagnostics(run: ContainmentRun): readonly Diagnostic[] {
  const state = run.lastOutcome?.state;
  if (state === 'invalid' || state === 'stale' || state === 'unsupported' || state === 'denied')
    return run.lastOutcome?.diagnostics ?? [];
  return [];
}

export function requestLimitStop(run: ContainmentRun): AgentContainmentOutcome | undefined {
  if (run.attempts.length > 0 && run.repairs >= run.budget.maxRepairs)
    return receipt('repair-budget', run.attempts, run.lastOutcome);
  if (run.attempts.length >= run.budget.maxTurns) return receipt('turn-budget', run.attempts, run.lastOutcome);
  return undefined;
}

/** Map a bounded-wait result to a stop receipt; the host signal can only cancel. */
export function boundaryStop(
  run: ContainmentRun,
  result: BoundaryResult<unknown>,
): AgentContainmentOutcome | undefined {
  if (result.kind === 'deadline') return receipt(BOUNDARY_STOPS.deadline, run.attempts, run.lastOutcome);
  if (result.kind === 'aborted' || run.input.signal?.aborted)
    return receipt(BOUNDARY_STOPS.aborted, run.attempts, run.lastOutcome);
  if (result.kind === 'failed') return receipt(BOUNDARY_STOPS.failed, run.attempts, run.lastOutcome);
  return undefined;
}

export function bindingBoundaryStop(
  run: ContainmentRun,
  result: BoundaryResult<Outcome<AgentBindingOutcome>>,
): AgentContainmentOutcome | undefined {
  const stop = boundaryStop(run, result);
  if (stop !== undefined) return stop;
  if (elapsed(run.start, run.now) >= run.budget.maxMilliseconds)
    return receipt('time-budget', run.attempts, run.lastOutcome);
  return undefined;
}

export interface PreparedCandidate {
  readonly fingerprint: string;
  readonly canonical: string;
  readonly proposalBytes: number;
  readonly exceedsByteBudget: boolean;
}

export function stopForCandidateBudget(
  run: ContainmentRun,
  prepared: PreparedCandidate,
): AgentContainmentOutcome | undefined {
  if (prepared.exceedsByteBudget) {
    const outcome = stopOutcome('invalid', [
      diagnostic('agent.byte-budget', 'The proposal exceeds the configured byte budget.'),
    ]);
    run.attempts.push({
      turn: run.attempts.length + 1,
      state: 'invalid',
      fingerprint: prepared.fingerprint,
      proposalBytes: prepared.proposalBytes,
      progress: 'none',
    });
    return receipt('byte-budget', run.attempts, outcome);
  }
  if (
    run.previousFingerprint !== undefined &&
    run.previousFingerprint === prepared.fingerprint &&
    run.previousCanonical === prepared.canonical
  ) {
    run.attempts.push({
      turn: run.attempts.length + 1,
      state: run.lastOutcome?.state ?? 'invalid',
      fingerprint: prepared.fingerprint,
      proposalBytes: prepared.proposalBytes,
      progress: 'none',
    });
    return receipt('no-progress', run.attempts, run.lastOutcome);
  }
  return undefined;
}

export function progressFor(
  run: ContainmentRun,
  state: AgentBindingOutcome['state'],
  fingerprint: string,
): AgentAttemptProgress {
  if (run.previousFingerprint === undefined) return 'new';
  if (run.previousState !== state || run.previousFingerprint !== fingerprint) return 'gap-closed';
  return 'none';
}

export function terminalBinding(
  state: AgentBindingOutcome['state'],
  outcome: AgentBindingOutcome | undefined,
  attempts: readonly AgentAttempt[],
): AgentContainmentOutcome | undefined {
  if (outcome === undefined) return undefined;
  const stop = TERMINAL_STOPS[state];
  return stop === undefined ? undefined : receipt(stop, attempts, outcome);
}
