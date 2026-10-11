import type { AgentCapabilityRequest, AgentCapabilityTransport } from './types.js';
import { failureReceipt } from './dispatcher-result.js';
import type { DispatchConfiguration, PendingDispatches } from './dispatcher-config.js';
import { normalizeAgentCapabilityRequest } from './dispatcher-input.js';
import type { PreparedDispatch, ReceiptOutcome } from './dispatcher-flow-state.js';
import { authorizeCapability, invokeCapability, prepareDispatch } from './dispatcher-admission.js';
import { projectResult, recheckAuthority } from './dispatcher-completion.js';

async function runPreparedDispatch(
  prepared: PreparedDispatch,
  signal: AbortSignal | undefined,
  configuration: DispatchConfiguration,
  startedAt: number,
): Promise<ReceiptOutcome> {
  const authorized = await authorizeCapability(prepared, signal, configuration);
  if (authorized.kind === 'finished') return authorized.result;
  const invocation = await invokeCapability(prepared, authorized.value, signal, configuration, startedAt);
  if (invocation.kind === 'finished') return invocation.result;
  const authority = await recheckAuthority(
    prepared,
    authorized.value,
    invocation.value,
    signal,
    configuration,
    startedAt,
  );
  if (authority.kind === 'finished') return authority.result;
  return projectResult(prepared, invocation.value, authority.value, configuration.maxOutputBytes);
}

export async function dispatchCapability(
  input: AgentCapabilityRequest | unknown,
  dispatchOptions: { readonly signal?: AbortSignal; readonly transport?: AgentCapabilityTransport },
  configuration: DispatchConfiguration,
  pending: PendingDispatches,
): Promise<ReceiptOutcome> {
  const request = normalizeAgentCapabilityRequest(input);
  if (!request.ok) return request;
  const prepared = prepareDispatch(request.value, dispatchOptions, configuration, pending);
  if (prepared.kind === 'finished') return prepared.result;
  pending.count++;
  const startedAt = performance.now();
  try {
    return await runPreparedDispatch(prepared.value, dispatchOptions.signal, configuration, startedAt);
  } catch {
    return failureReceipt(
      prepared.value.request,
      prepared.value.transport,
      'failed',
      'agent.capability.failed',
      'Capability dispatch failed safely.',
    );
  } finally {
    pending.count = Math.max(0, pending.count - 1);
  }
}
