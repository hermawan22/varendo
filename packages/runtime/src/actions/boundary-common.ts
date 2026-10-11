import { parseWireValue, WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Outcome, VersionRef } from '@varendo/core';
import type {
  ActionDispatchResult,
  ActionEntity,
  ActionFailure,
  ActionGrant,
  ActionHistoryEntry,
  ActionOutcome,
  ActionPayload,
  ActionPreview,
  ActionReceipt,
  ActionRegistration,
  TrustedActionContext,
} from './types.js';

export const DEFAULTS = Object.freeze({
  previews: 128,
  pending: 128,
  history: 256,
  idempotency: 512,
  identityBytes: 512 * 1024,
  ledgerBytes: 4 * 1024 * 1024,
  outputBytes: 256 * 1024,
  inputBytes: 256 * 1024,
  callbackMilliseconds: 30_000,
  inFlight: 16,
});
export const MAX_CALLBACK_MS = 86_400_000;
export const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= WIRE_LIMITS.id &&
  !/[\s\u0000-\u001f\u007f]/u.test(value);
export const validText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= WIRE_LIMITS.text;
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= WIRE_LIMITS.text;
const validRef = (value: unknown): value is VersionRef =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value as object).length === 2 &&
  validId((value as Record<string, unknown>).id) &&
  validId((value as Record<string, unknown>).revision);
export const failure = <T>(
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): ActionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, path, retryable: false }],
});
export const diagnostic = (code: string, message: string): ActionFailure => ({ code, message, retryable: false });

export function frozen<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) frozen(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

export { canonicalJson as canonical } from '../canonical.js';

export function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function cloneRef(value: VersionRef): VersionRef {
  return Object.freeze({ id: value.id, revision: value.revision });
}

export function payload(value: unknown, path: readonly (string | number)[] = ['input']): ActionOutcome<ActionPayload> {
  const inspected = parseWireValue(value);
  if (!inspected.ok) return inspected as ActionOutcome<ActionPayload>;
  if (inspected.value === null || typeof inspected.value !== 'object' || Array.isArray(inspected.value))
    return failure('action.invalid', 'Action input must be a bounded JSON object.', path);
  const record = inspected.value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!validId(key)) return failure('action.invalid', 'Action input contains an invalid field key.', [...path, key]);
  }
  return { ok: true, value: frozen(record as ActionPayload) };
}

function entity(value: unknown): ActionOutcome<ActionEntity | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const inspected = parseWireValue(value);
  if (!inspected.ok) return inspected as ActionOutcome<ActionEntity | undefined>;
  if (inspected.value === null || typeof inspected.value !== 'object' || Array.isArray(inspected.value))
    return failure('action.invalid', 'The entity binding must be an object.');
  const record = inspected.value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !validKey(record.key) || !validId(record.revision))
    return failure('action.invalid', 'The entity binding requires a bounded key and revision.');
  return { ok: true, value: frozen({ key: record.key, revision: record.revision }) };
}

export interface ParsedRequest {
  readonly requestId: string;
  readonly action: VersionRef;
  readonly input: ActionPayload;
  readonly entity?: ActionEntity;
  readonly idempotencyKey?: string;
}

export function request(value: unknown): ActionOutcome<ParsedRequest> {
  const inspected = parseWireValue(value);
  if (!inspected.ok) return inspected as ActionOutcome<ParsedRequest>;
  if (!isRecord(inspected.value)) return failure('action.invalid', 'An action request must be a bounded object.');
  const record = inspected.value;
  if (!validRequestIdentity(record))
    return failure('action.invalid', 'The action request contains an unknown field or invalid identity.');
  const input = payload(record.input);
  if (!input.ok) return input;
  const boundEntity = entity(record.entity);
  if (!boundEntity.ok) return boundEntity;
  if (record.idempotencyKey !== undefined && !validId(record.idempotencyKey))
    return failure('action.invalid', 'The idempotency key is not a bounded identifier.', ['idempotencyKey']);
  return {
    ok: true,
    value: frozen({
      requestId: record.requestId as string,
      action: cloneRef(record.action as VersionRef),
      input: input.value,
      ...(boundEntity.value === undefined ? {} : { entity: boundEntity.value }),
      ...(record.idempotencyKey === undefined ? {} : { idempotencyKey: record.idempotencyKey as string }),
    }),
  };
}

function validRequestIdentity(record: Record<string, unknown>): boolean {
  const allowed = ['requestId', 'action', 'input', 'entity', 'idempotencyKey'];
  return (
    Object.keys(record).every((key) => allowed.includes(key)) && validId(record.requestId) && validRef(record.action)
  );
}

export function grantsInclude(context: TrustedActionContext, grant: ActionGrant): boolean {
  return context.grants.includes(grant);
}

export function context(value: unknown): ActionOutcome<TrustedActionContext> {
  if (!isRecord(value)) return failure('action.denied', 'The host action context is unavailable.');
  const record = value;
  if (!validContextIdentity(record) || !validGrants(record.grants))
    return failure('action.denied', 'The host action context is malformed.');
  const revisions = entityRevisionMap(record.entityRevisions);
  if (!revisions.ok) return revisions;
  return {
    ok: true,
    value: frozen({
      principalKey: record.principalKey as string,
      actorKey: record.actorKey as string,
      scopeDigest: record.scopeDigest as string,
      policyRevision: record.policyRevision as string,
      domainRevision: record.domainRevision as string,
      confirmationEpoch: record.confirmationEpoch as string,
      grants: [...new Set(record.grants as ActionGrant[])],
      ...(revisions.value === undefined ? {} : { entityRevisions: revisions.value }),
    }),
  };
}

function validContextIdentity(record: Record<string, unknown>): boolean {
  const allowed = [
    'principalKey',
    'actorKey',
    'scopeDigest',
    'policyRevision',
    'domainRevision',
    'confirmationEpoch',
    'grants',
    'entityRevisions',
  ];
  return (
    Object.keys(record).every((key) => allowed.includes(key)) &&
    validId(record.principalKey) &&
    validId(record.actorKey) &&
    validId(record.scopeDigest) &&
    validId(record.policyRevision) &&
    validId(record.domainRevision) &&
    validId(record.confirmationEpoch)
  );
}

function validGrants(value: unknown): value is ActionGrant[] {
  return (
    Array.isArray(value) &&
    value.length <= WIRE_LIMITS.array &&
    value.every((grant) => grant === 'action.propose' || grant === 'action.execute')
  );
}

function entityRevisionMap(value: unknown): ActionOutcome<Readonly<Record<string, string>> | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return failure('action.denied', 'The host entity revision map is malformed.');
  const entries = Object.entries(value);
  const valid =
    entries.length <= WIRE_LIMITS.properties && entries.every(([key, revision]) => validKey(key) && validId(revision));
  if (!valid) return failure('action.denied', 'The host entity revision map is malformed.');
  return {
    ok: true,
    value: frozen(Object.fromEntries(entries.map(([key, revision]) => [key, revision as string]))),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sameContext(left: TrustedActionContext, right: TrustedActionContext): boolean {
  if (
    left.principalKey !== right.principalKey ||
    left.actorKey !== right.actorKey ||
    left.scopeDigest !== right.scopeDigest ||
    left.policyRevision !== right.policyRevision ||
    left.domainRevision !== right.domainRevision ||
    left.confirmationEpoch !== right.confirmationEpoch
  )
    return false;
  return true;
}

export function normalizeOutcome<T>(value: unknown): Outcome<T> | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).ok !== 'boolean'
  )
    return undefined;
  const record = value as Record<string, unknown>;
  if (record.ok === true && Object.hasOwn(record, 'value')) return { ok: true, value: record.value as T };
  if (record.ok === false && Array.isArray(record.diagnostics) && record.diagnostics.length > 0)
    return { ok: false, diagnostics: record.diagnostics as never };
  return undefined;
}

export type HostCall<T> =
  | { readonly state: 'completed'; readonly value: T }
  | { readonly state: 'cancelled' | 'timeout' | 'lifecycle' | 'budget' };

export function dispatchFailureReason(state: 'cancelled' | 'timeout' | 'lifecycle'): string {
  switch (state) {
    case 'timeout':
      return 'The action callback exceeded its bounded time budget.';
    case 'cancelled':
      return 'The action callback was cancelled after dispatch.';
    case 'lifecycle':
      return 'The action port was revoked or disposed during dispatch.';
  }
}

export interface ActiveCall {
  abort(state: 'cancelled' | 'lifecycle'): void;
}

export interface PreviewRecord {
  readonly id: string;
  readonly requestId: string;
  readonly registration: ActionRegistration;
  readonly preview: ActionPreview;
  input: ActionPayload | undefined;
  readonly inputIdentity: string;
  readonly context: TrustedActionContext;
  consumed: boolean;
  confirming: boolean;
}

export const previewRecords = new WeakMap<object, PreviewRecord>();

export interface ReceiptRecord {
  readonly id: string;
  readonly previewId: string;
  readonly registration: ActionRegistration;
  readonly receipt: ActionReceipt;
  input: ActionPayload | undefined;
  readonly inputIdentity: string;
  readonly entity?: ActionEntity;
  readonly idempotencyKey?: string;
  readonly context: TrustedActionContext;
  consumed: boolean;
  executing: boolean;
}

export type LedgerRecord = {
  readonly key: string;
  readonly identity: string;
  readonly partition: ActionPartition;
  readonly action: VersionRef;
  readonly receiptId: string;
  readonly at: number;
  readonly identityBytes: number;
  readonly metadataBytes: number;
  state: 'in-flight' | 'executed' | 'ambiguous' | 'rejected';
  output?: ActionPayload;
  outputBytes?: number;
  reason?: string;
  reasonBytes?: number;
  diagnostics?: readonly [ActionFailure, ...ActionFailure[]];
  diagnosticsBytes?: number;
};

export interface ActionPartition {
  readonly principalKey: string;
  readonly actorKey: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly domainRevision: string;
}

export interface HistoryRecord {
  readonly entry: ActionHistoryEntry;
  readonly partition: ActionPartition;
}

export function partition(contextValue: TrustedActionContext): ActionPartition {
  return frozen({
    principalKey: contextValue.principalKey,
    actorKey: contextValue.actorKey,
    scopeDigest: contextValue.scopeDigest,
    policyRevision: contextValue.policyRevision,
    domainRevision: contextValue.domainRevision,
  });
}

export function samePartition(left: ActionPartition, right: ActionPartition): boolean {
  return (
    left.principalKey === right.principalKey &&
    left.actorKey === right.actorKey &&
    left.scopeDigest === right.scopeDigest &&
    left.policyRevision === right.policyRevision &&
    left.domainRevision === right.domainRevision
  );
}

export function copyDiagnostics(value: readonly Diagnostic[]): readonly [ActionFailure, ...ActionFailure[]] {
  const items = Array.isArray(value) ? value.slice(0, WIRE_LIMITS.diagnostics) : [];
  const normalized = items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item))
      return diagnostic('action.callback', 'The host action was rejected.');
    const candidate = item as Record<string, unknown>;
    const code = typeof candidate.code === 'string' && validId(candidate.code) ? candidate.code : 'action.callback';
    const message =
      typeof candidate.message === 'string' &&
      candidate.message.length > 0 &&
      candidate.message.length <= WIRE_LIMITS.label
        ? candidate.message
        : 'The host action was rejected.';
    const path = Array.isArray(candidate.path)
      ? candidate.path
          .slice(0, WIRE_LIMITS.depth)
          .filter(
            (part): part is string | number =>
              (typeof part === 'string' && validId(part)) ||
              (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0),
          )
      : undefined;
    return {
      code,
      message,
      ...(path === undefined || path.length === 0 ? {} : { path }),
      retryable: candidate.retryable === true,
    } as ActionFailure;
  });
  return Object.freeze(
    normalized.length > 0 ? normalized : [diagnostic('action.callback', 'The host action was rejected.')],
  ) as readonly [ActionFailure, ...ActionFailure[]];
}

export function normalizeDispatch(value: unknown): ActionDispatchResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  switch (record.state) {
    case 'completed':
      if (Object.hasOwn(record, 'output')) return { state: 'completed', output: record.output };
      return undefined;
    case 'ambiguous':
      if (validText(record.reason)) return { state: 'ambiguous', reason: record.reason };
      return undefined;
    case 'rejected':
      if (Array.isArray(record.diagnostics) && record.diagnostics.length > 0)
        return { state: 'rejected', diagnostics: copyDiagnostics(record.diagnostics as Diagnostic[]) };
      return undefined;
    default:
      return undefined;
  }
}

export function bounded(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${name} must be a bounded positive safe integer.`);
  return value;
}
