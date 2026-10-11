import { parseWireValue, type Outcome } from '@varendo/core';
import type {
  AgentCapabilityAuthority,
  AgentCapabilityHandlerResult,
  AgentCapabilityManifest,
  AgentCapabilityRequest,
  AgentCapabilityTransport,
  AgentJsonValue,
} from './types.js';
import type { AuthorizedCapability, FlowStep, PreparedDispatch, ReceiptOutcome } from './dispatcher-flow-state.js';
import { flowFinished, flowReady } from './dispatcher-flow-state.js';
import { awaitAgentBoundary, type BoundaryResult } from './dispatcher-boundary.js';
import { utf8Bytes } from './dispatcher-common.js';
import type { DispatchConfiguration } from './dispatcher-config.js';
import { normalizeAgentCapabilityAuthority } from './dispatcher-input.js';
import {
  changedAuthority,
  cleanDiagnostics,
  failureReceipt,
  hasDataOutput,
  outputScopeMatches,
  receipt,
} from './dispatcher-result.js';

const EXTERNAL_TRANSPORTS = new Set<AgentCapabilityTransport>(['mcp', 'webmcp', 'byok']);
type BoundaryFailure = Exclude<BoundaryResult<unknown>, { readonly kind: 'value' }>;

function recoveryReceipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  message: string,
): ReceiptOutcome {
  return failureReceipt(request, transport, 'partial', 'agent.capability.recovery', message);
}

function finalBoundaryReceipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: BoundaryFailure,
): ReceiptOutcome {
  switch (result.kind) {
    case 'deadline':
      return failureReceipt(
        request,
        transport,
        'partial',
        'agent.capability.time-budget',
        'Authority recheck exceeded its time budget after the capability boundary.',
      );
    case 'aborted':
      return failureReceipt(
        request,
        transport,
        'cancelled',
        'agent.capability.cancelled',
        'Capability dispatch was cancelled during authority recheck.',
      );
    case 'failed':
      return recoveryReceipt(
        request,
        transport,
        'The capability completed across an unavailable authority recheck; inspect the recovery receipt.',
      );
  }
}

function verifyAuthorityResult(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: Outcome<unknown>,
): FlowStep<AgentCapabilityAuthority> {
  if (!result.ok)
    return flowFinished(
      recoveryReceipt(
        request,
        transport,
        'The capability completed across an unavailable authority recheck; inspect the recovery receipt.',
      ),
    );
  const authority = normalizeAgentCapabilityAuthority(result.value, request);
  if (!authority.ok)
    return flowFinished(
      recoveryReceipt(
        request,
        transport,
        'The capability completed across a changed authority; inspect the recovery receipt.',
      ),
    );
  return flowReady(authority.value);
}

function compareAuthority(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  before: AgentCapabilityAuthority,
  after: AgentCapabilityAuthority,
  result: AgentCapabilityHandlerResult<unknown>,
): FlowStep<AgentCapabilityAuthority> {
  const change = changedAuthority(before, after, request.operation, result.state);
  if (change === 'denied')
    return flowFinished(
      recoveryReceipt(
        request,
        transport,
        'The capability completed while its grant was revoked; inspect the recovery receipt.',
      ),
    );
  if (change === 'changed')
    return flowFinished(
      recoveryReceipt(
        request,
        transport,
        'The capability completed while its authority pins changed; inspect the recovery receipt.',
      ),
    );
  return flowReady(after);
}

export async function recheckAuthority(
  prepared: PreparedDispatch,
  authorized: AuthorizedCapability,
  result: AgentCapabilityHandlerResult<unknown>,
  signal: AbortSignal | undefined,
  configuration: DispatchConfiguration,
  startedAt: number,
): Promise<FlowStep<AgentCapabilityAuthority>> {
  const boundary = await awaitAgentBoundary(
    (innerSignal) =>
      configuration.options.host.readContext({
        requestId: prepared.request.requestId,
        targetRegionId: prepared.request.targetRegionId,
        goalEpoch: prepared.request.goalEpoch,
        signal: innerSignal,
      }),
    signal,
    Math.max(1, configuration.maxMilliseconds - (performance.now() - startedAt)),
  );
  if (boundary.kind !== 'value')
    return flowFinished(finalBoundaryReceipt(prepared.request, prepared.transport, boundary));
  const normalized = verifyAuthorityResult(prepared.request, prepared.transport, boundary.value as Outcome<unknown>);
  if (normalized.kind === 'finished') return normalized;
  return compareAuthority(prepared.request, prepared.transport, authorized.authority, normalized.value, result);
}

function parseOutput(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  value: unknown,
): FlowStep<AgentJsonValue | undefined> {
  if (value === undefined) return flowReady(undefined);
  const output = parseWireValue(value);
  if (!output.ok)
    return flowFinished(
      failureReceipt(
        request,
        transport,
        'failed',
        'agent.capability.output',
        'The capability output is not wire data.',
      ),
    );
  return flowReady(output.value as AgentJsonValue);
}

function outputBudgetFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  manifest: AgentCapabilityManifest<unknown, unknown>,
  output: AgentJsonValue | undefined,
  maxOutputBytes: number,
): ReceiptOutcome | undefined {
  const outputBytes = output === undefined ? 0 : utf8Bytes(output);
  const outputLimit = Math.min(maxOutputBytes, manifest.limits?.maxOutputBytes ?? maxOutputBytes);
  if (outputBytes !== undefined && outputBytes > outputLimit)
    return failureReceipt(
      request,
      transport,
      'failed',
      'agent.capability.bytes',
      'Capability output exceeds its configured byte budget.',
    );
  return undefined;
}

function outputScopeFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: AgentCapabilityHandlerResult<unknown>,
  output: AgentJsonValue | undefined,
  authority: AgentCapabilityAuthority,
): ReceiptOutcome | undefined {
  if (!hasDataOutput(output, result.affectedResults)) return undefined;
  if (outputScopeMatches(output, result.affectedResults, authority)) return undefined;
  return failureReceipt(
    request,
    transport,
    'denied',
    'agent.capability.scope',
    'The capability output is outside the current authorization scope.',
  );
}

function egressFailure(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: AgentCapabilityHandlerResult<unknown>,
  output: AgentJsonValue | undefined,
  authority: AgentCapabilityAuthority,
): ReceiptOutcome | undefined {
  if (!hasDataOutput(output, result.affectedResults)) return undefined;
  if (!EXTERNAL_TRANSPORTS.has(transport) || authority.grants.includes('model.egress')) return undefined;
  return failureReceipt(
    request,
    transport,
    'denied',
    'agent.capability.egress',
    'The host did not grant model egress for this result.',
  );
}

function redactedExternalReceipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: AgentCapabilityHandlerResult<unknown>,
  authority: AgentCapabilityAuthority,
): ReceiptOutcome | undefined {
  if (!EXTERNAL_TRANSPORTS.has(transport) || authority.grants.includes('model.egress')) return undefined;
  return {
    ok: true,
    value: receipt(request, transport, result.state, {
      diagnostics:
        result.diagnostics?.length || result.reason !== undefined
          ? [
              {
                code: `agent.capability.${result.state}`,
                message: `The capability returned ${result.state}; details require model egress.`,
                retryable: false,
              },
            ]
          : [],
    }),
  };
}

function finalReceipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  result: AgentCapabilityHandlerResult<unknown>,
  output: AgentJsonValue | undefined,
): ReceiptOutcome {
  const metadata = request.metadata === undefined ? undefined : parseWireValue(request.metadata);
  return {
    ok: true,
    value: receipt(request, transport, result.state, {
      ...(output === undefined ? {} : { value: output }),
      diagnostics: cleanDiagnostics(result.diagnostics),
      ...(result.affectedResults === undefined ? {} : { affectedResults: result.affectedResults }),
      ...(result.regionRevision === undefined ? {} : { regionRevision: result.regionRevision }),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(metadata === undefined || !metadata.ok ? {} : { metadata: metadata.value as AgentJsonValue }),
    }),
  };
}

export function projectResult(
  prepared: PreparedDispatch,
  result: AgentCapabilityHandlerResult<unknown>,
  authority: AgentCapabilityAuthority,
  maxOutputBytes: number,
): ReceiptOutcome {
  const parsedOutput = parseOutput(prepared.request, prepared.transport, result.value);
  if (parsedOutput.kind === 'finished') return parsedOutput.result;
  const sizeFailure = outputBudgetFailure(
    prepared.request,
    prepared.transport,
    prepared.manifest,
    parsedOutput.value,
    maxOutputBytes,
  );
  if (sizeFailure !== undefined) return sizeFailure;
  const scopeFailure = outputScopeFailure(prepared.request, prepared.transport, result, parsedOutput.value, authority);
  if (scopeFailure !== undefined) return scopeFailure;
  const accessFailure = egressFailure(prepared.request, prepared.transport, result, parsedOutput.value, authority);
  if (accessFailure !== undefined) return accessFailure;
  const redacted = redactedExternalReceipt(prepared.request, prepared.transport, result, authority);
  if (redacted !== undefined) return redacted;
  return finalReceipt(prepared.request, prepared.transport, result, parsedOutput.value);
}
