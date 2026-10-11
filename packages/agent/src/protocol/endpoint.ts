import { parseWireValue, WIRE_LIMITS, type Outcome } from '@varendo/core';
import {
  awaitAgentBoundary,
  createAgentCapabilityDispatcher,
  normalizeAgentCapabilityRequest,
  normalizeAgentCapabilityAuthority,
} from '../capabilities/dispatcher.js';
import type { AgentCapabilityAuthority, AgentCapabilityHost } from '../capabilities/types.js';
import { boundedId as id, isRecord, localSchemaReferences, strictId } from '../guards.js';
import type {
  AgentModelScope,
  AgentModelToolEndpoint,
  AgentToolBinding,
  AgentToolDefinition,
  AgentToolEndpointOptions,
  AgentToolTransport,
} from './types.js';

const failure = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

const bound = (value: number, ceiling: number): boolean => Number.isSafeInteger(value) && value > 0 && value <= ceiling;

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)]))) as T;
}

interface EndpointLease {
  readonly now: () => number;
  readonly created: number;
  readonly monotonicStart: number;
  readonly leaseMilliseconds: number;
}

interface EndpointLimits {
  readonly maxPending: number;
  readonly maxMilliseconds: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

interface EndpointState extends EndpointLease, EndpointLimits {
  readonly transport: AgentToolTransport;
  readonly target: { readonly targetRegionId: string; readonly goalEpoch: string };
  readonly principalKey: string;
  readonly scopeDigest: string | undefined;
  readonly expiresAt: number;
  readonly sourceHost: AgentCapabilityHost['readContext'];
  readonly registry: AgentToolEndpointOptions['registry'];
  readonly tools: Map<string, AgentToolDefinition>;
  readonly lifetime: AbortController;
  pending: number;
  sequence: number;
}

type EndpointBoundary<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed' };

const SUPPORTED_TRANSPORTS: ReadonlySet<AgentToolTransport> = new Set(['manual', 'mcp', 'webmcp', 'byok']);

function supportedTransport(value: unknown): value is AgentToolTransport {
  return SUPPORTED_TRANSPORTS.has(value as AgentToolTransport);
}

function validPairing(input: AgentToolEndpointOptions): boolean {
  return (
    supportedTransport(input.transport) &&
    id(input.targetRegionId) &&
    id(input.goalEpoch) &&
    id(input.principalKey) &&
    (input.scopeDigest === undefined || id(input.scopeDigest))
  );
}

function hasHostPorts(input: AgentToolEndpointOptions): boolean {
  return (
    input.host !== null &&
    typeof input.host === 'object' &&
    typeof input.host.readContext === 'function' &&
    input.registry !== null &&
    typeof input.registry === 'object' &&
    typeof input.registry.get === 'function'
  );
}

function validEndpointInput(input: AgentToolEndpointOptions): boolean {
  return input !== null && typeof input === 'object' && validPairing(input) && hasHostPorts(input);
}

function readLease(input: AgentToolEndpointOptions): Outcome<EndpointLease> {
  const now = input.now ?? Date.now;
  let created: number;
  try {
    created = now();
  } catch {
    return failure('agent.protocol.clock', 'The pairing clock is unavailable.');
  }
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(input.expiresAt) ||
    input.expiresAt <= created ||
    input.expiresAt - created > 86_400_000
  )
    return failure('agent.protocol.lease', 'A pairing must expire within one day.');
  return {
    ok: true,
    value: {
      now,
      created,
      monotonicStart: performance.now(),
      leaseMilliseconds: input.expiresAt - created,
    },
  };
}

function endpointLimits(input: AgentToolEndpointOptions): Outcome<EndpointLimits> {
  const limits = {
    maxPending: input.maxPending ?? 8,
    maxMilliseconds: input.maxMilliseconds ?? 30_000,
    maxInputBytes: input.maxInputBytes ?? WIRE_LIMITS.bytes,
    maxOutputBytes: input.maxOutputBytes ?? WIRE_LIMITS.bytes,
  };
  if (
    !bound(limits.maxPending, 64) ||
    !bound(limits.maxMilliseconds, 300_000) ||
    !bound(limits.maxInputBytes, WIRE_LIMITS.bytes) ||
    !bound(limits.maxOutputBytes, WIRE_LIMITS.bytes)
  )
    return failure('agent.protocol.budget', 'Tool endpoint limits are outside their bounds.');
  return { ok: true, value: limits };
}

function validBindingIdentity(
  value: unknown,
  tools: ReadonlyMap<string, AgentToolDefinition>,
): value is AgentToolBinding {
  if (!isRecord(value)) return false;
  const binding = value as unknown as AgentToolBinding;
  return (
    strictId(binding.name) && !tools.has(binding.name) && id(binding.capability?.id) && id(binding.capability?.revision)
  );
}

function validInputSchema(binding: AgentToolBinding): boolean {
  const schema = binding.inputSchema;
  if (!isRecord(schema) || schema.type !== 'object') return false;
  if (!localSchemaReferences(schema)) return false;
  return new TextEncoder().encode(JSON.stringify(schema)).byteLength <= 65_536;
}

function registerBinding(
  raw: unknown,
  registry: AgentToolEndpointOptions['registry'],
  tools: Map<string, AgentToolDefinition>,
): Outcome<void> {
  if (!validBindingIdentity(raw, tools))
    return failure('agent.protocol.tools', 'Tool names and capability references must be unique and bounded.');
  const manifest = registry.get(raw.capability);
  if (!manifest || manifest.operation !== raw.operation)
    return failure('agent.protocol.tools', 'A tool must name an existing capability and its exact operation.');
  if (!validInputSchema(raw))
    return failure('agent.protocol.schema', 'A tool requires a bounded object schema with local references only.');
  tools.set(raw.name, freeze({ ...raw, description: manifest.description ?? manifest.label }));
  return { ok: true, value: undefined };
}

function registeredTools(input: AgentToolEndpointOptions): Outcome<Map<string, AgentToolDefinition>> {
  const inspected = parseWireValue(input.tools);
  if (!inspected.ok || !Array.isArray(inspected.value) || inspected.value.length > 64)
    return failure('agent.protocol.tools', 'Tool bindings must be a bounded array.');
  const tools = new Map<string, AgentToolDefinition>();
  for (const raw of inspected.value) {
    const added = registerBinding(raw, input.registry, tools);
    if (!added.ok) return added;
  }
  return { ok: true, value: tools };
}

function createEndpointState(input: AgentToolEndpointOptions): Outcome<EndpointState> {
  if (!validEndpointInput(input))
    return failure(
      'agent.protocol.invalid',
      'A tool endpoint requires a trusted principal and explicit region pairing.',
    );
  const lease = readLease(input);
  if (!lease.ok) return lease;
  const limits = endpointLimits(input);
  if (!limits.ok) return limits;
  const tools = registeredTools(input);
  if (!tools.ok) return tools;
  return {
    ok: true,
    value: {
      ...lease.value,
      ...limits.value,
      transport: input.transport,
      target: Object.freeze({ targetRegionId: input.targetRegionId, goalEpoch: input.goalEpoch }),
      principalKey: input.principalKey,
      scopeDigest: input.scopeDigest,
      expiresAt: input.expiresAt,
      sourceHost: input.host.readContext.bind(input.host),
      registry: input.registry,
      tools: tools.value,
      lifetime: new AbortController(),
      pending: 0,
      sequence: 0,
    },
  };
}

function remaining(state: EndpointState): number {
  if (state.lifetime.signal.aborted) return 0;
  try {
    const value = state.now();
    if (!Number.isFinite(value)) return 0;
    return Math.max(
      0,
      Math.min(
        state.maxMilliseconds,
        state.expiresAt - value,
        state.leaseMilliseconds - (performance.now() - state.monotonicStart),
      ),
    );
  } catch {
    return 0;
  }
}

async function readPairedContext(
  state: EndpointState,
  request: Parameters<AgentCapabilityHost['readContext']>[0],
): Promise<Outcome<AgentCapabilityAuthority>> {
  if (remaining(state) === 0 || request.signal.aborted)
    return failure('agent.protocol.stale', 'The tool pairing is closed or expired.');
  const result = await state.sourceHost(request);
  if (remaining(state) === 0 || request.signal.aborted)
    return failure('agent.protocol.stale', 'The tool pairing changed while reading authority.');
  if (!result || !result.ok) return failure('agent.protocol.denied', 'The host did not authorize this tool pairing.');
  const checked = normalizeAgentCapabilityAuthority(result.value, state.target);
  if (!checked.ok) return checked;
  if (
    checked.value.principalKey !== state.principalKey ||
    (state.scopeDigest !== undefined && checked.value.current?.scopeDigest !== state.scopeDigest)
  )
    return failure('agent.protocol.stale', 'The tool pairing no longer matches its authenticated scope.');
  return checked;
}

function pairedHost(state: EndpointState): AgentCapabilityHost {
  return { readContext: (request) => readPairedContext(state, request) };
}

const BOUNDARY_FAILURES: Readonly<
  Record<Exclude<EndpointBoundary<unknown>['kind'], 'value'>, readonly [string, string]>
> = {
  aborted: ['agent.protocol.cancelled', 'The tool request was cancelled.'],
  deadline: ['agent.protocol.time-budget', 'The tool request exceeded its time budget.'],
  failed: ['agent.protocol.failed', 'The tool request failed safely.'],
};

function boundaryOutcome<T>(state: EndpointState, result: EndpointBoundary<Outcome<T>>): Outcome<T> {
  if (result.kind !== 'value') return failure(...BOUNDARY_FAILURES[result.kind]);
  if (remaining(state) === 0) return failure('agent.protocol.stale', 'The tool pairing expired before delivery.');
  return result.value;
}

async function within<T>(
  state: EndpointState,
  work: (signal: AbortSignal) => Promise<Outcome<T>>,
  signal?: AbortSignal,
): Promise<Outcome<T>> {
  const milliseconds = remaining(state);
  if (milliseconds === 0) return failure('agent.protocol.stale', 'The tool pairing is closed or expired.');
  if (signal?.aborted) return failure('agent.protocol.cancelled', 'The tool request was cancelled.');
  if (state.pending >= state.maxPending) return failure('agent.protocol.budget', 'The tool endpoint is at capacity.');
  state.pending += 1;
  try {
    const parent = signal === undefined ? state.lifetime.signal : AbortSignal.any([signal, state.lifetime.signal]);
    const result = await awaitAgentBoundary(work, parent, milliseconds);
    return boundaryOutcome(state, result);
  } finally {
    state.pending -= 1;
  }
}

async function authority(state: EndpointState, signal: AbortSignal): Promise<Outcome<AgentCapabilityAuthority>> {
  state.sequence += 1;
  return readPairedContext(state, {
    ...state.target,
    requestId: `tool-discovery-${state.sequence}`,
    signal,
  });
}

async function authorizeModel(state: EndpointState, signal?: AbortSignal): Promise<Outcome<AgentModelScope>> {
  return within(
    state,
    async (requestSignal) => {
      const checked = await authority(state, requestSignal);
      if (!checked.ok) return checked;
      if (!checked.value.grants.includes('model.egress'))
        return failure('agent.protocol.egress', 'The host did not permit model egress.');
      return {
        ok: true,
        value: freeze({
          principalKey: checked.value.principalKey,
          ...(checked.value.current === undefined ? {} : { current: checked.value.current }),
        }),
      };
    },
    signal,
  );
}

function availableTools(
  state: EndpointState,
  authority: AgentCapabilityAuthority,
): Outcome<readonly AgentToolDefinition[]> {
  const available = Object.freeze(
    [...state.tools.values()].filter((tool) => authority.grants.includes(tool.operation)),
  );
  if (new TextEncoder().encode(JSON.stringify(available)).byteLength > state.maxOutputBytes)
    return failure('agent.protocol.bytes', 'Tool discovery exceeds its output budget.');
  return { ok: true, value: available };
}

async function discoverTools(
  state: EndpointState,
  signal?: AbortSignal,
): Promise<Outcome<readonly AgentToolDefinition[]>> {
  return within(
    state,
    async (requestSignal) => {
      const checked = await authority(state, requestSignal);
      if (!checked.ok) return checked;
      if (state.transport !== 'manual' && !checked.value.grants.includes('model.egress'))
        return failure('agent.protocol.egress', 'The host did not permit external tool metadata.');
      return availableTools(state, checked.value);
    },
    signal,
  );
}

async function invokeTool(
  state: EndpointState,
  dispatcher: ReturnType<typeof createAgentCapabilityDispatcher>,
  name: string,
  payload: unknown,
  options: Parameters<AgentModelToolEndpoint['invoke']>[2],
): ReturnType<AgentModelToolEndpoint['invoke']> {
  if (!options || !id(options.requestId))
    return failure('agent.protocol.invalid', 'A tool call requires a bounded request identity.');
  const tool = state.tools.get(name);
  if (tool === undefined) return failure('agent.protocol.unsupported', 'The requested tool is not registered.');
  const request = normalizeAgentCapabilityRequest({
    version: '1',
    requestId: options.requestId,
    ...state.target,
    capability: tool.capability,
    operation: tool.operation,
    input: payload,
  });
  if (!request.ok) return request;
  return within(
    state,
    (signal) => dispatcher.dispatch(request.value, { signal, transport: state.transport }),
    options?.signal,
  );
}

function endpoint(state: EndpointState): AgentModelToolEndpoint {
  const host = pairedHost(state);
  const dispatcher = createAgentCapabilityDispatcher({
    host,
    registry: state.registry,
    maxPending: state.maxPending,
    maxMilliseconds: state.maxMilliseconds,
    maxInputBytes: state.maxInputBytes,
    maxOutputBytes: state.maxOutputBytes,
  });
  const value: AgentModelToolEndpoint = {
    transport: state.transport,
    ...state.target,
    authorizeModel: (options = {}) => authorizeModel(state, options.signal),
    discover: (options = {}) => discoverTools(state, options.signal),
    invoke: (name, payload, options) => invokeTool(state, dispatcher, name, payload, options),
    close: () => state.lifetime.abort(),
  };
  return Object.freeze(value);
}

/** One expiring, explicitly paired region uses the same capability dispatcher as manual calls. */
export function createAgentToolEndpoint(input: AgentToolEndpointOptions): Outcome<AgentModelToolEndpoint> {
  const state = createEndpointState(input);
  if (!state.ok) return state;
  return { ok: true, value: endpoint(state.value) };
}
