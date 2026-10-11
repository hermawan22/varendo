import {
  parseWireValue,
  validateCommitReadSet,
  WIRE_LIMITS,
  type Diagnostic,
  type Outcome,
  type ResultRef,
} from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type {
  AgentCapabilityAuthority,
  AgentCapabilityHandlerResult,
  AgentCapabilityReceipt,
  AgentCapabilityRequest,
  AgentCapabilityState,
  AgentCapabilityTransport,
  AgentJsonValue,
} from './types.js';
import { isRecord } from '../guards.js';
import { diagnostic, failure, validId, validText } from './dispatcher-common.js';

const FAILED_STATES = new Set<AgentCapabilityState>([
  'failed',
  'denied',
  'stale',
  'unsupported',
  'invalid',
  'cancelled',
  'needs-choice',
  'needs-meaning',
]);
const ANY_OPERATION_STATES = new Set<AgentCapabilityState>([
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
const PROPOSAL_STATES = new Set<AgentCapabilityState>(['accepted', 'bound']);
const READ_STATES = new Set<AgentCapabilityState>(['accepted', 'data-ready']);
const COMMIT_STATES = new Set<AgentCapabilityState>(['accepted', 'plan-committed', 'renderer-ready']);
const EVALUATION_STATES = new Set<AgentCapabilityState>(['accepted', 'data-ready', 'plan-committed', 'renderer-ready']);
const STABLE_PINS = [
  'scopeDigest',
  'policyRevision',
  'catalogRevision',
  'experienceRevision',
  'functionRegistryDigest',
] as const;

function validDiagnosticPath(path: unknown): boolean {
  if (path === undefined) return true;
  if (!Array.isArray(path) || path.length > WIRE_LIMITS.depth) return false;
  return path.every(validDiagnosticPart);
}

function validDiagnosticPart(part: unknown): boolean {
  if (typeof part === 'string') return validId(part);
  return Number.isSafeInteger(part) && (part as number) >= 0;
}

function validRemedies(remedies: unknown): boolean {
  if (remedies === undefined) return true;
  if (!Array.isArray(remedies) || remedies.length > WIRE_LIMITS.array) return false;
  return remedies.every((remedy) => validText(remedy, WIRE_LIMITS.label));
}

function validDiagnostic(item: Diagnostic): boolean {
  return (
    isRecord(item) &&
    validId(item.code) &&
    validText(item.message, WIRE_LIMITS.label) &&
    typeof item.retryable === 'boolean' &&
    validDiagnosticPath(item.path) &&
    validRemedies(item.remedies)
  );
}

function cleanDiagnostic(item: Diagnostic): Diagnostic | undefined {
  if (!validDiagnostic(item)) return undefined;
  return Object.freeze({
    code: item.code,
    message: item.message,
    retryable: item.retryable,
    ...(item.path === undefined ? {} : { path: Object.freeze([...item.path]) }),
    ...(item.remedies === undefined ? {} : { remedies: Object.freeze([...item.remedies]) }),
  });
}

export function cleanDiagnostics(input: readonly Diagnostic[] | undefined): readonly Diagnostic[] {
  if (input === undefined) return [];
  const output: Diagnostic[] = [];
  for (const item of input) {
    if (output.length >= WIRE_LIMITS.diagnostics) break;
    const cleaned = cleanDiagnostic(item);
    if (cleaned !== undefined) output.push(cleaned);
  }
  return Object.freeze(output);
}

function validResultRef(ref: ResultRef): boolean {
  if (!isRecord(ref)) return false;
  return (
    validId(ref.id) &&
    validId(ref.revision) &&
    (ref.sourceLineage === undefined || validId(ref.sourceLineage)) &&
    validId(ref.outputId) &&
    validId(ref.queryDigest) &&
    validId(ref.scopeDigest)
  );
}

function freezeResultRef(ref: ResultRef): ResultRef {
  return Object.freeze({
    id: ref.id,
    revision: ref.revision,
    ...(ref.sourceLineage === undefined ? {} : { sourceLineage: ref.sourceLineage }),
    outputId: ref.outputId,
    queryDigest: ref.queryDigest,
    scopeDigest: ref.scopeDigest,
  });
}

function cleanRefs(input: readonly ResultRef[] | undefined): Outcome<readonly ResultRef[] | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(input) || input.length > WIRE_LIMITS.outputs)
    return failure('agent.capability.output', 'A capability returned too many result references.');
  const refs: ResultRef[] = [];
  for (const ref of input) {
    if (!validResultRef(ref))
      return failure('agent.capability.output', 'A capability returned a malformed result reference.');
    refs.push(freezeResultRef(ref));
  }
  return { ok: true, value: Object.freeze(refs) };
}

function hasValidReferenceShape(object: { readonly [key: string]: AgentJsonValue }): boolean {
  return ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest'].every((key) => typeof object[key] === 'string');
}

function matchesReferenceScope(
  object: { readonly [key: string]: AgentJsonValue },
  authority: AgentCapabilityAuthority,
): boolean {
  if (!hasValidReferenceShape(object)) return true;
  if (authority.current === undefined) return false;
  const ref = {
    id: object.id,
    revision: object.revision,
    ...(object.sourceLineage === undefined ? {} : { sourceLineage: object.sourceLineage }),
    outputId: object.outputId,
    queryDigest: object.queryDigest,
    scopeDigest: object.scopeDigest,
  } as ResultRef;
  return validateCommitReadSet(authority.current, authority.current, [ref]).ok;
}

function matchesExplicitScope(
  object: { readonly [key: string]: AgentJsonValue },
  expected: string | undefined,
): boolean {
  if (!Object.hasOwn(object, 'scopeDigest')) return true;
  return expected !== undefined && object.scopeDigest === expected;
}

function scopedValueMatches(
  value: AgentJsonValue,
  authority: AgentCapabilityAuthority,
  expected: string | undefined,
): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every((item) => scopedValueMatches(item, authority, expected));
  const object = value as { readonly [key: string]: AgentJsonValue };
  return (
    matchesReferenceScope(object, authority) &&
    matchesExplicitScope(object, expected) &&
    Object.values(object).every((item) => scopedValueMatches(item, authority, expected))
  );
}

/** Reject explicit scope markers and result handles that disagree with the host read set. */
export function outputScopeMatches(
  value: AgentJsonValue | undefined,
  refs: readonly ResultRef[] | undefined,
  authority: AgentCapabilityAuthority,
): boolean {
  if (refs !== undefined && refs.length > 0) {
    if (authority.current === undefined) return false;
    if (!validateCommitReadSet(authority.current, authority.current, refs).ok) return false;
  }
  const expected = authority.current?.scopeDigest;
  return value === undefined || scopedValueMatches(value, authority, expected);
}

export function hasDataOutput(value: AgentJsonValue | undefined, refs: readonly ResultRef[] | undefined): boolean {
  return value !== undefined || (refs !== undefined && refs.length > 0);
}

const OPERATION_STATES: Readonly<Partial<Record<OperationGrant, ReadonlySet<AgentCapabilityState>>>> = {
  'experience.commit': COMMIT_STATES,
  'task.evaluate': EVALUATION_STATES,
};

export function allowedState(operation: OperationGrant, state: AgentCapabilityState): boolean {
  if (ANY_OPERATION_STATES.has(state)) return true;
  if (operation.endsWith('.propose')) return PROPOSAL_STATES.has(state);
  return (OPERATION_STATES[operation] ?? READ_STATES).has(state);
}

function identityChanged(before: AgentCapabilityAuthority, after: AgentCapabilityAuthority): boolean {
  return (
    before.principalKey !== after.principalKey ||
    before.regionId !== after.regionId ||
    before.goalEpoch !== after.goalEpoch
  );
}

function isCommittedOperation(operation: OperationGrant, state: AgentCapabilityState): boolean {
  const committingOperation = operation === 'experience.commit' || operation === 'task.evaluate';
  const committedState = state === 'plan-committed' || state === 'renderer-ready';
  return committingOperation && committedState;
}

function stablePinsMatch(
  before: NonNullable<AgentCapabilityAuthority['current']>,
  after: NonNullable<AgentCapabilityAuthority['current']>,
): boolean {
  return STABLE_PINS.every((pin) => before[pin] === after[pin]);
}

function readSetChanged(
  before: AgentCapabilityAuthority['current'],
  after: AgentCapabilityAuthority['current'],
  committed: boolean,
): boolean {
  if (before === undefined || after === undefined) {
    if (committed && before === undefined && after !== undefined) return false;
    return before !== after;
  }
  if (!stablePinsMatch(before, after)) return true;
  if (committed) return false;
  return !validateCommitReadSet(before, after).ok;
}

export function changedAuthority(
  before: AgentCapabilityAuthority,
  after: AgentCapabilityAuthority,
  operation: OperationGrant,
  result: AgentCapabilityState,
): 'none' | 'denied' | 'changed' {
  if (identityChanged(before, after)) return 'changed';
  if (!after.grants.includes(operation)) return 'denied';
  if (readSetChanged(before.current, after.current, isCommittedOperation(operation, result))) return 'changed';
  return 'none';
}

export function receipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  state: AgentCapabilityState,
  details: Partial<
    Omit<
      AgentCapabilityReceipt,
      | 'version'
      | 'requestId'
      | 'targetRegionId'
      | 'goalEpoch'
      | 'capability'
      | 'operation'
      | 'transport'
      | 'state'
      | 'status'
      | 'stage'
    >
  > = {},
): AgentCapabilityReceipt {
  return Object.freeze({
    version: '1' as const,
    requestId: request.requestId,
    targetRegionId: request.targetRegionId,
    goalEpoch: request.goalEpoch,
    capability: Object.freeze({ ...request.capability }),
    operation: request.operation,
    transport,
    state,
    status: state,
    stage: state,
    diagnostics: Object.freeze(details.diagnostics === undefined ? [] : [...details.diagnostics]),
    ...details,
  });
}

export function failureReceipt(
  request: AgentCapabilityRequest,
  transport: AgentCapabilityTransport,
  state: AgentCapabilityState,
  code: string,
  message: string,
): Outcome<AgentCapabilityReceipt> {
  return { ok: true, value: receipt(request, transport, state, { diagnostics: [diagnostic(code, message)] }) };
}

function isHandlerOutcome<T>(raw: unknown): raw is Outcome<AgentCapabilityHandlerResult<T>> {
  return isRecord(raw) && Object.hasOwn(raw, 'ok') && typeof raw.ok === 'boolean';
}

function handlerCandidate<T>(
  raw: AgentCapabilityHandlerResult<T> | Outcome<AgentCapabilityHandlerResult<T>>,
): Outcome<AgentCapabilityHandlerResult<T>> {
  if (!isRecord(raw)) return failure('agent.capability.handler', 'The capability handler returned no result.');
  if (!isHandlerOutcome<T>(raw)) return { ok: true, value: raw as AgentCapabilityHandlerResult<T> };
  if (!raw.ok)
    return failure(
      'agent.capability.handler',
      raw.diagnostics[0]?.message ?? 'The capability handler reported failure.',
    );
  if (raw.value === undefined)
    return failure('agent.capability.handler', 'The capability handler returned an invalid stage.');
  return { ok: true, value: raw.value };
}

function validHandlerState(state: unknown): state is AgentCapabilityState {
  return (
    validText(state, 32) &&
    [
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
    ].includes(state as AgentCapabilityState)
  );
}

function normalizedHandlerDiagnostics(
  state: AgentCapabilityState,
  input: readonly Diagnostic[] | undefined,
): Outcome<readonly Diagnostic[] | undefined> {
  const cleaned = cleanDiagnostics(input);
  if (input !== undefined && input.length > 0 && cleaned.length === 0)
    return failure('agent.capability.output', 'The capability handler returned malformed diagnostics.');
  if (!FAILED_STATES.has(state) || cleaned.length > 0)
    return { ok: true, value: cleaned.length === 0 ? undefined : cleaned };
  return {
    ok: true,
    value: [diagnostic(`agent.capability.${state}`, `The capability returned ${state} without a diagnostic.`)],
  };
}

function normalizedHandlerValue<T>(value: T | undefined): Outcome<T | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const checked = parseWireValue(value);
  if (!checked.ok) return failure('agent.capability.output', 'The capability handler returned non-wire output.');
  return { ok: true, value: checked.value as T };
}

function validHandlerDetails<T>(candidate: AgentCapabilityHandlerResult<T>): Outcome<{
  readonly value: T | undefined;
  readonly diagnostics: readonly Diagnostic[] | undefined;
  readonly refs: readonly ResultRef[] | undefined;
}> {
  const value = normalizedHandlerValue(candidate.value);
  if (!value.ok) return value;
  const diagnostics = normalizedHandlerDiagnostics(candidate.state, candidate.diagnostics);
  if (!diagnostics.ok) return diagnostics;
  const refs = cleanRefs(candidate.affectedResults);
  if (!refs.ok) return refs;
  return { ok: true, value: { value: value.value, diagnostics: diagnostics.value, refs: refs.value } };
}

function validateHandlerCandidate<T>(
  candidate: AgentCapabilityHandlerResult<T>,
): Outcome<AgentCapabilityHandlerResult<T>> {
  if (candidate === null || typeof candidate !== 'object' || !validHandlerState(candidate.state))
    return failure('agent.capability.handler', 'The capability handler returned an invalid or unknown stage.');
  const revision = candidate.regionRevision;
  if (revision !== undefined && !validId(revision))
    return failure('agent.capability.output', 'The capability handler returned a malformed region revision.');
  const reason = candidate.reason;
  if (reason !== undefined && !validText(reason, WIRE_LIMITS.label))
    return failure('agent.capability.output', 'The capability handler returned an unbounded reason.');
  return { ok: true, value: candidate };
}

function buildHandlerResult<T>(candidate: AgentCapabilityHandlerResult<T>): Outcome<AgentCapabilityHandlerResult<T>> {
  const details = validHandlerDetails(candidate);
  if (!details.ok) return details;
  return {
    ok: true,
    value: Object.freeze({
      state: candidate.state,
      ...(details.value.value === undefined ? {} : { value: details.value.value }),
      ...(details.value.diagnostics === undefined ? {} : { diagnostics: details.value.diagnostics }),
      ...(details.value.refs === undefined ? {} : { affectedResults: details.value.refs }),
      ...(candidate.regionRevision === undefined ? {} : { regionRevision: candidate.regionRevision }),
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
    }),
  };
}

export function normalizeHandlerResult<T>(
  raw: AgentCapabilityHandlerResult<T> | Outcome<AgentCapabilityHandlerResult<T>>,
): Outcome<AgentCapabilityHandlerResult<T>> {
  const candidate = handlerCandidate(raw);
  if (!candidate.ok) return candidate;
  const valid = validateHandlerCandidate(candidate.value);
  if (!valid.ok) return valid;
  return buildHandlerResult(valid.value);
}
