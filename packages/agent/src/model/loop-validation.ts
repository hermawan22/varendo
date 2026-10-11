import { parseWireValue, WIRE_LIMITS } from '@varendo/core';
import type { AgentCapabilityReceipt, AgentCapabilityState } from '../capabilities/types.js';
import { isRecord, strictId } from '../guards.js';
import { isToolModelContinuation } from './continuation.js';
import type { ToolModelBudget, ToolModelLoopOptions, ToolModelLoopOutcome, ToolModelResponse } from './types.js';

const positiveStates = new Set<AgentCapabilityState>([
  'accepted',
  'bound',
  'data-ready',
  'plan-committed',
  'renderer-ready',
]);
const operations = new Set([
  'catalog.read',
  'result.inspect',
  'task.propose',
  'task.evaluate',
  'experience.propose',
  'experience.commit',
  'meaning.propose',
  'meaning.activate',
  'action.propose',
  'action.execute',
  'model.egress',
]);

export const fail = (code: string, message: string): ToolModelLoopOutcome => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

export const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function snapshot<T>(value: T): T {
  if (isToolModelContinuation(value)) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  const entries = Object.entries(value).map(([key, child]) => [key, snapshot(child)]);
  return Object.freeze(Object.fromEntries(entries)) as T;
}

function validBudget(budget: ToolModelBudget): boolean {
  return (
    budget !== null &&
    typeof budget === 'object' &&
    integer(budget.maxTurns, 1, 32) &&
    integer(budget.maxModelRequests, 1, 64) &&
    integer(budget.maxToolCalls, 1, 64) &&
    integer(budget.maxMilliseconds, 1, 300_000) &&
    integer(budget.maxInputTokens, 1, 1_000_000) &&
    integer(budget.maxOutputTokens, 1, 100_000) &&
    integer(budget.maxTotalTokens, 1, 2_000_000) &&
    integer(budget.maxInputBytes, 1, WIRE_LIMITS.bytes) &&
    integer(budget.maxOutputBytes, 1, WIRE_LIMITS.bytes) &&
    integer(budget.maxRepeatedCalls, 1, 4)
  );
}

function validPolicy(policy: ToolModelLoopOptions['policy']): boolean {
  if (policy === undefined) return true;
  if (
    policy === null ||
    typeof policy !== 'object' ||
    !Array.isArray(policy.requiredOperationSequence) ||
    (policy.providerToolChoice !== undefined &&
      policy.providerToolChoice !== 'auto' &&
      policy.providerToolChoice !== 'required') ||
    policy.requiredOperationSequence.length === 0 ||
    policy.requiredOperationSequence.length > 16
  )
    return false;
  return policy.requiredOperationSequence.every(validRequiredOperation);
}

function validRequiredOperation(step: unknown): boolean {
  if (step === null || typeof step !== 'object') return false;
  const candidate = step as { operation?: unknown; acceptedStates?: unknown };
  if (
    typeof candidate.operation !== 'string' ||
    !operations.has(candidate.operation) ||
    !Array.isArray(candidate.acceptedStates) ||
    candidate.acceptedStates.length === 0 ||
    candidate.acceptedStates.length > positiveStates.size ||
    new Set(candidate.acceptedStates).size !== candidate.acceptedStates.length
  )
    return false;
  return candidate.acceptedStates.every(validPositiveState);
}

function validPositiveState(state: unknown): boolean {
  return typeof state === 'string' && positiveStates.has(state as AgentCapabilityState);
}

function validIdentity(options: ToolModelLoopOptions): boolean {
  return strictId(options.requestId) && (options.goal === 'chat' || options.goal === 'experience');
}

function validPrompt(options: ToolModelLoopOptions): boolean {
  return typeof options.prompt === 'string' && options.prompt.length > 0 && options.prompt.length <= WIRE_LIMITS.text;
}

function validInstructions(options: ToolModelLoopOptions): boolean {
  const instructions = options.instructions;
  return (
    instructions === undefined ||
    (typeof instructions === 'string' && instructions.length > 0 && instructions.length <= WIRE_LIMITS.text)
  );
}

function validEndpoint(options: ToolModelLoopOptions): boolean {
  const endpoint = options.endpoint;
  return (
    endpoint !== null &&
    typeof endpoint === 'object' &&
    endpoint.transport === 'byok' &&
    typeof endpoint.authorizeModel === 'function'
  );
}

function validModel(options: ToolModelLoopOptions): boolean {
  const model = options.model;
  if (model === null || typeof model !== 'object' || typeof model.complete !== 'function') return false;
  return typeof model.countInputTokens === 'function' || typeof model.estimateInputTokens === 'function';
}

export function validLoopOptions(options: ToolModelLoopOptions): boolean {
  if (options === null || typeof options !== 'object') return false;
  return (
    validIdentity(options) &&
    validPrompt(options) &&
    validInstructions(options) &&
    validPolicy(options.policy) &&
    validBudget(options.budget) &&
    validEndpoint(options) &&
    validModel(options)
  );
}

export function requiredIndex(
  policy: ToolModelLoopOptions['policy'],
  receipts: readonly AgentCapabilityReceipt[],
): number {
  if (policy === undefined) return 0;
  let index = 0;
  for (const receipt of receipts) {
    const step = policy.requiredOperationSequence[index];
    if (step !== undefined && receipt.operation === step.operation && step.acceptedStates.includes(receipt.state))
      index++;
  }
  return index;
}

interface ResponseInput {
  readonly wireInput: object;
  readonly continuation?: ToolModelResponse['continuation'];
}

function responseInput(input: unknown): ResponseInput | undefined {
  if (!isRecord(input)) return undefined;
  const candidate = input as unknown as ToolModelResponse;
  if (candidate.continuation !== undefined && !isToolModelContinuation(candidate.continuation)) return undefined;
  const { continuation, ...wireInput } = candidate;
  return { wireInput, ...(continuation === undefined ? {} : { continuation }) };
}

function validUsage(response: ToolModelResponse): boolean {
  const usage = response.usage;
  return (
    usage !== null &&
    typeof usage === 'object' &&
    integer(usage.inputTokens, 0, 1_000_000) &&
    integer(usage.outputTokens, 0, 100_000)
  );
}

function validCalls(response: ToolModelResponse): boolean {
  if (!Array.isArray(response.calls) || response.calls.length > 8) return false;
  const ids = new Set<string>();
  for (const call of response.calls) {
    if (!call || !strictId(call.id) || !strictId(call.name) || ids.has(call.id) || !Object.hasOwn(call, 'input'))
      return false;
    ids.add(call.id);
  }
  return true;
}

function validResponseText(response: ToolModelResponse): boolean {
  return response.text === undefined || (typeof response.text === 'string' && response.text.length <= WIRE_LIMITS.text);
}

function checkedResponse(wireInput: object, limit: number, continuationBytes: number): ToolModelResponse | undefined {
  const checked = parseWireValue(wireInput);
  if (!checked.ok) return undefined;
  if (bytes(checked.value) + continuationBytes > limit) return undefined;
  if (!isRecord(checked.value)) return undefined;
  const candidate = checked.value as unknown as ToolModelResponse;
  if (!validResponseText(candidate) || !validCalls(candidate) || !validUsage(candidate)) return undefined;
  return snapshot(candidate);
}

export function response(input: unknown, limit: number): ToolModelResponse | undefined {
  const parsedInput = responseInput(input);
  if (parsedInput === undefined) return undefined;
  const safe = checkedResponse(parsedInput.wireInput, limit, parsedInput.continuation?.bytes ?? 0);
  if (safe === undefined) return undefined;
  return Object.freeze({
    ...safe,
    ...(parsedInput.continuation === undefined ? {} : { continuation: parsedInput.continuation }),
  });
}
