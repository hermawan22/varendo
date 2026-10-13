import type { Outcome } from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentModelToolEndpoint, AgentToolDefinition, AgentToolTransport } from '../protocol/types.js';
import { runToolModel } from '../model/loop.js';
import type { ToolModelBudget, ToolModelLoopOutcome, ToolModelRunPolicy } from '../model/types.js';
import type { ScopeController, ScopeSnapshot, SurfaceRequest } from '@varendo/runtime';
import {
  createScopedSurfaceEndpoint as makeScopedSurfaceEndpoint,
  diagnostic,
  failure,
  MAX_TARGETS,
  validId,
} from './endpoint.js';
import type {
  AgentClient,
  AgentClientHandle,
  AgentClientPairing,
  AgentConnection,
  AgentConnectionSnapshot,
  AgentSurfaceTarget,
} from './types.js';

export { createScopedSurfaceEndpoint } from './endpoint.js';

const DEFAULT_LEASE = 15 * 60_000;
const DEFAULT_BUDGET: ToolModelBudget = Object.freeze({
  maxTurns: 6,
  maxModelRequests: 12,
  maxToolCalls: 12,
  maxMilliseconds: 30_000,
  maxInputTokens: 8_000,
  maxOutputTokens: 2_000,
  maxTotalTokens: 12_000,
  maxInputBytes: 64_000,
  maxOutputBytes: 32_000,
  maxRepeatedCalls: 1,
});
const DEFAULT_POLICY: ToolModelRunPolicy = {
  requiredOperationSequence: [{ operation: 'experience.commit' as const, acceptedStates: ['renderer-ready' as const] }],
  providerToolChoice: 'required',
};

let nextPairingId = 1;

function sameActivation(left: ScopeSnapshot, right: ScopeSnapshot): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.scopeInstanceId === right.scopeInstanceId &&
    left.activationEpoch === right.activationEpoch &&
    left.permissionRevision === right.permissionRevision &&
    left.active === right.active &&
    left.status === right.status &&
    left.revision === right.revision &&
    left.policyRevision === right.policyRevision
  );
}

function freshId(prefix: string): string {
  return `varendo-${prefix}-${Date.now().toString(36)}-${nextPairingId++}`;
}

interface PairingState {
  readonly endpoint: AgentModelToolEndpoint;
  readonly sessionId: string;
  readonly goalEpoch: string;
  readonly scope: ScopeSnapshot;
  readonly handle: AgentClientHandle | undefined;
}

function resolveTarget(client: AgentClient, targetId: string): AgentSurfaceTarget | undefined {
  try {
    const resolver = client.resolveTarget ?? client.getTarget;
    if (resolver !== undefined) return resolver(targetId);
    return client.registeredTargets?.find((target) => target.id === targetId);
  } catch {
    return undefined;
  }
}

function resolvedTargets(
  client: AgentClient,
  targetIds: readonly string[],
): { readonly targets: readonly AgentSurfaceTarget[]; readonly complete: boolean } {
  const values: AgentSurfaceTarget[] = [];
  for (const id of targetIds) {
    const target = resolveTarget(client, id);
    if (target !== undefined) values.push(target);
  }
  return { targets: Object.freeze(values), complete: values.length === targetIds.length };
}

function connectClient(client: AgentClient, pairing: AgentClientPairing): AgentClientHandle | undefined {
  const hook = client.connect ?? client.onConnect;
  if (hook === undefined) return undefined;
  const handle = hook(pairing);
  if (handle === undefined) return undefined;
  if (typeof handle !== 'object' || handle === null || typeof handle.disconnect !== 'function')
    throw new TypeError('An agent client connection must expose disconnect().');
  return handle;
}

function closePairing(pairing: PairingState | undefined): void {
  if (pairing === undefined) return;
  try {
    pairing.handle?.disconnect();
  } catch {
    // A client cannot keep an old scope pairing alive during a fence.
  }
  pairing.endpoint.close();
}

function noEndpoint<T>(status: AgentConnectionSnapshot['status']): Outcome<T> {
  return failure(`agent.bridge.${status}`, 'The scoped agent connection has no active tool endpoint.');
}

function noLoopOutcome(status: AgentConnectionSnapshot['status']): ToolModelLoopOutcome {
  return failure(`agent.bridge.${status}`, 'The scoped agent connection has no active model endpoint.');
}

function validTargets(targets: readonly string[]): boolean {
  return (
    Array.isArray(targets) &&
    targets.length > 0 &&
    targets.length <= MAX_TARGETS &&
    targets.every(validId) &&
    new Set(targets).size === targets.length
  );
}

function makePairing(
  input: ConnectAgentInput,
  targetIds: readonly string[],
  transport: AgentToolTransport,
): { readonly pairing?: PairingState; readonly status: AgentConnectionSnapshot['status'] } {
  const current = input.scope.getSnapshot();
  const resolved = resolvedTargets(input.client, targetIds);
  const sessionId = freshId('session');
  const goalEpoch = freshId('goal');
  const endpoint = makeScopedSurfaceEndpoint({
    scope: input.scope,
    sessionId,
    goalEpoch,
    targets: resolved.targets,
    transport,
    expiresAt: Date.now() + DEFAULT_LEASE,
    ...(input.grants === undefined ? {} : { grants: input.grants }),
  });
  if (!endpoint.ok) return { status: 'denied' };
  let handle: AgentClientHandle | undefined;
  if (current.active && resolved.complete) {
    try {
      handle = connectClient(input.client, {
        sessionId,
        goalEpoch,
        scope: input.scope,
        targets: targetIds,
        endpoint: endpoint.value,
        transport,
      });
    } catch {
      endpoint.value.close();
      return { status: 'denied' };
    }
  }
  return {
    pairing: { endpoint: endpoint.value, sessionId, goalEpoch, scope: current, handle },
    status: pairingStatus(current, resolved.complete),
  };
}

function pairingStatus(scope: ScopeSnapshot, targetsComplete: boolean): AgentConnectionSnapshot['status'] {
  if (!scope.active) return 'stale';
  if (targetsComplete) return 'connected';
  return 'denied';
}

function runModel(
  endpoint: AgentModelToolEndpoint,
  client: AgentClient,
  prompt: string,
  options: { readonly signal?: AbortSignal; readonly budget?: ToolModelBudget; readonly policy?: ToolModelRunPolicy },
  requestId: string,
): Promise<ToolModelLoopOutcome> {
  if (endpoint.transport !== 'byok')
    return Promise.resolve({
      ok: true,
      value: {
        stop: 'denied',
        turns: 0,
        modelRequests: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        receipts: [],
      },
    });
  const model = client.model ?? client.modelPort;
  if (model === undefined)
    return Promise.resolve({
      ok: false,
      diagnostics: [
        diagnostic('agent.bridge.model', 'The host client did not provide a fake or application model port.'),
      ],
    });
  return runToolModel({
    requestId,
    goal: 'experience',
    prompt,
    endpoint,
    model,
    budget: options.budget ?? DEFAULT_BUDGET,
    policy: options.policy ?? DEFAULT_POLICY,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }).then((result) => {
    if (!result.ok || result.value.stop !== 'required-sequence' || result.value.receipts.length !== 0) return result;
    // This is only a label for the loop's trusted missing-receipt outcome.
    return { ok: true, value: { ...result.value, stop: 'no-commit' as const } };
  });
}

interface AgentConnectionState {
  status: AgentConnectionSnapshot['status'];
  current: PairingState | undefined;
  requestSequence: number;
  closed: boolean;
}

interface ConnectAgentInput {
  readonly scope: ScopeController;
  readonly client: AgentClient;
  readonly targets: readonly string[];
  /** Host-delegated grant ceiling for the pairing; intersected with the endpoint's required operations. */
  readonly grants?: readonly OperationGrant[];
}

function validateConnectionInput(input: ConnectAgentInput): void {
  if (
    input === null ||
    typeof input !== 'object' ||
    input.scope === undefined ||
    typeof input.scope.getSnapshot !== 'function' ||
    typeof input.scope.subscribe !== 'function' ||
    input.client?.kind !== 'host-agent-client'
  )
    throw new TypeError('connectAgent requires a ScopeController and host-owned agent client.');
}

function createConnectionState(
  input: ConnectAgentInput,
  targetIds: readonly string[],
  transport: AgentToolTransport,
): AgentConnectionState {
  const initialStatus = validTargets(targetIds) ? undefined : ('denied' as const);
  const state: AgentConnectionState = {
    status: initialStatus ?? 'connected',
    current: undefined,
    requestSequence: 0,
    closed: false,
  };
  if (initialStatus === undefined) {
    const created = makePairing(input, targetIds, transport);
    state.current = created.pairing;
    state.status = created.status;
  }
  return state;
}

function subscribeScope(
  input: ConnectAgentInput,
  targetIds: readonly string[],
  transport: AgentToolTransport,
  state: AgentConnectionState,
): () => void {
  return input.scope.subscribe(() => {
    if (state.closed || state.current === undefined) return;
    const next = input.scope.getSnapshot();
    if (sameActivation(state.current.scope, next)) return;
    closePairing(state.current);
    state.current = undefined;
    state.status = 'stale';
    if (!next.active) return;
    const rebound = makePairing(input, targetIds, transport);
    state.current = rebound.pairing;
    state.status = rebound.status;
  });
}

function activeEndpoint(state: AgentConnectionState): AgentModelToolEndpoint | undefined {
  if (state.closed || state.status !== 'connected') return undefined;
  return state.current?.endpoint;
}

function createAgentConnection(
  input: ConnectAgentInput,
  targetIds: readonly string[],
  state: AgentConnectionState,
  stopScope: () => void,
): AgentConnection {
  const inspect = (): AgentConnectionSnapshot => {
    const scope = input.scope.getSnapshot();
    return Object.freeze({
      status: state.closed ? 'disconnected' : state.status,
      ...(state.current === undefined
        ? {}
        : { sessionId: state.current.sessionId, goalEpoch: state.current.goalEpoch }),
      scopeInstanceId: scope.scopeInstanceId,
      activationEpoch: scope.activationEpoch,
      targets: targetIds,
    });
  };
  const endpoint = (): AgentModelToolEndpoint | undefined => activeEndpoint(state);
  const discover = (options: { readonly signal?: AbortSignal } = {}) => {
    const value = endpoint();
    return value === undefined
      ? Promise.resolve(noEndpoint<readonly AgentToolDefinition[]>(state.status))
      : value.discover(options);
  };
  const invoke = (
    name: string,
    value: unknown,
    options: { readonly requestId?: string; readonly signal?: AbortSignal } = {},
  ) => {
    const valueEndpoint = endpoint();
    if (valueEndpoint === undefined) return Promise.resolve(noEndpoint<AgentCapabilityReceipt>(state.status));
    return valueEndpoint.invoke(name, value, {
      requestId: options.requestId ?? freshId(`request-${++state.requestSequence}`),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  };
  const render = (
    targetId: string,
    intent: SurfaceRequest<unknown>,
    options: { readonly requestId?: string; readonly signal?: AbortSignal } = {},
  ) => invoke('varendo_surface_render', { targetId, intent }, options);
  const runExperience = (
    prompt: string,
    options: {
      readonly signal?: AbortSignal;
      readonly budget?: ToolModelBudget;
      readonly policy?: ToolModelRunPolicy;
    } = {},
  ) => {
    const valueEndpoint = endpoint();
    if (valueEndpoint === undefined) return Promise.resolve(noLoopOutcome(state.status));
    return runModel(valueEndpoint, input.client, prompt, options, freshId(`experience-${++state.requestSequence}`));
  };
  const disconnect = (): void => {
    if (state.closed) return;
    state.closed = true;
    stopScope();
    closePairing(state.current);
    state.current = undefined;
    state.status = 'disconnected';
  };
  return Object.freeze({
    disconnect,
    inspect,
    get endpoint() {
      return endpoint();
    },
    discover,
    invoke,
    render,
    runExperience,
  });
}

/** Pairs an application-owned client to an explicit scope and target allowlist. */
export function connectAgent(input: ConnectAgentInput): AgentConnection {
  validateConnectionInput(input);
  const targetIds = Object.freeze([...(input.targets ?? [])]);
  const transport = input.client.transport ?? 'byok';
  const state = createConnectionState(input, targetIds, transport);
  const stopScope = subscribeScope(input, targetIds, transport, state);
  return createAgentConnection(input, targetIds, state, stopScope);
}
