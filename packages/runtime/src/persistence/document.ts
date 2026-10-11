import { parseTask, parseWireValue, WIRE_LIMITS } from '@varendo/core';
import type { Contract, Diagnostic } from '@varendo/core';
import { canonicalDigest as digest, canonicalJson as canonical } from '../canonical.js';
import type { RegionDocument, RegionDocumentInput, RegionPersistence } from './types.js';
import type { RegionHistoryEntry, RegionOutcome, RegionReadSet, RegionSnapshot } from '../regions/types.js';

const VERSION = '1' as const;
const HISTORY_KINDS: ReadonlySet<string> = new Set(['commit', 'data', 'revoke']);
const failure = <T>(code: string, message: string): RegionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false } as Diagnostic],
});

function frozen<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) frozen(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function validReadSetRevisions(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields
    .filter((field) => field !== 'results' && field !== 'dataRevision')
    .every((field) => validId(record[field]));
}

function validReadSetResult(value: unknown, scopeDigest: unknown): value is Record<string, unknown> {
  if (!recordValue(value)) return false;
  const fields = ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest'];
  const keys = Object.keys(value);
  return (
    keys.length === fields.length + (value.sourceLineage === undefined ? 0 : 1) &&
    keys.every((field) => field === 'sourceLineage' || fields.includes(field)) &&
    fields.every((field) => validId(value[field])) &&
    (value.sourceLineage === undefined || validId(value.sourceLineage)) &&
    value.scopeDigest === scopeDigest
  );
}

function validReadSetResults(value: unknown, scopeDigest: unknown): boolean {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array) return false;
  const refs = new Set<string>();
  for (const ref of value) {
    if (!validReadSetResult(ref, scopeDigest)) return false;
    const key = canonical(ref);
    if (refs.has(key)) return false;
    refs.add(key);
  }
  return true;
}

function validReadSet(value: unknown): value is RegionReadSet {
  if (!recordValue(value)) return false;
  const record = value;
  const fields = [
    'scopeDigest',
    'policyRevision',
    'taskRevision',
    'regionRevision',
    'catalogRevision',
    'experienceRevision',
    'functionRegistryDigest',
    'results',
    'dataRevision',
  ];
  if (!hasOnlyKeys(record, fields) || !fields.every((field) => Object.hasOwn(record, field))) return false;
  if (!validReadSetRevisions(record, fields)) return false;
  if (
    !Number.isSafeInteger(record.dataRevision) ||
    (record.dataRevision as number) < 0 ||
    !Array.isArray(record.results) ||
    record.results.length > WIRE_LIMITS.array
  )
    return false;
  return validReadSetResults(record.results, record.scopeDigest);
}

const HISTORY_FIELDS = [
  'kind',
  'taskRevision',
  'regionRevision',
  'dataRevision',
  'stateDigest',
  'changedResults',
  'requestId',
  'reason',
  'at',
] as const;

function validChangedResult(value: unknown, scopeDigest: string): value is Record<string, unknown> {
  return validReadSetResult(value, scopeDigest);
}

function validChangedResults(value: unknown, scopeDigest: string): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array) return false;
  const refs = new Set<string>();
  for (const ref of value) {
    if (!validChangedResult(ref, scopeDigest)) return false;
    const key = canonical(ref);
    if (refs.has(key)) return false;
    refs.add(key);
  }
  return true;
}

function validHistoryIdentity(record: Record<string, unknown>): boolean {
  return HISTORY_KINDS.has(String(record.kind)) && validId(record.taskRevision) && validId(record.regionRevision);
}

function validHistoryClock(record: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(record.dataRevision) &&
    (record.dataRevision as number) >= 0 &&
    Number.isSafeInteger(record.at) &&
    (record.at as number) >= 0
  );
}

function validHistoryMetadata(record: Record<string, unknown>): boolean {
  const digestValid = record.stateDigest === undefined || validId(record.stateDigest);
  const requestValid = record.requestId === undefined || validId(record.requestId);
  const reasonValid =
    record.reason === undefined ||
    (typeof record.reason === 'string' && record.reason.length > 0 && record.reason.length <= WIRE_LIMITS.text);
  return digestValid && requestValid && reasonValid;
}

function validHistoryEntry(entry: unknown, scopeDigest: string): boolean {
  if (!recordValue(entry)) return false;
  return (
    hasOnlyKeys(entry, HISTORY_FIELDS) &&
    validHistoryIdentity(entry) &&
    validHistoryClock(entry) &&
    validHistoryMetadata(entry) &&
    validChangedResults(entry.changedResults, scopeDigest)
  );
}

function validHistory(value: unknown, scopeDigest: string): value is readonly RegionHistoryEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= WIRE_LIMITS.array &&
    value.every((entry) => validHistoryEntry(entry, scopeDigest))
  );
}

function validateDocument(input: unknown): RegionOutcome<RegionDocument> {
  if (!recordValue(input)) return failure('runtime.region-invalid', 'The persisted region document must be an object.');
  const value = input;
  const allowed = [
    'version',
    'id',
    'task',
    'taskRevision',
    'regionRevision',
    'dataRevision',
    'readSet',
    'stateDigest',
    'history',
  ];
  if (!hasOnlyKeys(value, allowed))
    return failure('runtime.region-invalid', 'The persisted region document contains an unknown property.');
  if (!validDocumentIdentity(value))
    return failure('runtime.region-invalid', 'The persisted region document has an unsupported identity or version.');
  if (!validDocumentReadSet(value))
    return failure('runtime.region-invalid', 'The persisted region revisions or read set are invalid.');
  const readSet = value.readSet as RegionReadSet;
  if (!validDocumentHistory(value, readSet))
    return failure('runtime.region-invalid', 'The persisted data revision or history is invalid.');
  const task = persistedTask(value);
  if (task === undefined)
    return failure('runtime.region-invalid', 'The persisted Task does not belong to the region revision.');
  const document: RegionDocument = frozen({
    version: VERSION,
    id: value.id as string,
    task,
    taskRevision: value.taskRevision as string,
    regionRevision: value.regionRevision as string,
    dataRevision: value.dataRevision as number,
    readSet: value.readSet as RegionReadSet,
    stateDigest: value.stateDigest as string,
    history: value.history as readonly RegionHistoryEntry[],
  });
  return { ok: true, value: document };
}

function validDocumentIdentity(value: Record<string, unknown>): boolean {
  return (
    value.version === VERSION &&
    validId(value.id) &&
    validId(value.taskRevision) &&
    validId(value.regionRevision) &&
    validId(value.stateDigest)
  );
}

function validDocumentReadSet(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.dataRevision) && (value.dataRevision as number) >= 0 && validReadSet(value.readSet);
}

function validDocumentHistory(value: Record<string, unknown>, readSet: RegionReadSet): boolean {
  return value.dataRevision === readSet.dataRevision && validHistory(value.history, readSet.scopeDigest);
}

function persistedTask(value: Record<string, unknown>): Contract<'task'> | undefined {
  const task = parseTask(value.task);
  if (!task.ok || task.value.regionId !== value.id || task.value.revision !== value.taskRevision) return undefined;
  return task.value;
}

export function exportRegionDocument(
  snapshot: RegionSnapshot,
  history: readonly RegionHistoryEntry[] = [],
): RegionDocument {
  if (snapshot.status === 'disposed' || snapshot.state === undefined || snapshot.readSet === undefined)
    throw new Error('Only an authorized active region can be persisted.');
  const task = snapshot.state.task;
  const stateDigest = digest(snapshot.state);
  const document: RegionDocument = {
    version: VERSION,
    id: snapshot.id,
    task,
    taskRevision: snapshot.taskRevision,
    regionRevision: snapshot.regionRevision,
    dataRevision: snapshot.dataRevision,
    readSet: snapshot.readSet,
    stateDigest,
    history,
  };
  const parsed = validateDocument(document);
  if (!parsed.ok) throw new TypeError(parsed.diagnostics[0]!.message);
  return parsed.value;
}

export function serializeRegionDocument(snapshot: RegionSnapshot, history: readonly RegionHistoryEntry[] = []): string {
  return canonical(exportRegionDocument(snapshot, history));
}

export function parseRegionDocument(input: RegionDocumentInput): RegionOutcome<RegionDocument> {
  const wire = parseWireValue(input);
  if (!wire.ok) return failure(wire.diagnostics[0]!.code, wire.diagnostics[0]!.message);
  return validateDocument(wire.value);
}

export const regionPersistence: RegionPersistence = Object.freeze({
  export: exportRegionDocument,
  serialize: serializeRegionDocument,
  parse: parseRegionDocument,
});
