import type { ToolModelLoopState } from './loop-state.js';
import { admit, boundary } from './loop-state.js';
import { bytes, response } from './loop-validation.js';
import type { ToolModelRequest, ToolModelResponse, ToolModelStop } from './types.js';

function continuationBytes(request: ToolModelRequest): number {
  return request.messages.reduce((total, message) => {
    if (message.role !== 'assistant') return total;
    return total + (message.continuation?.bytes ?? 0);
  }, 0);
}

export function exceedsRequestBudget(state: ToolModelLoopState, request: ToolModelRequest): boolean {
  const requestBytes = bytes(request) + continuationBytes(request);
  const expectedRequests = state.count === undefined ? 1 : 2;
  return (
    requestBytes > state.budget.maxInputBytes || state.modelRequests + expectedRequests > state.budget.maxModelRequests
  );
}

async function remoteTokenCount(state: ToolModelLoopState, request: ToolModelRequest): Promise<number | ToolModelStop> {
  const permitted = await admit(state);
  if (permitted !== undefined) return permitted;
  state.modelRequests++;
  return boundary(state, (signal) => state.count!(request, { signal }));
}

function estimatedTokenCount(state: ToolModelLoopState, request: ToolModelRequest): number | ToolModelStop {
  if (state.estimate === undefined) return 'failed';
  try {
    return state.estimate(request);
  } catch {
    return 'failed';
  }
}

export function countInputTokens(
  state: ToolModelLoopState,
  request: ToolModelRequest,
): Promise<number | ToolModelStop> | number | ToolModelStop {
  if (state.count !== undefined) return remoteTokenCount(state, request);
  return estimatedTokenCount(state, request);
}

/** Boundary stops pass through unchanged; every other string becomes 'failed'. */
const PASSTHROUGH_STOPS: ReadonlySet<ToolModelStop> = new Set(['cancelled', 'budget', 'failed']);

export function invalidCountStop(value: number | ToolModelStop): ToolModelStop | undefined {
  if (typeof value !== 'string') return undefined;
  return PASSTHROUGH_STOPS.has(value) ? value : 'failed';
}

export async function requestModelResponse(
  state: ToolModelLoopState,
  request: ToolModelRequest,
): Promise<ToolModelResponse | ToolModelStop> {
  const permitted = await admit(state);
  if (permitted !== undefined) return permitted;
  state.modelRequests++;
  state.turns++;
  const raw = await boundary(state, (signal) => state.complete(request, { signal }));
  if (typeof raw === 'string') return raw;
  const candidate = response(raw, state.budget.maxOutputBytes);
  if (candidate === undefined) return 'failed';
  state.inputTokens += candidate.usage.inputTokens;
  state.outputTokens += candidate.usage.outputTokens;
  if (exceedsOutputBudget(state, candidate)) return 'budget';
  const outputPermission = await admit(state);
  if (outputPermission !== undefined) return outputPermission;
  return candidate;
}

function exceedsOutputBudget(state: ToolModelLoopState, candidate: ToolModelResponse): boolean {
  return (
    candidate.usage.inputTokens > state.budget.maxInputTokens ||
    candidate.usage.outputTokens > state.budget.maxOutputTokens ||
    state.inputTokens + state.outputTokens > state.budget.maxTotalTokens
  );
}
