import type { Outcome } from '@varendo/core';
import type {
  AgentCapabilityAuthority,
  AgentCapabilityContext,
  AgentCapabilityDispatcherOptions,
  AgentCapabilityHandlerResult,
  AgentCapabilityManifest,
  AgentCapabilityRequest,
  AgentCapabilityState,
  AgentCapabilityTransport,
} from './types.js';
import { flowFinished, flowReady } from './dispatcher-flow-state.js';
import { awaitAgentBoundary, type BoundaryResult } from './dispatcher-boundary.js';
import { failure, normalizeTransport, sameRef, utf8Bytes } from './dispatcher-common.js';
import type { DispatchConfiguration, PendingDispatches } from './dispatcher-config.js';
import type { AuthorizedCapability, FlowStep, PreparedDispatch, ReceiptOutcome } from './dispatcher-flow-state.js';
import { normalizeAgentCapabilityAuthority } from './dispatcher-input.js';
import { allowedState, failureReceipt, normalizeHandlerResult } from './dispatcher-result.js';

const EXTERNAL_TRANSPORTS = new Set<AgentCapabilityTransport>(['mcp', 'webmcp', 'byok']);
type BoundaryFailure = Exclude<BoundaryResult<unknown>, { readonly kind: 'value' }>;

function validateTrustedTransport(
  request: AgentCapabilityRequest,
  input: AgentCapabilityTransport | undefined,
): FlowStep<AgentCapabilityTransport> {
  const transport = input ?? 'direct';
  if (normalizeTransport(transport) !== transport)
    return flowFinished(failure('agent.capability.transport', 'The trusted dispatch transport is invalid.'));
  if (!EXTERNAL_TRANSPORTS.has(transport) && transport !== 'direct' && transport !== 'manual')
    return flowFinished(
      failureReceipt(
        request,
        'direct',
        'invalid',
        'agent.capability.transport',
        'The trusted dispatch transport is unsupported.',
      ),
    );
  return flowReady(transport);
}

function registeredManifest(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  options: AgentCapabilityDispatcherOptions,
): FlowStep<AgentCapabilityManifest<unknown, unknown>> {
  const manifest = options.registry.get(request.capability);
  if (manifest === undefined)
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'unsupported',
        'agent.capability.unknown',
        'The requested capability is not registered.',
      ),
    );
  if (!sameRef(manifest.ref, request.capability) || manifest.operation !== request.operation)
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'invalid',
        'agent.capability.operation',
        'The capability reference and operation do not match.',
      ),
    );
  return flowReady(manifest);
}

function validateInputBudget(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  manifest: AgentCapabilityManifest<unknown, unknown>,
  maxInputBytes: number,
): ReceiptOutcome | undefined {
  const payloadBytes = utf8Bytes(request.input);
  const inputLimit = Math.min(maxInputBytes, manifest.limits?.maxInputBytes ?? maxInputBytes);
  if (payloadBytes !== undefined && payloadBytes > inputLimit)
    return failureReceipt(
      request,
      transport,
      'invalid',
      'agent.capability.bytes',
      'Capability input exceeds its configured byte budget.',
    );
  return undefined;
}

export function prepareDispatch(
  request: AgentCapabilityRequest,
  dispatchOptions: { readonly signal?: AbortSignal; readonly transport?: AgentCapabilityTransport },
  configuration: DispatchConfiguration,
  pending: PendingDispatches,
): FlowStep<PreparedDispatch> {
  const trusted = validateTrustedTransport(request, dispatchOptions.transport);
  if (trusted.kind === 'finished') return trusted;
  const transport = trusted.value;
  if (dispatchOptions.signal?.aborted)
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'cancelled',
        'agent.capability.cancelled',
        'Capability dispatch was cancelled before authority inspection.',
      ),
    );
  const manifest = registeredManifest(request, transport, configuration.options);
  if (manifest.kind === 'finished') return manifest;
  const budgetFailure = validateInputBudget(request, transport, manifest.value, configuration.maxInputBytes);
  if (budgetFailure !== undefined) return flowFinished(budgetFailure);
  if (pending.count >= configuration.maxPending)
    return flowFinished(
      failureReceipt(request, transport, 'failed', 'agent.capability.budget', 'The capability dispatch queue is full.'),
    );
  return flowReady({ request, transport, manifest: manifest.value });
}

function hostBoundaryFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: BoundaryFailure,
): ReceiptOutcome {
  switch (result.kind) {
    case 'deadline':
      return failureReceipt(
        request,
        transport,
        'failed',
        'agent.capability.time-budget',
        'Authority inspection exceeded its time budget.',
      );
    case 'aborted':
      return failureReceipt(
        request,
        transport,
        'cancelled',
        'agent.capability.cancelled',
        'Capability dispatch was cancelled.',
      );
    case 'failed':
      return failureReceipt(
        request,
        transport,
        'denied',
        'agent.capability.denied',
        'The host authority context could not be read safely.',
      );
  }
}

function hostReadFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  diagnostics: readonly { readonly code: string; readonly message: string }[],
): ReceiptOutcome {
  const first = diagnostics[0];
  const external = EXTERNAL_TRANSPORTS.has(transport);
  const code = external ? 'agent.capability.denied' : (first?.code ?? 'agent.capability.denied');
  const message = external
    ? 'The host did not authorize capability inspection.'
    : (first?.message ?? 'The host did not authorize capability inspection.');
  return failureReceipt(request, transport, 'denied', code, message);
}

function normalizeInitialAuthority(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  value: unknown,
): FlowStep<AgentCapabilityAuthority> {
  const authority = normalizeAgentCapabilityAuthority(value, request);
  if (!authority.ok) {
    const first = authority.diagnostics[0];
    const state: AgentCapabilityState = first?.code === 'agent.capability.stale' ? 'stale' : 'denied';
    return flowFinished(
      failureReceipt(
        request,
        transport,
        state,
        first?.code ?? 'agent.capability.denied',
        first?.message ?? 'The host authority context is unavailable.',
      ),
    );
  }
  if (!authority.value.grants.includes(request.operation))
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'denied',
        'agent.capability.grant',
        'The host did not grant this capability operation.',
      ),
    );
  return flowReady(authority.value);
}

async function readInitialAuthority(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  signal: AbortSignal | undefined,
  configuration: DispatchConfiguration,
): Promise<FlowStep<AgentCapabilityAuthority>> {
  const boundary = await awaitAgentBoundary(
    (innerSignal) =>
      configuration.options.host.readContext({
        requestId: request.requestId,
        targetRegionId: request.targetRegionId,
        goalEpoch: request.goalEpoch,
        signal: innerSignal,
      }),
    signal,
    configuration.maxMilliseconds,
  );
  if (boundary.kind !== 'value') return flowFinished(hostBoundaryFailure(request, transport, boundary));
  const hostResult = boundary.value as Outcome<unknown>;
  if (!hostResult.ok) return flowFinished(hostReadFailure(request, transport, hostResult.diagnostics));
  return normalizeInitialAuthority(request, transport, hostResult.value);
}

function parseManifestInput(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  manifest: AgentCapabilityManifest<unknown, unknown>,
): FlowStep<unknown> {
  let parsed: Outcome<unknown>;
  try {
    parsed = manifest.parse(request.input);
  } catch {
    parsed = failure('agent.capability.input', 'The capability input could not be parsed safely.');
  }
  if (parsed.ok) return flowReady(parsed.value);
  const first = parsed.diagnostics[0];
  const external = EXTERNAL_TRANSPORTS.has(transport);
  return flowFinished(
    failureReceipt(
      request,
      transport,
      'invalid',
      external ? 'agent.capability.input' : (first?.code ?? 'agent.capability.input'),
      external ? 'The capability input is invalid.' : (first?.message ?? 'The capability input is invalid.'),
    ),
  );
}

export async function authorizeCapability(
  prepared: PreparedDispatch,
  signal: AbortSignal | undefined,
  configuration: DispatchConfiguration,
): Promise<FlowStep<AuthorizedCapability>> {
  const authority = await readInitialAuthority(prepared.request, prepared.transport, signal, configuration);
  if (authority.kind === 'finished') return authority;
  const input = parseManifestInput(prepared.request, prepared.transport, prepared.manifest);
  if (input.kind === 'finished') return input;
  const context: AgentCapabilityContext = Object.freeze({
    requestId: prepared.request.requestId,
    targetRegionId: prepared.request.targetRegionId,
    goalEpoch: prepared.request.goalEpoch,
    signal: signal ?? new AbortController().signal,
    transport: prepared.transport,
    authority: authority.value,
  });
  return flowReady({ authority: authority.value, context, input: input.value });
}

function invocationBoundaryFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: BoundaryFailure,
): ReceiptOutcome {
  switch (result.kind) {
    case 'deadline':
      return failureReceipt(
        request,
        transport,
        'failed',
        'agent.capability.time-budget',
        'Capability execution exceeded its time budget.',
      );
    case 'aborted':
      return failureReceipt(
        request,
        transport,
        'cancelled',
        'agent.capability.cancelled',
        'Capability execution was cancelled.',
      );
    case 'failed':
      return failureReceipt(
        request,
        transport,
        'failed',
        'agent.capability.handler',
        'The capability handler failed safely.',
      );
  }
}

function normalizedInvocation(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  raw: unknown,
): FlowStep<AgentCapabilityHandlerResult<unknown>> {
  const normalized = normalizeHandlerResult(raw as AgentCapabilityHandlerResult<unknown>);
  if (!normalized.ok) {
    const external = EXTERNAL_TRANSPORTS.has(transport);
    const first = normalized.diagnostics[0];
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'failed',
        external ? 'agent.capability.output' : (first?.code ?? 'agent.capability.output'),
        external ? 'The capability output was invalid.' : (first?.message ?? 'The capability output was invalid.'),
      ),
    );
  }
  if (!allowedState(request.operation, normalized.value.state))
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'invalid',
        'agent.capability.stage',
        'The capability returned a stage that its operation cannot produce.',
      ),
    );
  if (
    (normalized.value.state === 'renderer-ready' || normalized.value.state === 'plan-committed') &&
    normalized.value.regionRevision === undefined
  )
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'invalid',
        'agent.capability.stage',
        'A committed presentation receipt must identify the committed region revision.',
      ),
    );
  return flowReady(normalized.value);
}

export async function invokeCapability(
  prepared: PreparedDispatch,
  authorized: AuthorizedCapability,
  signal: AbortSignal | undefined,
  configuration: DispatchConfiguration,
  startedAt: number,
): Promise<FlowStep<AgentCapabilityHandlerResult<unknown>>> {
  const remaining = Math.max(1, configuration.maxMilliseconds - (performance.now() - startedAt));
  const invocation = await awaitAgentBoundary(
    (innerSignal) => prepared.manifest.invoke(authorized.input, { ...authorized.context, signal: innerSignal }),
    signal,
    remaining,
  );
  if (invocation.kind !== 'value')
    return flowFinished(invocationBoundaryFailure(prepared.request, prepared.transport, invocation));
  return normalizedInvocation(prepared.request, prepared.transport, invocation.value);
}
