import { parseWireValue } from '@varendo/core';
import type { AgentCapabilityReceipt, AgentJsonValue } from '../capabilities/types.js';
import type { AgentToolDefinition } from '../protocol/types.js';
import type { ToolModelCall, ToolModelRequiredOperation, ToolModelResponse, ToolModelStop } from './types.js';
import { admit, boundary, toolFingerprint, type SeenToolCall, type ToolModelLoopState } from './loop-state.js';
import { bytes, snapshot } from './loop-validation.js';

type PreparedCall =
  | { readonly kind: 'stop'; readonly stop: ToolModelStop }
  | { readonly kind: 'cached'; readonly output: SeenToolCall['output'] }
  | { readonly kind: 'dispatch'; readonly fingerprint: string };

function appendAssistant(state: ToolModelLoopState, candidate: ToolModelResponse): void {
  state.messages.push({
    role: 'assistant',
    ...(candidate.text === undefined ? {} : { text: candidate.text }),
    calls: candidate.calls,
    ...(candidate.continuation === undefined ? {} : { continuation: candidate.continuation }),
  });
}

function appendRequiredOperationError(state: ToolModelLoopState, callId: string, message: string): void {
  state.messages.push({
    role: 'tool',
    callId,
    output: {
      ok: false,
      diagnostics: [{ code: 'agent.model.required-operation', message, retryable: true }],
    },
  });
}

function rejectOutOfSequenceCalls(
  state: ToolModelLoopState,
  candidate: ToolModelResponse,
  required: ToolModelRequiredOperation,
): void {
  state.toolCalls += candidate.calls.length;
  appendAssistant(state, candidate);
  for (const call of candidate.calls) {
    appendRequiredOperationError(state, call.id, `The host requires ${required.operation} before this tool.`);
  }
}

function callsMatchRequiredOperation(candidate: ToolModelResponse, tools: readonly AgentToolDefinition[]): boolean {
  const allowedNames = new Set(tools.map((tool) => tool.name));
  return candidate.calls.every((call) => allowedNames.has(call.name));
}

export async function processToolCalls(
  state: ToolModelLoopState,
  candidate: ToolModelResponse,
  tools: readonly AgentToolDefinition[],
  required: ToolModelRequiredOperation | undefined,
): Promise<ToolModelStop | undefined> {
  if (state.toolCalls + candidate.calls.length > state.budget.maxToolCalls) return 'budget';
  if (required !== undefined && !callsMatchRequiredOperation(candidate, tools)) {
    rejectOutOfSequenceCalls(state, candidate, required);
    return undefined;
  }
  appendAssistant(state, candidate);
  for (const [index, call] of candidate.calls.entries()) {
    const stop = await processToolCall(state, call, required, index);
    if (stop !== undefined) return stop;
  }
  return undefined;
}

async function prepareCall(state: ToolModelLoopState, call: ToolModelCall): Promise<PreparedCall> {
  const permission = await admit(state);
  if (permission !== undefined) return { kind: 'stop', stop: permission };
  const fingerprint = toolFingerprint(state, call.name, call.input);
  const prior = state.seen.get(call.id);
  if (prior !== undefined && prior.fingerprint !== fingerprint) return { kind: 'stop', stop: 'failed' };
  const repeated = (state.repeats.get(fingerprint) ?? 0) + 1;
  state.repeats.set(fingerprint, repeated);
  if (repeated > state.budget.maxRepeatedCalls) return { kind: 'stop', stop: 'no-progress' };
  if (prior !== undefined) return { kind: 'cached', output: prior.output };
  return { kind: 'dispatch', fingerprint };
}

async function processToolCall(
  state: ToolModelLoopState,
  call: ToolModelCall,
  required: ToolModelRequiredOperation | undefined,
  index: number,
): Promise<ToolModelStop | undefined> {
  if (required !== undefined && index > 0) {
    state.toolCalls++;
    appendRequiredOperationError(
      state,
      call.id,
      'The host admits at most one required operation per model response. Continue after the trusted receipt.',
    );
    return undefined;
  }
  const prepared = await prepareCall(state, call);
  if (prepared.kind === 'stop') return prepared.stop;
  if (prepared.kind === 'cached') {
    state.messages.push({ role: 'tool', callId: call.id, output: prepared.output });
    return undefined;
  }
  state.toolCalls++;
  return invokeToolCall(state, call, prepared.fingerprint);
}

async function invokeToolCall(
  state: ToolModelLoopState,
  call: ToolModelCall,
  fingerprint: string,
): Promise<ToolModelStop | undefined> {
  const result = await boundary(state, (signal) =>
    state.endpoint.invoke(call.name, call.input, { requestId: `${state.requestId}-${state.toolCalls}`, signal }),
  );
  if (typeof result === 'string') return result;
  const receiptStop = acceptReceipt(state, result.ok ? result.value : undefined);
  if (receiptStop !== undefined) return receiptStop;
  const afterTool = await admit(state, result.ok ? result.value : undefined);
  if (afterTool !== undefined) return afterTool;
  if (isExperienceCommit(state.goal, result.ok ? result.value : undefined)) return 'renderer-ready';
  return appendToolOutput(state, call.id, result, fingerprint);
}

function acceptReceipt(
  state: ToolModelLoopState,
  receipt: AgentCapabilityReceipt | undefined,
): ToolModelStop | undefined {
  if (receipt === undefined) return undefined;
  state.receipts.push(receipt);
  switch (receipt.state) {
    case 'partial':
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'stale':
    case 'denied':
      return receipt.state;
    default:
      return undefined;
  }
}

function isExperienceCommit(goal: ToolModelLoopState['goal'], receipt: AgentCapabilityReceipt | undefined): boolean {
  return goal === 'experience' && receipt?.state === 'renderer-ready';
}

function appendToolOutput(
  state: ToolModelLoopState,
  callId: string,
  result: unknown,
  fingerprint: string,
): ToolModelStop | undefined {
  const wire = parseWireValue(result);
  if (!wire.ok || bytes(wire.value) > state.budget.maxOutputBytes) return 'budget';
  const output = snapshot(wire.value as AgentJsonValue);
  state.seen.set(callId, { fingerprint, output });
  state.messages.push({ role: 'tool', callId, output });
  if (bytes(state.messages) > state.budget.maxInputBytes) return 'budget';
  return undefined;
}
