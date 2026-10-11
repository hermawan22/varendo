import { parseContract, WIRE_LIMITS, type Diagnostic, type Outcome, type ResultRef } from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type { AgentCapabilityReceipt, AgentJsonValue } from '../capabilities/types.js';
import type { AgentToolCallOptions, AgentToolDefinition } from '../protocol/types.js';
import type { CallToolResult } from './types.js';
import { ADAPTER_VERSION, boundedWire, failure, isRecord, textFromResult, validId, validText } from './shared.js';

const receiptStates = new Set([
  'accepted',
  'bound',
  'data-ready',
  'plan-committed',
  'renderer-ready',
  'partial',
  'cancelled',
  'failed',
  'denied',
  'stale',
  'unsupported',
  'invalid',
  'needs-choice',
  'needs-meaning',
]);

interface ReceiptIdentity {
  readonly source: Record<string, unknown>;
  readonly operation: OperationGrant;
}

function normalizeResultRef(value: unknown): Outcome<ResultRef> {
  const checked = boundedWire(value);
  if (!checked.ok || !isRecord(checked.value) || !validId(checked.value.id))
    return failure('agent.mcp.receipt', 'The MCP server returned a malformed result reference.');
  if (
    !validId(checked.value.revision) ||
    (checked.value.sourceLineage !== undefined && !validId(checked.value.sourceLineage)) ||
    !validId(checked.value.outputId) ||
    !validId(checked.value.queryDigest) ||
    !validId(checked.value.scopeDigest)
  )
    return failure('agent.mcp.receipt', 'The MCP server returned a malformed result reference.');
  return {
    ok: true,
    value: Object.freeze({
      id: checked.value.id,
      revision: checked.value.revision,
      ...(checked.value.sourceLineage === undefined ? {} : { sourceLineage: checked.value.sourceLineage }),
      outputId: checked.value.outputId,
      queryDigest: checked.value.queryDigest,
      scopeDigest: checked.value.scopeDigest,
    }),
  };
}

function validDiagnosticPath(value: unknown): value is readonly (string | number)[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.depth) return false;
  return value.every((part) => {
    if (typeof part === 'string') return part.length <= WIRE_LIMITS.text && !/[\u0000-\u001f\u007f]/u.test(part);
    return Number.isSafeInteger(part) && part >= 0;
  });
}

function validRemedies(value: unknown): value is readonly string[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.diagnostics) return false;
  return value.every((remedy) => validText(remedy, WIRE_LIMITS.label));
}

function diagnosticRecord(value: unknown): Outcome<Record<string, unknown>> {
  const checked = boundedWire(value);
  if (
    !checked.ok ||
    !isRecord(checked.value) ||
    !validId(checked.value.code) ||
    !validText(checked.value.message, WIRE_LIMITS.label) ||
    typeof checked.value.retryable !== 'boolean'
  )
    return failure('agent.mcp.receipt', 'The MCP server returned malformed diagnostics.');
  if (!validDiagnosticPath(checked.value.path))
    return failure('agent.mcp.receipt', 'The MCP server returned malformed diagnostic paths.');
  if (!validRemedies(checked.value.remedies))
    return failure('agent.mcp.receipt', 'The MCP server returned malformed diagnostic remedies.');
  return { ok: true, value: checked.value };
}

function normalizeDiagnostic(value: unknown): Outcome<Diagnostic> {
  const checked = diagnosticRecord(value);
  if (!checked.ok) return checked;
  const item = checked.value;
  return {
    ok: true,
    value: Object.freeze({
      code: item.code as string,
      message: item.message as string,
      retryable: item.retryable as boolean,
      ...(item.path === undefined ? {} : { path: Object.freeze([...(item.path as (string | number)[])]) }),
      ...(item.remedies === undefined ? {} : { remedies: Object.freeze([...(item.remedies as string[])]) }),
    }),
  };
}

function normalizeDiagnostics(value: unknown): Outcome<readonly Diagnostic[]> {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.diagnostics)
    return failure('agent.mcp.receipt', 'The MCP server returned malformed diagnostics.');
  const diagnostics: Diagnostic[] = [];
  for (const item of value) {
    const normalized = normalizeDiagnostic(item);
    if (!normalized.ok) return normalized;
    diagnostics.push(normalized.value);
  }
  return { ok: true, value: Object.freeze(diagnostics) };
}

function validReceiptCorrelation(
  receipt: Record<string, unknown>,
  expected: AgentToolCallOptions,
  targetRegionId: string,
  goalEpoch: string,
): boolean {
  return (
    receipt.version === '1' &&
    receipt.requestId === expected.requestId &&
    receipt.targetRegionId === targetRegionId &&
    receipt.goalEpoch === goalEpoch &&
    receipt.transport === 'mcp'
  );
}

function validReceiptCapability(receipt: Record<string, unknown>): boolean {
  return isRecord(receipt.capability) && validId(receipt.capability.id) && validId(receipt.capability.revision);
}

function validReceiptState(receipt: Record<string, unknown>): boolean {
  return (
    validText(receipt.state, 32) &&
    receiptStates.has(receipt.state) &&
    receipt.status === receipt.state &&
    receipt.stage === receipt.state &&
    Array.isArray(receipt.diagnostics)
  );
}

function validReceiptIdentity(
  receipt: Record<string, unknown>,
  expected: AgentToolCallOptions,
  targetRegionId: string,
  goalEpoch: string,
): boolean {
  return (
    validReceiptCorrelation(receipt, expected, targetRegionId, goalEpoch) &&
    validReceiptCapability(receipt) &&
    validReceiptState(receipt)
  );
}

function receiptRevisionError(receipt: Record<string, unknown>): string | undefined {
  const isCommitted = receipt.state === 'plan-committed' || receipt.state === 'renderer-ready';
  if (isCommitted && receipt.regionRevision === undefined)
    return 'The MCP server returned a committed receipt without a valid region revision.';
  if (receipt.regionRevision !== undefined && !validId(receipt.regionRevision))
    return 'The MCP server returned a malformed region revision.';
  return undefined;
}

function validateReceiptIdentity(
  value: unknown,
  expected: AgentToolCallOptions,
  expectedTool: AgentToolDefinition,
  targetRegionId: string,
  goalEpoch: string,
): Outcome<ReceiptIdentity> {
  const checked = boundedWire(value);
  if (!checked.ok || !isRecord(checked.value))
    return failure('agent.mcp.receipt', 'The MCP server returned a malformed receipt.');
  const receipt = checked.value;
  if (!validReceiptIdentity(receipt, expected, targetRegionId, goalEpoch))
    return failure('agent.mcp.receipt', 'The MCP server returned an uncorrelated or malformed receipt.');
  const operation = parseContract('operation-grant', JSON.stringify(receipt.operation));
  if (!operation.ok) return failure('agent.mcp.receipt', 'The MCP server returned an unknown receipt operation.');
  if (!isRecord(receipt.capability))
    return failure('agent.mcp.receipt', 'The MCP server returned a receipt for a different capability.');
  if (
    receipt.capability.id !== expectedTool.capability.id ||
    receipt.capability.revision !== expectedTool.capability.revision ||
    operation.value !== expectedTool.operation
  )
    return failure('agent.mcp.receipt', 'The MCP server returned a receipt for a different capability.');
  const revisionError = receiptRevisionError(receipt);
  if (revisionError !== undefined) return failure('agent.mcp.receipt', revisionError);
  if (receipt.reason !== undefined && !validText(receipt.reason, WIRE_LIMITS.label))
    return failure('agent.mcp.receipt', 'The MCP server returned a malformed receipt reason.');
  return { ok: true, value: { source: receipt, operation: operation.value } };
}

function normalizeAffectedResults(value: unknown): Outcome<readonly ResultRef[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.outputs)
    return failure('agent.mcp.receipt', 'The MCP server returned malformed result references.');
  const refs: ResultRef[] = [];
  for (const ref of value) {
    const normalized = normalizeResultRef(ref);
    if (!normalized.ok) return normalized;
    refs.push(normalized.value);
  }
  return { ok: true, value: Object.freeze(refs) };
}

function optionalWire(value: unknown, label: 'output' | 'metadata'): Outcome<AgentJsonValue | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const checked = boundedWire(value);
  if (!checked.ok) return failure('agent.mcp.receipt', `The MCP server returned non-wire receipt ${label}.`);
  return { ok: true, value: checked.value as AgentJsonValue };
}

function assembleReceipt(
  identity: ReceiptIdentity,
  diagnostics: readonly Diagnostic[],
  affectedResults: readonly ResultRef[] | undefined,
  output: AgentJsonValue | undefined,
  metadata: AgentJsonValue | undefined,
  expected: AgentToolCallOptions,
  targetRegionId: string,
  goalEpoch: string,
): AgentCapabilityReceipt {
  const source = identity.source;
  const capability = source.capability as { readonly id: string; readonly revision: string };
  return Object.freeze({
    version: '1',
    requestId: expected.requestId,
    targetRegionId,
    goalEpoch,
    capability: Object.freeze({ id: capability.id, revision: capability.revision }),
    operation: identity.operation,
    transport: 'mcp',
    state: source.state as AgentCapabilityReceipt['state'],
    status: source.state as AgentCapabilityReceipt['status'],
    stage: source.state as AgentCapabilityReceipt['stage'],
    diagnostics,
    ...(output === undefined ? {} : { value: output }),
    ...(affectedResults === undefined ? {} : { affectedResults }),
    ...(source.regionRevision === undefined ? {} : { regionRevision: source.regionRevision as string }),
    ...(source.reason === undefined ? {} : { reason: source.reason as string }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function normalizeReceipt(
  value: unknown,
  expected: AgentToolCallOptions,
  expectedTool: AgentToolDefinition,
  targetRegionId: string,
  goalEpoch: string,
): Outcome<AgentCapabilityReceipt> {
  const identity = validateReceiptIdentity(value, expected, expectedTool, targetRegionId, goalEpoch);
  if (!identity.ok) return identity;
  const diagnostics = normalizeDiagnostics(identity.value.source.diagnostics);
  if (!diagnostics.ok) return diagnostics;
  const refs = normalizeAffectedResults(identity.value.source.affectedResults);
  if (!refs.ok) return refs;
  const output = optionalWire(identity.value.source.value, 'output');
  if (!output.ok) return output;
  const metadata = optionalWire(identity.value.source.metadata, 'metadata');
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: assembleReceipt(
      identity.value,
      diagnostics.value,
      refs.value,
      output.value,
      metadata.value,
      expected,
      targetRegionId,
      goalEpoch,
    ),
  };
}

function normalizeFailureOutcome(value: Record<string, unknown>): Outcome<AgentCapabilityReceipt> {
  const diagnostics = normalizeDiagnostics(value.diagnostics);
  if (!diagnostics.ok || diagnostics.value.length === 0)
    return failure('agent.mcp.result', 'The MCP server returned malformed failure diagnostics.');
  return { ok: false, diagnostics: diagnostics.value as [Diagnostic, ...Diagnostic[]] };
}

function normalizeEnvelope(value: unknown): Outcome<Record<string, unknown>> {
  if (!isRecord(value) || value.version !== ADAPTER_VERSION || !('outcome' in value))
    return failure('agent.mcp.result', 'The MCP server returned an unrecognized result envelope.');
  if (!isRecord(value.outcome) || typeof value.outcome.ok !== 'boolean')
    return failure('agent.mcp.result', 'The MCP server returned an invalid result outcome.');
  return { ok: true, value: value.outcome };
}

export function resultToOutcome(
  result: CallToolResult,
  expected: AgentToolCallOptions,
  expectedTool: AgentToolDefinition,
  targetRegionId: string,
  goalEpoch: string,
): Outcome<AgentCapabilityReceipt> {
  const parsed = textFromResult(result);
  if (!parsed.ok) return parsed;
  const outcome = normalizeEnvelope(parsed.value);
  if (!outcome.ok) return outcome;
  if (!outcome.value.ok) return normalizeFailureOutcome(outcome.value);
  return normalizeReceipt(outcome.value.value, expected, expectedTool, targetRegionId, goalEpoch);
}
