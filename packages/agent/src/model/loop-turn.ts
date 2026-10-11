import type { AgentToolDefinition } from '../protocol/types.js';
import type { ToolModelRequiredOperation, ToolModelResponse, ToolModelStop } from './types.js';
import { currentRequiredOperation, admit, boundary, makeRequest, type ToolModelLoopState } from './loop-state.js';
import { countInputTokens, exceedsRequestBudget, invalidCountStop, requestModelResponse } from './loop-exchange.js';
import { processToolCalls } from './loop-tools.js';
import { integer } from './loop-validation.js';

export interface TurnDecision {
  readonly stop: ToolModelStop;
  readonly textDraft?: string;
}

function stopDecision(stop: ToolModelStop): TurnDecision {
  return { stop };
}

function exceedsInputTokenBudget(state: ToolModelLoopState, counted: number): boolean {
  return (
    counted > state.budget.maxInputTokens ||
    state.inputTokens + state.outputTokens + counted + state.budget.maxOutputTokens > state.budget.maxTotalTokens
  );
}

function selectTools(
  available: readonly AgentToolDefinition[],
  required: ToolModelRequiredOperation | undefined,
): readonly AgentToolDefinition[] {
  if (required === undefined) return available;
  return available.filter((tool) => tool.operation === required.operation);
}

async function completeTurn(
  state: ToolModelLoopState,
  tools: readonly AgentToolDefinition[],
  required: ToolModelRequiredOperation | undefined,
): Promise<TurnDecision | undefined> {
  const request = makeRequest(state, tools, required);
  if (exceedsRequestBudget(state, request)) return stopDecision('budget');
  const counted = await countInputTokens(state, request);
  const countStop = invalidCountStop(counted);
  if (countStop !== undefined) return stopDecision(countStop);
  if (!integer(counted, 1, 1_000_000)) return stopDecision('failed');
  if (exceedsInputTokenBudget(state, counted)) return stopDecision('budget');
  const candidate = await requestModelResponse(state, request);
  if (typeof candidate === 'string') return stopDecision(candidate);
  return processCandidate(state, tools, required, candidate);
}

function appendRequiredFollowUp(
  state: ToolModelLoopState,
  candidate: ToolModelResponse,
  required: ToolModelRequiredOperation,
): void {
  if (candidate.text !== undefined || candidate.continuation !== undefined) {
    state.messages.push({
      role: 'assistant',
      ...(candidate.text === undefined ? {} : { text: candidate.text }),
      calls: [],
      ...(candidate.continuation === undefined ? {} : { continuation: candidate.continuation }),
    });
  }
  state.messages.push({
    role: 'system',
    text: `The host still requires a successful ${required.operation} tool receipt before final text. Continue with the available tool.`,
  });
}

function noCallDecision(
  state: ToolModelLoopState,
  candidate: ToolModelResponse,
  required: ToolModelRequiredOperation | undefined,
): TurnDecision | undefined {
  if (required !== undefined) {
    appendRequiredFollowUp(state, candidate, required);
    return undefined;
  }
  const stop = state.goal === 'chat' && candidate.text ? 'text-ready' : 'no-commit';
  return { stop, ...(candidate.text === undefined ? {} : { textDraft: candidate.text }) };
}

async function processCandidate(
  state: ToolModelLoopState,
  tools: readonly AgentToolDefinition[],
  required: ToolModelRequiredOperation | undefined,
  candidate: ToolModelResponse,
): Promise<TurnDecision | undefined> {
  if (candidate.calls.length === 0) return noCallDecision(state, candidate, required);
  const stop = await processToolCalls(state, candidate, tools, required);
  return stop === undefined ? undefined : stopDecision(stop);
}

export async function runModelTurn(state: ToolModelLoopState): Promise<TurnDecision | undefined> {
  const admission = await admit(state);
  if (admission !== undefined) return stopDecision(admission);
  const discovery = await boundary(state, (signal) => state.endpoint.discover({ signal }));
  if (typeof discovery === 'string') return stopDecision(discovery);
  if (!discovery.ok) return stopDecision('denied');
  const required = currentRequiredOperation(state);
  const tools = selectTools(discovery.value, required);
  if (required !== undefined && tools.length === 0) return stopDecision('failed');
  return completeTurn(state, tools, required);
}
