import { parsePresentationPlan, parseTask, parseWireValue, validateCommitReadSet, WIRE_LIMITS } from '@varendo/core';
import { parseInteractionState } from '@varendo/core/interaction';
import type { ResultRef } from '@varendo/core';
import type { RegionContent } from '../tasks/types.js';
import type { RegionAuthority, RegionFailure, RegionOutcome, RegionReadSet } from './types.js';

export const FAILURE = {
  invalid: 'The region command is not a valid bounded runtime document.',
  stale: 'The region proposal is stale against the current task, policy, result or data revision.',
  denied: 'The host did not authorize the region command.',
  revoked: 'The region authorization has been revoked.',
  disposed: 'The region has been disposed.',
  budget: 'The region command exceeds its bounded runtime budget.',
  queue: 'The region command queue is full or closed.',
  authorizationTimeout: 'The host commit authorization exceeded its bounded time budget.',
} as const;

export const DEFAULT_COMMIT_AUTHORIZATION_MILLISECONDS = 30_000;
export const MAX_COMMIT_AUTHORIZATION_MILLISECONDS = 86_400_000;

const STATE_FIELDS: ReadonlySet<string> = new Set(['task', 'presentation', 'interaction']);
let regionIncarnationCounter = 0;
let runtimeRevisionCounter = 0;

export function newRegionRevision(): string {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return `r-${crypto.randomUUID()}`;
  regionIncarnationCounter = (regionIncarnationCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `r-${Date.now().toString(36)}-${regionIncarnationCounter.toString(36)}-${Math.floor(Math.random() * 0x1_0000_0000).toString(36)}`.slice(
    0,
    WIRE_LIMITS.id,
  );
}

export const refKey = (ref: ResultRef): string =>
  JSON.stringify([ref.id, ref.revision, ref.sourceLineage, ref.outputId, ref.queryDigest, ref.scopeDigest]);
export const logicalRefKey = (ref: ResultRef): string =>
  JSON.stringify([ref.outputId, ref.queryDigest, ref.scopeDigest]);
export const failure = <T>(code: RegionFailure['code'], message: string): RegionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyStringKeys(record: Record<string, unknown>): boolean {
  return Reflect.ownKeys(record).every((key) => typeof key === 'string');
}

function isSuccessOutcome(record: Record<string, unknown>, keys: readonly PropertyKey[]): boolean {
  return record.ok === true && keys.length === 2 && keys.includes('ok') && keys.includes('value');
}

function isFailureOutcome(record: Record<string, unknown>, keys: readonly PropertyKey[]): boolean {
  return (
    record.ok === false &&
    keys.length === 2 &&
    keys.includes('ok') &&
    keys.includes('diagnostics') &&
    Array.isArray(record.diagnostics) &&
    record.diagnostics.length > 0 &&
    record.diagnostics.length <= WIRE_LIMITS.diagnostics
  );
}

const DIAGNOSTIC_KEYS = ['code', 'message', 'retryable', 'path', 'remedies'];

function validDiagnosticPath(value: unknown): value is readonly (string | number)[] {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array) return false;
  return value.every((part) => (typeof part === 'string' ? validId(part) : Number.isSafeInteger(part) && part >= 0));
}

function validDiagnosticRemedies(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= WIRE_LIMITS.array && value.every(validText);
}

function normalizeHostDiagnostic(candidate: unknown): RegionFailure | undefined {
  if (!isRecord(candidate)) return undefined;
  const diagnostic = candidate;
  if (
    Object.keys(diagnostic).some((key) => !DIAGNOSTIC_KEYS.includes(key)) ||
    !validId(diagnostic.code) ||
    !validText(diagnostic.message) ||
    typeof diagnostic.retryable !== 'boolean'
  )
    return undefined;
  if (diagnostic.path !== undefined && !validDiagnosticPath(diagnostic.path)) return undefined;
  if (diagnostic.remedies !== undefined && !validDiagnosticRemedies(diagnostic.remedies)) return undefined;
  return frozen({
    code: diagnostic.code,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
    ...(diagnostic.path === undefined ? {} : { path: Object.freeze([...diagnostic.path]) }),
    ...(diagnostic.remedies === undefined ? {} : { remedies: Object.freeze([...diagnostic.remedies]) }),
  });
}

function normalizeHostDiagnostics(value: unknown): readonly RegionFailure[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const diagnostics: RegionFailure[] = [];
  for (const candidate of value) {
    const normalized = normalizeHostDiagnostic(candidate);
    if (normalized === undefined) return undefined;
    diagnostics.push(normalized);
  }
  return diagnostics;
}

export function normalizeHostOutcome<T>(
  value: unknown,
  code: RegionFailure['code'] = 'runtime.region-denied',
): RegionOutcome<T> {
  try {
    if (!isRecord(value)) return failure(code, FAILURE.denied);
    const keys = Reflect.ownKeys(value);
    if (!hasOnlyStringKeys(value)) return failure(code, FAILURE.denied);
    if (isSuccessOutcome(value, keys)) return { ok: true, value: value.value as T };
    if (!isFailureOutcome(value, keys)) return failure(code, FAILURE.denied);
    const diagnostics = normalizeHostDiagnostics(value.diagnostics);
    if (diagnostics === undefined) return failure(code, FAILURE.denied);
    return { ok: false, diagnostics: diagnostics as [RegionFailure, ...RegionFailure[]] };
  } catch {
    /* malformed host values fail closed below */
  }
  return failure(code, FAILURE.denied);
}

export function frozen<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) frozen(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

export { canonicalJson as canonical, canonicalDigest as digest } from '../canonical.js';

export function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}
export function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= WIRE_LIMITS.text;
}
function validDataRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validateResultRef(value: unknown): value is ResultRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!parseWireValue(value).ok) return false;
  const record = value as Record<string, unknown>;
  const required = ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest'];
  const names = Object.keys(record);
  return (
    names.length === required.length + (record.sourceLineage === undefined ? 0 : 1) &&
    names.every((name) => name === 'sourceLineage' || required.includes(name)) &&
    required.every((name) => validId(record[name])) &&
    (record.sourceLineage === undefined || validId(record.sourceLineage))
  );
}

export function normalizeRefs(value: readonly ResultRef[], scopeDigest: string): RegionOutcome<readonly ResultRef[]> {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array)
    return failure('runtime.region-budget', FAILURE.budget);
  const seen = new Set<string>();
  const refs: ResultRef[] = [];
  for (const ref of value) {
    if (!validateResultRef(ref) || ref.scopeDigest !== scopeDigest)
      return failure(
        'runtime.region-invalid',
        'Every result reference must be bounded and belong to the region authorization scope.',
      );
    const key = refKey(ref);
    if (seen.has(key))
      return failure('runtime.region-invalid', 'A region read set cannot contain duplicate result references.');
    seen.add(key);
    refs.push(frozen({ ...ref }));
  }
  return { ok: true, value: Object.freeze(refs) };
}

function validateStateRecord(value: unknown): RegionOutcome<Record<string, unknown>> {
  const wire = parseWireValue(value);
  if (!wire.ok || !isRecord(wire.value)) return failure('runtime.region-invalid', FAILURE.invalid);
  const record = wire.value;
  if (Object.keys(record).some((field) => !STATE_FIELDS.has(field)) || !Object.hasOwn(record, 'task'))
    return failure(
      'runtime.region-invalid',
      'A region state requires a Task and may contain a PresentationPlan and typed interaction state.',
    );
  return { ok: true, value: record };
}

function validateRegionTask(value: unknown, regionId: string): RegionOutcome<RegionContent['task']> {
  const task = parseTask(value);
  if (!task.ok) return failure('runtime.region-invalid', 'The region Task is not a valid canonical contract.');
  if (task.value.regionId !== regionId)
    return failure('runtime.region-invalid', 'The Task regionId must match the owning region.');
  return task;
}

function validatePresentation(value: unknown): RegionOutcome<RegionContent['presentation']> {
  if (value === undefined) return { ok: true, value: undefined };
  const presentation = parsePresentationPlan(value);
  if (!presentation.ok)
    return failure('runtime.region-invalid', 'The region PresentationPlan is not a valid canonical contract.');
  return presentation;
}

function validateInteraction(value: unknown): RegionOutcome<RegionContent['interaction']> {
  if (value === undefined) return { ok: true, value: undefined };
  const interaction = parseInteractionState(value);
  if (!interaction.ok)
    return failure('runtime.region-invalid', 'The interaction state is not a valid canonical contract.');
  return interaction;
}

export function validateState(value: unknown, regionId: string): RegionOutcome<RegionContent> {
  const validatedRecord = validateStateRecord(value);
  if (!validatedRecord.ok) return validatedRecord;
  const record = validatedRecord.value;
  const task = validateRegionTask(record.task, regionId);
  if (!task.ok) return task;
  const presentation = validatePresentation(record.presentation);
  if (!presentation.ok) return presentation;
  const interaction = validateInteraction(record.interaction);
  if (!interaction.ok) return interaction;
  return {
    ok: true,
    value: frozen({
      task: task.value,
      ...(presentation.value === undefined ? {} : { presentation: presentation.value }),
      ...(interaction.value === undefined ? {} : { interaction: interaction.value }),
    }),
  };
}

const AUTHORITY_KEYS = [
  'principalKey',
  'scopeDigest',
  'policyRevision',
  'catalogRevision',
  'experienceRevision',
  'functionRegistryDigest',
  'results',
];

function validateAuthorityFields(record: Record<string, unknown>): boolean {
  if (Object.keys(record).some((name) => !AUTHORITY_KEYS.includes(name))) return false;
  return AUTHORITY_KEYS.every((name) => Object.hasOwn(record, name));
}

function validPrincipalKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.length > 0 && value.length <= WIRE_LIMITS.id * 4 && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validateAuthority(value: unknown): RegionOutcome<RegionAuthority> {
  if (!isRecord(value)) return failure('runtime.region-denied', FAILURE.denied);
  const record = value;
  if (!validateAuthorityFields(record)) return failure('runtime.region-denied', FAILURE.denied);
  if (!validPrincipalKey(record.principalKey)) return failure('runtime.region-denied', FAILURE.denied);
  for (const name of AUTHORITY_KEYS.slice(1, -1))
    if (!validId(record[name])) return failure('runtime.region-denied', FAILURE.denied);
  const refs = normalizeRefs(record.results as readonly ResultRef[], record.scopeDigest as string);
  if (!refs.ok) return refs as RegionOutcome<RegionAuthority>;
  return {
    ok: true,
    value: frozen({
      principalKey: record.principalKey as string,
      scopeDigest: record.scopeDigest as string,
      policyRevision: record.policyRevision as string,
      catalogRevision: record.catalogRevision as string,
      experienceRevision: record.experienceRevision as string,
      functionRegistryDigest: record.functionRegistryDigest as string,
      results: refs.value,
    }),
  };
}

export function authorityReadSet(
  authority: RegionAuthority,
  taskRevision: string,
  regionRevision: string,
  dataRevision: number,
): RegionReadSet {
  return frozen({
    scopeDigest: authority.scopeDigest,
    policyRevision: authority.policyRevision,
    taskRevision,
    regionRevision,
    catalogRevision: authority.catalogRevision,
    experienceRevision: authority.experienceRevision,
    functionRegistryDigest: authority.functionRegistryDigest,
    results: authority.results,
    dataRevision,
  });
}

export function stripData(readSet: RegionReadSet): Omit<RegionReadSet, 'dataRevision'> {
  const { dataRevision: _dataRevision, ...canonicalReadSet } = readSet;
  return canonicalReadSet;
}

export function validateReadSet(value: unknown): RegionOutcome<RegionReadSet> {
  const wire = parseWireValue(value);
  if (!wire.ok || wire.value === null || typeof wire.value !== 'object' || Array.isArray(wire.value))
    return failure('runtime.region-invalid', FAILURE.invalid);
  const record = wire.value as Record<string, unknown>;
  const names = [
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
  if (Object.keys(record).some((name) => !names.includes(name)) || names.some((name) => !Object.hasOwn(record, name)))
    return failure('runtime.region-invalid', FAILURE.invalid);
  if (!validDataRevision(record.dataRevision) || !Array.isArray(record.results))
    return failure('runtime.region-invalid', FAILURE.invalid);
  const canonical = { ...record };
  delete canonical.dataRevision;
  const checked = validateCommitReadSet(canonical, canonical);
  if (!checked.ok) return failure('runtime.region-invalid', checked.diagnostics[0]!.message);
  const refs = normalizeRefs(record.results as readonly ResultRef[], checked.value.scopeDigest);
  if (!refs.ok) return refs;
  return {
    ok: true,
    value: frozen({ ...checked.value, results: refs.value, dataRevision: record.dataRevision as number }),
  };
}

export function interactionResultReferences(interaction: RegionContent['interaction']): readonly ResultRef[] {
  const refs: ResultRef[] = [];
  for (const entry of interaction?.values ?? []) {
    if (entry.payload.kind === 'selection' && entry.payload.selection.mode === 'ids')
      refs.push(entry.payload.selection.result);
  }
  return refs;
}

export function requiredResultReferences(state: RegionContent): readonly ResultRef[] {
  const refs: ResultRef[] = [];
  if (state.task.kind === 'presentation') refs.push(...state.task.inputs);
  if (state.task.kind === 'data') {
    for (const output of state.task.outputs) {
      if (output.kind === 'reuse') refs.push(output.result);
      else if (output.query.population.kind === 'fixed') refs.push(output.query.population.source);
    }
  }
  for (const node of state.presentation?.nodes ?? []) if (node.result !== undefined) refs.push(node.result);
  if (state.presentation !== undefined) refs.push(...state.presentation.preconditions.results);
  refs.push(...interactionResultReferences(state.interaction));
  return refs;
}

export function bindCandidateToReadSet(state: RegionContent, expected: RegionReadSet): RegionOutcome<void> {
  if (
    state.task.catalogRevision !== expected.catalogRevision ||
    state.task.functionRegistryDigest !== expected.functionRegistryDigest
  )
    return failure('runtime.region-stale', 'The candidate Task is bound to a different catalog or function registry.');
  if (state.presentation !== undefined) {
    const plan = state.presentation.preconditions;
    const checked = validateCommitReadSet(plan, stripData(expected), plan.results);
    if (!checked.ok)
      return failure('runtime.region-stale', 'The candidate PresentationPlan is bound to a different read set.');
  }
  return { ok: true, value: undefined };
}

export function nextRevision(current: string): string {
  if (/^[0-9]+$/u.test(current)) {
    const number = Number(current);
    if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER) return String(number + 1);
  }
  for (;;) {
    if (runtimeRevisionCounter >= Number.MAX_SAFE_INTEGER) throw new RangeError('Runtime revision budget exhausted.');
    runtimeRevisionCounter++;
    const suffix = `-${runtimeRevisionCounter.toString(36)}`;
    if (suffix.length >= WIRE_LIMITS.id) throw new RangeError('Runtime revision budget exhausted.');
    const next = `${current.slice(0, WIRE_LIMITS.id - suffix.length)}${suffix}`;
    if (next !== current) return next;
  }
}
