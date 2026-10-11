import { parseContract, type Outcome } from '@varendo/core';
import type { AgentCapabilityRequest } from '../capabilities/types.js';
import { normalizeAgentCapabilityRequest } from '../capabilities/dispatcher.js';
import type { AgentSessionRunInput, AgentSessionReceipt } from './types.js';
import { safeNow } from './helpers.js';
import { executeSession } from './execution.js';
import { finalizeSession } from './finalize.js';
import { failure } from './run-utils.js';
import type { SessionBudget, SessionRunContext } from './run-types.js';
import type { AgentSessionState } from './state.js';

interface PreparedRequest {
  readonly budget: SessionBudget;
  readonly request: AgentCapabilityRequest;
}

function prepareRequest(input: AgentSessionRunInput): Outcome<PreparedRequest> {
  const budget = parseContract('agent-loop-budget', input?.budget);
  if (!budget.ok) return budget;
  if (
    input === null ||
    typeof input !== 'object' ||
    input.request === null ||
    typeof input.request !== 'object' ||
    typeof input.request.requestId !== 'string'
  )
    return failure('agent.session.invalid', 'The session request is malformed.');
  const checked = normalizeAgentCapabilityRequest(input.request);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: { budget: budget.value as unknown as SessionBudget, request: checked.value },
  };
}

function beginSession(
  state: AgentSessionState,
  input: AgentSessionRunInput,
  prepared: PreparedRequest,
): SessionRunContext {
  const controller = new AbortController();
  const request = Object.freeze({ ...prepared.request, transport: state.transport });
  state.active = controller;
  state.requestId = request.requestId;
  state.status = 'running';
  state.attempts = Object.freeze([]);
  state.receipt = undefined;
  const parent = input.signal;
  const onParentAbort = (): void => controller.abort();
  parent?.addEventListener('abort', onParentAbort, { once: true });
  return {
    state,
    input,
    budget: prepared.budget,
    request,
    controller,
    parent,
    removeParentAbort: parent === undefined ? undefined : () => parent.removeEventListener('abort', onParentAbort),
    start: safeNow(state.now),
    attempts: [],
    candidate: request.input,
    previousFingerprint: undefined,
    last: undefined,
    diagnostics: [],
    repairs: 0,
  };
}

function preflightFailure(state: AgentSessionState): Outcome<AgentSessionReceipt> | undefined {
  if (state.closed) return failure('agent.session.closed', 'The agent session is closed.');
  if (state.active !== undefined)
    return failure('agent.session.busy', 'The agent session already has a running request.');
  return undefined;
}

function cleanupSession(state: AgentSessionState, context: SessionRunContext): void {
  context.removeParentAbort?.();
  state.active = undefined;
  if (state.status === 'running') state.status = 'idle';
}

export async function runSession(
  state: AgentSessionState,
  input: AgentSessionRunInput,
): Promise<Outcome<AgentSessionReceipt>> {
  const preflight = preflightFailure(state);
  if (preflight !== undefined) return preflight;
  const prepared = prepareRequest(input);
  if (!prepared.ok) return { ok: false, diagnostics: prepared.diagnostics };
  const context = beginSession(state, input, prepared.value);
  try {
    return await executeSession(context);
  } catch {
    return finalizeSession(context, 'unavailable');
  } finally {
    cleanupSession(state, context);
  }
}
