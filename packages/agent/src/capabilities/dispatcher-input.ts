import {
  parseContract,
  parseWireValue,
  validateCommitReadSet,
  WIRE_LIMITS,
  type Outcome,
  type VersionRef,
} from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type { AgentCapabilityAuthority, AgentCapabilityRequest, AgentJsonValue } from './types.js';
import { isRecord } from '../guards.js';
import { containsAuthorityClaim, failure, normalizeTransport, utf8Bytes, validId } from './dispatcher-common.js';

const MAX_METADATA_BYTES = 64 * 1024;
const REQUEST_FIELDS = new Set([
  'version',
  'requestId',
  'targetRegionId',
  'goalEpoch',
  'capability',
  'operation',
  'input',
  'metadata',
  'transport',
]);

function snapshot(value: AgentJsonValue): AgentJsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
}

function normalizeRef(input: unknown): Outcome<VersionRef> {
  if (!isRecord(input) || !validId(input.id) || !validId(input.revision))
    return failure('agent.capability.invalid', 'The capability reference is malformed.', ['capability']);
  return { ok: true, value: Object.freeze({ id: input.id, revision: input.revision }) };
}

function hasUnsupportedFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => !REQUEST_FIELDS.has(key));
}

function validRequestIdentity(value: Record<string, unknown>): boolean {
  return value.version === '1' && validId(value.requestId) && validId(value.targetRegionId) && validId(value.goalEpoch);
}

function normalizeOperation(value: unknown): Outcome<OperationGrant> {
  const operation = parseContract('operation-grant', JSON.stringify(value));
  if (operation.ok) return operation;
  return failure('agent.capability.invalid', 'A capability request names an unknown operation.', ['operation']);
}

function normalizeInput(value: Record<string, unknown>): Outcome<AgentJsonValue> {
  if (!Object.hasOwn(value, 'input'))
    return failure('agent.capability.invalid', 'A capability request must include input.', ['input']);
  const payload = parseWireValue(value.input);
  if (!payload.ok) return failure('agent.capability.invalid', 'Capability input is not bounded wire data.', ['input']);
  if (containsAuthorityClaim(payload.value))
    return failure('agent.capability.denied', 'Capability input cannot declare actor or approval authority.', [
      'input',
    ]);
  return { ok: true, value: snapshot(payload.value as AgentJsonValue) };
}

function normalizeMetadata(value: Record<string, unknown>): Outcome<AgentJsonValue | undefined> {
  if (!Object.hasOwn(value, 'metadata')) return { ok: true, value: undefined };
  const checked = parseWireValue(value.metadata);
  if (!checked.ok)
    return failure('agent.capability.invalid', 'Capability metadata is not bounded wire data.', ['metadata']);
  if (containsAuthorityClaim(checked.value))
    return failure('agent.capability.invalid', 'Capability metadata cannot contain authority claims.', ['metadata']);
  const metadataBytes = utf8Bytes(checked.value);
  if (metadataBytes !== undefined && metadataBytes > MAX_METADATA_BYTES)
    return failure('agent.capability.bytes', 'Capability metadata exceeds its byte budget.', ['metadata']);
  return { ok: true, value: snapshot(checked.value as AgentJsonValue) };
}

function requestTransport(value: Record<string, unknown>): Outcome<AgentCapabilityRequest['transport']> {
  const transport = normalizeTransport(value.transport);
  if (value.transport !== undefined && value.transport !== transport)
    return failure('agent.capability.invalid', 'The requested transport is not supported.');
  return { ok: true, value: value.transport === undefined ? undefined : transport };
}

function buildRequest(
  value: Record<string, unknown>,
  capability: VersionRef,
  operation: OperationGrant,
  input: AgentJsonValue,
  metadata: AgentJsonValue | undefined,
  transport: AgentCapabilityRequest['transport'],
): AgentCapabilityRequest {
  return Object.freeze({
    version: '1',
    requestId: value.requestId as string,
    targetRegionId: value.targetRegionId as string,
    goalEpoch: value.goalEpoch as string,
    capability,
    operation,
    input,
    ...(metadata === undefined ? {} : { metadata }),
    ...(transport === undefined ? {} : { transport }),
  });
}

export function normalizeAgentCapabilityRequest(input: unknown): Outcome<AgentCapabilityRequest> {
  const wire = parseWireValue(input);
  if (!wire.ok) return wire;
  if (!isRecord(wire.value)) return failure('agent.capability.invalid', 'A capability request must be an object.');
  const value = wire.value;
  if (hasUnsupportedFields(value))
    return failure(
      'agent.capability.invalid',
      'A capability request contains an unsupported or authority-shaped field.',
    );
  if (!validRequestIdentity(value))
    return failure('agent.capability.invalid', 'A capability request has invalid identity or version fields.');
  const capability = normalizeRef(value.capability);
  if (!capability.ok) return capability;
  const operation = normalizeOperation(value.operation);
  if (!operation.ok) return operation;
  const payload = normalizeInput(value);
  if (!payload.ok) return payload;
  const metadata = normalizeMetadata(value);
  if (!metadata.ok) return metadata;
  const transport = requestTransport(value);
  if (!transport.ok) return transport;
  return {
    ok: true,
    value: buildRequest(value, capability.value, operation.value, payload.value, metadata.value, transport.value),
  };
}

type HostContextInput = Pick<AgentCapabilityRequest, 'targetRegionId' | 'goalEpoch'>;
type HostContextRecord = Record<string, unknown>;

function hostContextRecord(input: unknown): Outcome<HostContextRecord> {
  const wire = parseWireValue(input);
  if (!wire.ok) return failure('agent.capability.denied', 'The host authority context is not bounded data.');
  if (!isRecord(wire.value)) return failure('agent.capability.denied', 'The host authority context is unavailable.');
  return { ok: true, value: wire.value };
}

function validateHostIdentity(value: HostContextRecord, request: HostContextInput): Outcome<void> {
  if (!validId(value.principalKey) || !validId(value.regionId) || !validId(value.goalEpoch))
    return failure('agent.capability.denied', 'The host authority context is malformed.');
  if (value.regionId !== request.targetRegionId || value.goalEpoch !== request.goalEpoch)
    return failure('agent.capability.stale', 'The host goal or region changed before dispatch.');
  return { ok: true, value: undefined };
}

function normalizeGrants(value: unknown): Outcome<readonly OperationGrant[]> {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array)
    return failure('agent.capability.denied', 'The host grant list is malformed.');
  const grants: OperationGrant[] = [];
  for (const raw of value) {
    const parsed = parseContract('operation-grant', JSON.stringify(raw));
    if (!parsed.ok) return failure('agent.capability.denied', 'The host grant list is malformed.');
    if (!grants.includes(parsed.value)) grants.push(parsed.value);
  }
  return { ok: true, value: Object.freeze(grants) };
}

function normalizeCurrent(value: unknown): Outcome<AgentCapabilityAuthority['current'] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const checked = validateCommitReadSet(value, value);
  if (!checked.ok) return failure('agent.capability.denied', 'The host preconditions are malformed.');
  return { ok: true, value: checked.value };
}

function normalizeHostValues(value: HostContextRecord): Outcome<{
  readonly grants: readonly OperationGrant[];
  readonly current: AgentCapabilityAuthority['current'] | undefined;
  readonly context: AgentJsonValue | undefined;
}> {
  const grants = normalizeGrants(value.grants);
  if (!grants.ok) return grants;
  const current = normalizeCurrent(value.current);
  if (!current.ok) return current;
  if (value.context === undefined)
    return { ok: true, value: { grants: grants.value, current: current.value, context: undefined } };
  const context = parseWireValue(value.context);
  if (!context.ok) return failure('agent.capability.denied', 'The host context is malformed.');
  return {
    ok: true,
    value: { grants: grants.value, current: current.value, context: context.value as AgentJsonValue },
  };
}

export function normalizeAgentCapabilityAuthority(
  input: unknown,
  request: HostContextInput,
): Outcome<AgentCapabilityAuthority> {
  const record = hostContextRecord(input);
  if (!record.ok) return record;
  const identity = validateHostIdentity(record.value, request);
  if (!identity.ok) return identity;
  const values = normalizeHostValues(record.value);
  if (!values.ok) return values;
  return {
    ok: true,
    value: Object.freeze({
      principalKey: record.value.principalKey as string,
      regionId: record.value.regionId as string,
      goalEpoch: record.value.goalEpoch as string,
      grants: values.value.grants,
      ...(values.value.current === undefined ? {} : { current: values.value.current }),
      ...(values.value.context === undefined ? {} : { context: values.value.context }),
    }),
  };
}
