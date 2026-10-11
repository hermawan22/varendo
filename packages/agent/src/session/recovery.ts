import type { AgentStopReason } from '@varendo/core/agent';
import type { AgentCapabilityReceipt, AgentCapabilityRequest, AgentCapabilityState } from '../capabilities/types.js';
import type { AgentRecoveryReceipt } from './types.js';
import { isRecord } from '../guards.js';

const successfulStops: Readonly<Partial<Record<AgentCapabilityState, AgentStopReason>>> = {
  bound: 'complete',
  'data-ready': 'complete',
  'plan-committed': 'complete',
  'renderer-ready': 'complete',
  accepted: 'complete',
  'needs-choice': 'needs-choice',
  'needs-meaning': 'needs-meaning',
  denied: 'denied',
  stale: 'stale',
  unsupported: 'unsupported',
  invalid: 'invalid',
  cancelled: 'cancelled',
};

const recoverableStates = new Set<AgentCapabilityState>(['invalid', 'unsupported', 'failed']);
const recoveryStates = new Set(['preserved-incumbent', 'cleared-revoked', 'manual-required']);

export function stopFor(state: AgentCapabilityState | undefined): AgentStopReason {
  return state === undefined ? 'unavailable' : (successfulStops[state] ?? 'unavailable');
}

export function recoverable(state: AgentCapabilityState): boolean {
  return recoverableStates.has(state);
}

export function failedReceipt(
  request: AgentCapabilityRequest,
  diagnostics: AgentCapabilityReceipt['diagnostics'],
): AgentCapabilityReceipt {
  return Object.freeze({
    version: '1' as const,
    requestId: request.requestId,
    targetRegionId: request.targetRegionId,
    goalEpoch: request.goalEpoch,
    capability: Object.freeze({ ...request.capability }),
    operation: request.operation,
    transport: request.transport ?? 'direct',
    state: 'failed' as const,
    status: 'failed' as const,
    stage: 'failed' as const,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function defaultRecovery(): AgentRecoveryReceipt {
  return Object.freeze({
    state: 'manual-required' as const,
    reason: 'No host recovery receipt was provided; retain only host-authorized state and offer manual controls.',
    safeToRetry: false,
  });
}

function validRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest'].every((key) => typeof value[key] === 'string');
}

function validResults(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 128) return false;
  return value.every(validRef);
}

function validRecovery(value: unknown): value is AgentRecoveryReceipt {
  if (!isRecord(value)) return false;
  if (typeof value.state !== 'string' || !recoveryStates.has(value.state)) return false;
  if (typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 4096) return false;
  if (typeof value.safeToRetry !== 'boolean') return false;
  if (value.regionRevision !== undefined && !validRegionRevision(value.regionRevision)) return false;
  return validResults(value.results);
}

function validRegionRevision(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

export function normalizeRecovery(value: AgentRecoveryReceipt): AgentRecoveryReceipt | undefined {
  if (!validRecovery(value)) return undefined;
  return Object.freeze({
    ...value,
    ...(value.results === undefined ? {} : { results: Object.freeze([...value.results]) }),
  });
}
