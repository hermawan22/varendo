import type { AgentStopReason } from '@varendo/core/agent';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentSessionAttempt, AgentSessionRepairRequest } from './types.js';
import { awaitBoundary, bytes, elapsed, fingerprint, type BoundaryResult } from './helpers.js';
import { failedReceipt, recoverable, stopFor } from './recovery.js';
import { finalizeSession } from './finalize.js';
import type { SessionRunContext } from './run-types.js';

interface CandidateMeasure {
  readonly fingerprint: string;
  readonly bytes: number;
}

const terminalStates = new Set<AgentCapabilityReceipt['state']>([
  'needs-choice',
  'needs-meaning',
  'partial',
  'denied',
  'stale',
  'cancelled',
]);

function appendAttempt(context: SessionRunContext, attempt: AgentSessionAttempt): void {
  context.attempts.push(Object.freeze(attempt));
  context.state.attempts = Object.freeze([...context.attempts]);
}

function candidateStop(context: SessionRunContext, measure: CandidateMeasure): AgentStopReason | undefined {
  if (measure.bytes > context.budget.maxProposalBytes) {
    context.diagnostics = [
      {
        code: 'agent.session.byte-budget',
        message: 'The candidate exceeds its configured byte budget.',
        retryable: false,
      },
    ];
    context.last = failedReceipt(context.request, context.diagnostics);
    appendAttempt(context, {
      turn: context.attempts.length + 1,
      state: 'invalid',
      fingerprint: measure.fingerprint,
      proposalBytes: measure.bytes,
      progress: 'none',
    });
    return 'byte-budget';
  }
  if (context.previousFingerprint !== undefined && context.previousFingerprint === measure.fingerprint) {
    appendAttempt(context, {
      turn: context.attempts.length + 1,
      state: context.last?.state ?? 'invalid',
      fingerprint: measure.fingerprint,
      proposalBytes: measure.bytes,
      progress: 'none',
      ...(context.last === undefined ? {} : { receipt: context.last }),
    });
    return 'no-progress';
  }
  return undefined;
}

function measureCandidate(context: SessionRunContext): CandidateMeasure {
  return { bytes: bytes(context.candidate), fingerprint: fingerprint(context.candidate) };
}

function recordBoundaryFailure(context: SessionRunContext): void {
  context.diagnostics = [
    { code: 'agent.session.dispatch', message: 'Capability dispatch failed safely.', retryable: true },
  ];
  context.last = failedReceipt(context.request, context.diagnostics);
}

function receiptFromBoundary(
  context: SessionRunContext,
  result: BoundaryResult<import('@varendo/core').Outcome<AgentCapabilityReceipt>>,
): AgentCapabilityReceipt | undefined {
  if (result.kind !== 'value') return undefined;
  if (result.value.ok) return result.value.value;
  context.diagnostics = result.value.diagnostics;
  return failedReceipt(context.request, context.diagnostics);
}

function boundaryStop(kind: BoundaryResult<unknown>['kind']): AgentStopReason | undefined {
  if (kind === 'deadline') return 'time-budget';
  if (kind === 'aborted') return 'cancelled';
  return undefined;
}

function attemptProgress(context: SessionRunContext, measure: CandidateMeasure, receipt: AgentCapabilityReceipt) {
  if (context.previousFingerprint === undefined) return 'new' as const;
  const previousState = context.attempts.at(-1)?.state;
  return context.previousFingerprint !== measure.fingerprint || receipt.state !== previousState ? 'gap-closed' : 'none';
}

function addDispatchAttempt(
  context: SessionRunContext,
  measure: CandidateMeasure,
  receipt: AgentCapabilityReceipt,
): void {
  appendAttempt(context, {
    turn: context.attempts.length + 1,
    state: receipt.state,
    fingerprint: measure.fingerprint,
    proposalBytes: measure.bytes,
    progress: attemptProgress(context, measure, receipt),
    receipt,
  });
  context.previousFingerprint = measure.fingerprint;
}

async function dispatchCandidate(
  context: SessionRunContext,
  measure: CandidateMeasure,
): Promise<AgentStopReason | undefined> {
  const request = Object.freeze({ ...context.request, input: context.candidate });
  const remaining = Math.max(1, context.budget.maxMilliseconds - elapsed(context.start, context.state.now));
  const dispatched = await awaitBoundary(
    (signal) =>
      context.state.options.dispatcher.dispatch(request, {
        signal,
        transport: context.request.transport ?? 'direct',
      }),
    context.controller.signal,
    remaining,
  );
  const stop = boundaryStop(dispatched.kind);
  if (stop !== undefined) return stop;
  if (dispatched.kind === 'failed') recordBoundaryFailure(context);
  else {
    const receipt = receiptFromBoundary(context, dispatched);
    if (receipt === undefined) return 'unavailable';
    context.last = receipt;
    context.diagnostics = receipt.diagnostics;
  }
  if (context.last === undefined) return 'unavailable';
  addDispatchAttempt(context, measure, context.last);
  return undefined;
}

function terminalReason(context: SessionRunContext): AgentStopReason | undefined {
  const receipt = context.last;
  if (receipt === undefined) return 'unavailable';
  const state = receipt.state;
  const stop = stopFor(state);
  if (isTerminal(state, stop)) return stop;
  if (!canRepair(context, state)) return stop;
  if (context.repairs >= context.budget.maxRepairs) return 'repair-budget';
  context.repairs++;
  if (context.attempts.length >= context.budget.maxTurns) return 'turn-budget';
  return undefined;
}

function isTerminal(state: AgentCapabilityReceipt['state'], stop: AgentStopReason): boolean {
  return stop === 'complete' || terminalStates.has(state);
}

function canRepair(context: SessionRunContext, state: AgentCapabilityReceipt['state']): boolean {
  return context.input.propose !== undefined && recoverable(state);
}

function repairRequest(context: SessionRunContext): AgentSessionRepairRequest {
  return Object.freeze({
    turn: context.attempts.length + 1,
    previous: Object.freeze(
      context.attempts.map(({ turn, state, fingerprint: hash, proposalBytes, progress }) =>
        Object.freeze({ turn, state, fingerprint: hash, proposalBytes, progress }),
      ),
    ),
    diagnostics: Object.freeze([...context.diagnostics]),
    signal: context.controller.signal,
  });
}

async function proposeNext(context: SessionRunContext): Promise<AgentStopReason | undefined> {
  const propose = context.input.propose;
  if (propose === undefined) return undefined;
  const request = repairRequest(context);
  const remaining = Math.max(1, context.budget.maxMilliseconds - elapsed(context.start, context.state.now));
  const next = await awaitBoundary((signal) => propose({ ...request, signal }), context.controller.signal, remaining);
  switch (next.kind) {
    case 'value':
      context.candidate = next.value;
      return undefined;
    case 'deadline':
      return 'time-budget';
    case 'aborted':
      return 'cancelled';
    case 'failed':
      return 'unavailable';
  }
}

async function advance(context: SessionRunContext): Promise<AgentStopReason | undefined> {
  if (context.controller.signal.aborted || context.parent?.aborted) return 'cancelled';
  if (elapsed(context.start, context.state.now) >= context.budget.maxMilliseconds) return 'time-budget';
  if (context.attempts.length >= context.budget.maxTurns) return 'turn-budget';
  const measure = measureCandidate(context);
  const repeated = candidateStop(context, measure);
  if (repeated !== undefined) return repeated;
  const dispatchStop = await dispatchCandidate(context, measure);
  if (dispatchStop !== undefined) return dispatchStop;
  const terminal = terminalReason(context);
  if (terminal !== undefined) return terminal;
  return proposeNext(context);
}

export async function executeSession(context: SessionRunContext) {
  while (true) {
    const reason = await advance(context);
    if (reason !== undefined) return finalizeSession(context, reason);
  }
}
