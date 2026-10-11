import { validateCommitReadSet } from '@varendo/core';
import { awaitAgentBoundary, capabilityCanonical } from '../capabilities/dispatcher.js';
import type { BoundaryResult } from '../capabilities/dispatcher-boundary.js';
import type { AgentCapabilityOperation, AgentCapabilityReceipt, AgentJsonValue } from '../capabilities/types.js';
import type { AgentModelScope, AgentModelToolEndpoint } from '../protocol/types.js';
import { requiredIndex, snapshot } from './loop-validation.js';
import type {
  ToolModelBudget,
  ToolModelLoopOptions,
  ToolModelLoopOutcome,
  ToolModelMessage,
  ToolModelPort,
  ToolModelRequest,
  ToolModelStop,
} from './types.js';

/** A bounded-wait failure kind maps to the loop's stop reason. */
const BOUNDARY_STOPS: Readonly<Record<Exclude<BoundaryResult<unknown>['kind'], 'value'>, ToolModelStop>> = {
  aborted: 'cancelled',
  deadline: 'budget',
  failed: 'failed',
};

export interface SeenToolCall {
  readonly fingerprint: string;
  readonly output: AgentJsonValue;
}

export interface ToolModelLoopState {
  readonly requestId: string;
  readonly goal: ToolModelLoopOptions['goal'];
  readonly endpoint: AgentModelToolEndpoint;
  readonly budget: ToolModelBudget;
  readonly policy: ToolModelLoopOptions['policy'];
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  readonly started: number;
  readonly count?: NonNullable<ToolModelPort['countInputTokens']>;
  readonly estimate?: NonNullable<ToolModelPort['estimateInputTokens']>;
  readonly complete: ToolModelPort['complete'];
  readonly messages: ToolModelMessage[];
  readonly receipts: AgentCapabilityReceipt[];
  readonly seen: Map<string, SeenToolCall>;
  readonly repeats: Map<string, number>;
  turns: number;
  modelRequests: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  expectedScope?: AgentModelScope;
}

export function createLoopState(options: ToolModelLoopOptions): ToolModelLoopState {
  const controller = new AbortController();
  const signal =
    options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
  const model = options.model;
  return {
    requestId: options.requestId,
    goal: options.goal,
    endpoint: options.endpoint,
    budget: { ...options.budget },
    policy: options.policy === undefined ? undefined : snapshot(options.policy),
    signal,
    controller,
    started: performance.now(),
    ...(model.countInputTokens === undefined ? {} : { count: model.countInputTokens.bind(model) }),
    ...(model.estimateInputTokens === undefined ? {} : { estimate: model.estimateInputTokens.bind(model) }),
    complete: model.complete.bind(model),
    messages: [
      ...(options.instructions === undefined ? [] : [{ role: 'system' as const, text: options.instructions }]),
      { role: 'user', text: options.prompt },
    ],
    receipts: [],
    seen: new Map(),
    repeats: new Map(),
    turns: 0,
    modelRequests: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function remainingTime(state: ToolModelLoopState): number {
  return Math.max(0, state.budget.maxMilliseconds - (performance.now() - state.started));
}

export function remainingRequired(state: ToolModelLoopState): AgentCapabilityOperation[] {
  return (
    state.policy?.requiredOperationSequence
      .slice(requiredIndex(state.policy, state.receipts))
      .map((step) => step.operation) ?? []
  );
}

export function finish(state: ToolModelLoopState, stop: ToolModelStop, textDraft?: string): ToolModelLoopOutcome {
  const incompleteRequiredOperations = remainingRequired(state);
  return {
    ok: true,
    value: snapshot({
      stop,
      turns: state.turns,
      modelRequests: state.modelRequests,
      toolCalls: state.toolCalls,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      receipts: state.receipts,
      ...(textDraft === undefined ? {} : { textDraft }),
      ...(incompleteRequiredOperations.length === 0 ? {} : { incompleteRequiredOperations }),
    }),
  };
}

export async function boundary<T>(
  state: ToolModelLoopState,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | ToolModelStop> {
  if (state.signal.aborted) return 'cancelled';
  const timeout = remainingTime(state);
  if (timeout === 0) return 'budget';
  const result = await awaitAgentBoundary(work, state.signal, timeout);
  if (result.kind === 'value') return result.value;
  return BOUNDARY_STOPS[result.kind];
}

function stablePinsMatch(
  before: NonNullable<AgentModelScope['current']>,
  after: NonNullable<AgentModelScope['current']>,
): boolean {
  const pins = [
    'scopeDigest',
    'policyRevision',
    'catalogRevision',
    'experienceRevision',
    'functionRegistryDigest',
  ] as const;
  return pins.every((pin) => before[pin] === after[pin]);
}

function isExperienceCommit(receipt: AgentCapabilityReceipt): boolean {
  return (
    receipt.operation === 'experience.commit' &&
    (receipt.state === 'plan-committed' || receipt.state === 'renderer-ready')
  );
}

function validScopeTransition(
  previous: AgentModelScope,
  next: AgentModelScope,
  receipt: AgentCapabilityReceipt | undefined,
): boolean {
  if (receipt === undefined || previous.principalKey !== next.principalKey) return false;
  const before = previous.current;
  const after = next.current;
  if (before === undefined || after === undefined || !stablePinsMatch(before, after)) return false;
  if (isExperienceCommit(receipt)) return after.regionRevision === receipt.regionRevision;
  return validateCommitReadSet(before, after).ok;
}

export async function admit(
  state: ToolModelLoopState,
  receipt?: AgentCapabilityReceipt,
): Promise<ToolModelStop | undefined> {
  const scope = await boundary(state, (signal) => state.endpoint.authorizeModel({ signal }));
  if (typeof scope === 'string') return scope;
  if (!scope.ok) return scope.diagnostics.some((item) => item.code.endsWith('stale')) ? 'stale' : 'denied';
  const previous = state.expectedScope;
  if (
    previous !== undefined &&
    capabilityCanonical(previous) !== capabilityCanonical(scope.value) &&
    !validScopeTransition(previous, scope.value, receipt)
  )
    return 'stale';
  state.expectedScope = snapshot(scope.value);
  return undefined;
}

export function abort(state: ToolModelLoopState): void {
  state.controller.abort();
}

export function toolFingerprint(state: ToolModelLoopState, name: string, input: unknown): string {
  const scope = state.expectedScope;
  if (scope === undefined) return capabilityCanonical({ name, input, scope: undefined });
  const current = scope.current;
  const currentPins = current === undefined ? undefined : { ...current, results: [] };
  const fingerprintScope = { principalKey: scope.principalKey, current: currentPins };
  return capabilityCanonical({ name, input, scope: fingerprintScope });
}

export function currentRequiredOperation(state: ToolModelLoopState) {
  const index = requiredIndex(state.policy, state.receipts);
  return state.policy?.requiredOperationSequence[index];
}

export function makeRequest(
  state: ToolModelLoopState,
  tools: ToolModelRequest['tools'],
  required: ReturnType<typeof currentRequiredOperation>,
): ToolModelRequest {
  return snapshot({
    messages: state.messages,
    tools,
    toolChoice: required === undefined ? 'auto' : (state.policy?.providerToolChoice ?? 'auto'),
    maxOutputTokens: state.budget.maxOutputTokens,
  });
}
