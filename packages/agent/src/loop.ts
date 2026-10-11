import { parseWireValue, type Outcome } from '@varendo/core';
import { awaitAgentBoundary, type BoundaryResult } from './capabilities/dispatcher-boundary.js';
import { capabilityCanonical } from './capabilities/dispatcher.js';
import {
  bindingBoundaryStop,
  boundaryStop,
  createRun,
  elapsed,
  loopStop,
  normalizeBudget,
  proposalDiagnostics,
  progressFor,
  receipt,
  requestLimitStop,
  stopForCandidateBudget,
  stopOutcome,
  terminalBinding,
  type ContainmentRun,
  type PreparedCandidate,
} from './loop-state.js';
import type { AgentContainmentInput, AgentContainmentOutcome, AgentRepairRequest } from './loop-types.js';

function failure<T>(code: string, message: string): Outcome<T> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

function bytes(value: unknown): number | undefined {
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  const parsed = parseWireValue(value);
  // A non-wire object should reach the binder and become `invalid`; treating
  // an unstringifiable value as an enormous payload would misclassify shape
  // failure as a byte-budget stop.  String candidates are measured before
  // parsing so oversized JSON still receives the byte-budget outcome.
  if (!parsed.ok) return undefined;
  try {
    return new TextEncoder().encode(JSON.stringify(parsed.value)).byteLength;
  } catch {
    return undefined;
  }
}

function localFingerprint(value: unknown): string {
  const parsed = parseWireValue(value);
  if (!parsed.ok) return 'invalid-candidate';
  try {
    const wire = capabilityCanonical(parsed.value);
    let hash = 2166136261;
    for (const character of wire) {
      hash ^= character.codePointAt(0)!;
      hash = Math.imul(hash, 16777619);
    }
    return `candidate-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  } catch {
    return 'invalid-candidate';
  }
}

function candidateCanonical(value: unknown): string {
  const parsed = parseWireValue(value);
  if (!parsed.ok) {
    try {
      return `invalid:${String(value)}`;
    } catch {
      return 'invalid:candidate';
    }
  }
  return capabilityCanonical(parsed.value);
}

/** Await an untrusted proposal callback behind the shared bounded boundary. */
function proposeWithBudget(
  callback: (input: AgentRepairRequest) => unknown | Promise<unknown>,
  request: AgentRepairRequest,
  milliseconds: number,
): Promise<BoundaryResult<unknown>> {
  return awaitAgentBoundary((signal) => callback({ ...request, signal }), request.signal, milliseconds);
}

async function requestCandidate(run: ContainmentRun): Promise<AgentContainmentOutcome | undefined> {
  if (run.hasCandidate) return undefined;
  const limitStop = requestLimitStop(run);
  if (limitStop !== undefined) return limitStop;
  const request: AgentRepairRequest = {
    turn: run.attempts.length + 1,
    previous: Object.freeze([...run.attempts]),
    diagnostics: proposalDiagnostics(run),
    signal: run.input.signal ?? new AbortController().signal,
  };
  let proposed: BoundaryResult<unknown>;
  try {
    proposed = await proposeWithBudget(
      run.input.propose,
      request,
      run.budget.maxMilliseconds - elapsed(run.start, run.now),
    );
  } catch {
    return receipt('unavailable', run.attempts, run.lastOutcome);
  }
  const stop = boundaryStop(run, proposed);
  if (stop !== undefined) return stop;
  if (proposed.kind !== 'value') return receipt('unavailable', run.attempts, run.lastOutcome);
  run.candidate = proposed.value;
  run.hasCandidate = true;
  if (run.attempts.length > 0) run.repairs += 1;
  return undefined;
}

type PreparationResult =
  | { readonly kind: 'ready'; readonly value: PreparedCandidate }
  | { readonly kind: 'stopped'; readonly value: AgentContainmentOutcome };

async function prepareCandidate(run: ContainmentRun): Promise<PreparationResult> {
  const measuredBytes = bytes(run.candidate);
  const canonicalValue = candidateCanonical(run.candidate);
  if (measuredBytes !== undefined && measuredBytes > run.budget.maxProposalBytes)
    return {
      kind: 'ready',
      value: {
        fingerprint: localFingerprint(run.candidate),
        canonical: canonicalValue,
        proposalBytes: measuredBytes,
        exceedsByteBudget: true,
      },
    };
  const result = await awaitAgentBoundary(
    (signal) => run.input.binder.fingerprint(run.candidate, { signal, goalEpoch: run.input.goalEpoch }),
    run.input.signal,
    Math.max(0, run.budget.maxMilliseconds - elapsed(run.start, run.now)),
  );
  const stop = boundaryStop(run, result);
  if (stop !== undefined) return { kind: 'stopped', value: stop };
  if (result.kind !== 'value') return { kind: 'stopped', value: receipt('unavailable', run.attempts, run.lastOutcome) };
  return {
    kind: 'ready',
    value: {
      fingerprint: result.value.ok ? result.value.value : localFingerprint(run.candidate),
      canonical: canonicalValue,
      proposalBytes: measuredBytes ?? 0,
      exceedsByteBudget: false,
    },
  };
}

async function bindCandidate(
  run: ContainmentRun,
  prepared: PreparedCandidate,
): Promise<AgentContainmentOutcome | undefined> {
  const result = await awaitAgentBoundary(
    (signal) =>
      run.input.binder.bind(run.candidate, {
        signal,
        goalEpoch: run.input.goalEpoch,
      }),
    run.input.signal,
    Math.max(0, run.budget.maxMilliseconds - elapsed(run.start, run.now)),
  );
  const stop = bindingBoundaryStop(run, result);
  if (stop !== undefined) return stop;
  if (result.kind !== 'value') return receipt('unavailable', run.attempts, run.lastOutcome);
  const bound = result.value;
  const outcome = bound.ok ? bound.value : stopOutcome('invalid', bound.diagnostics);
  const state = bound.ok ? bound.value.state : 'invalid';
  run.attempts.push({
    turn: run.attempts.length + 1,
    state,
    fingerprint: prepared.fingerprint,
    proposalBytes: prepared.proposalBytes,
    progress: progressFor(run, state, prepared.fingerprint),
  });
  run.previousFingerprint = prepared.fingerprint;
  run.previousCanonical = prepared.canonical;
  run.previousState = state;
  run.lastOutcome = outcome;
  run.hasCandidate = false;
  const terminal = terminalBinding(state, outcome, run.attempts);
  if (terminal !== undefined) return terminal;
  if (run.repairs >= run.budget.maxRepairs) return receipt('repair-budget', run.attempts, run.lastOutcome);
  if (run.attempts.length >= run.budget.maxTurns) return receipt('turn-budget', run.attempts, run.lastOutcome);
  return undefined;
}

function validContainmentInput(input: AgentContainmentInput): boolean {
  return (
    input !== null &&
    typeof input === 'object' &&
    typeof input.propose === 'function' &&
    input.binder !== null &&
    typeof input.binder.bind === 'function' &&
    typeof input.binder.fingerprint === 'function'
  );
}

/**
 * Run model repair as a bounded proposal loop.  This function only binds
 * accepted proposals; it never executes a query, presentation commit, or
 * business effect.
 */
export async function containAgentProposal(input: AgentContainmentInput): Promise<AgentContainmentOutcome> {
  if (!validContainmentInput(input)) return failure('agent.invalid-input', 'The containment loop input is malformed.');

  const budget = normalizeBudget(input.budget);
  if (!budget.ok) return budget;
  const run = createRun(input, budget.value);
  for (;;) {
    const stop = loopStop(run);
    if (stop !== undefined) return stop;
    const proposalStop = await requestCandidate(run);
    if (proposalStop !== undefined) return proposalStop;
    if (run.attempts.length >= run.budget.maxTurns) return receipt('turn-budget', run.attempts, run.lastOutcome);
    const prepared = await prepareCandidate(run);
    if (prepared.kind === 'stopped') return prepared.value;
    const budgetStop = stopForCandidateBudget(run, prepared.value);
    if (budgetStop !== undefined) return budgetStop;
    const bindingStop = await bindCandidate(run, prepared.value);
    if (bindingStop !== undefined) return bindingStop;
  }
}
