import { WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Outcome, Result, ResultRef, SemanticType } from '@varendo/core';
import type { DataValue } from '../data/types.js';
import type { ResultHandle, ResultSnapshot } from '../results/types.js';
import type { CohortMembership, CohortRequest, CohortResolver, CohortResolverContext } from './types.js';
import {
  canonical,
  catalogField,
  findField,
  grainHas,
  safeId,
  sameRef,
  sameType,
  tupleKey,
  validValue,
} from './cohort-identity.js';

export { lowerCohortQuery } from './cohort-identity.js';

function failure<T = never>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  const diagnostic: Diagnostic = {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path: [...path] }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

function deadlineFailure<T = never>(request: CohortRequest, context: CohortResolverContext): Outcome<T> | undefined {
  if (request.signal?.aborted || context.readContext.signal?.aborted)
    return failure('runtime.evaluation-cancelled', 'Cohort resolution was cancelled.');
  const now = context.now();
  if (!Number.isFinite(now) || now >= request.deadlineAt)
    return failure('runtime.evaluation-budget', 'Cohort resolution exceeded its deadline.');
  return undefined;
}

function resultRows(snapshot: ResultSnapshot): readonly Record<string, DataValue>[] {
  const rows: Record<string, DataValue>[] = [];
  for (const batch of snapshot.batches) for (const row of batch.rows) rows.push(row as Record<string, DataValue>);
  return rows;
}

function authorityCheck(request: CohortRequest, context: CohortResolverContext, handle: ResultHandle): Outcome<void> {
  if (!context.grants.includes('result.inspect'))
    return failure('runtime.evaluation-denied', 'The host did not grant result inspection for cohort membership.');
  if (request.scopeDigest !== context.scopeDigest)
    return failure('runtime.evaluation-denied', 'The cohort request scope does not match the fresh host authority.', [
      'scopeDigest',
    ]);
  if (handle.key.principalKey !== context.principalKey)
    return failure('runtime.evaluation-denied', 'The cohort source belongs to a different authenticated principal.');
  if (request.catalogRevision !== context.catalogRevision || handle.key.catalogRevision !== context.catalogRevision)
    return failure('runtime.evaluation-stale', 'The cohort result is bound to a different catalog revision.', [
      'catalogRevision',
    ]);
  if (handle.key.scopeDigest !== context.scopeDigest)
    return failure('runtime.evaluation-denied', 'The cohort result is outside the current authorization scope.');
  if (handle.key.policyRevision !== context.policyRevision)
    return failure('runtime.evaluation-denied', 'The cohort result policy revision is no longer authorized.', [
      'policyRevision',
    ]);
  if (handle.key.functionRegistryDigest !== context.functionRegistryDigest)
    return failure('runtime.evaluation-stale', 'The cohort result uses a different function registry revision.');
  if (request.sourceRevision !== undefined && request.sourceRevision !== handle.key.sourceRevision)
    return failure('runtime.evaluation-stale', 'The requested historical cohort source revision is unavailable.', [
      'sourceRevision',
    ]);
  return { ok: true, value: undefined };
}

function validSourceRef(ref: ResultRef): boolean {
  return (
    safeId(ref.id) &&
    safeId(ref.revision) &&
    safeId(ref.sourceLineage) &&
    safeId(ref.outputId) &&
    safeId(ref.queryDigest) &&
    safeId(ref.scopeDigest)
  );
}

function identityKeysBounded(keys: unknown): keys is readonly string[] {
  return Array.isArray(keys) && keys.length > 0 && keys.length <= WIRE_LIMITS.array;
}

function identityKeysValid(keys: readonly string[]): boolean {
  return new Set(keys).size === keys.length && keys.every(safeId);
}

function validTargetGrain(grain: readonly string[] | undefined): boolean {
  return grain === undefined || (Array.isArray(grain) && grain.every(safeId));
}

function requestFailure(request: CohortRequest, context: CohortResolverContext): Outcome<never> | undefined {
  if (!validSourceRef(request.source))
    return failure('runtime.evaluation-invalid', 'The cohort source reference is not a bounded canonical identifier.');
  if (!identityKeysBounded(request.identityKeys))
    return failure('runtime.evaluation-invalid', 'A cohort requires a bounded non-empty identity key list.', [
      'identityKeys',
    ]);
  if (!identityKeysValid(request.identityKeys))
    return failure('runtime.evaluation-invalid', 'Cohort identity keys must be unique bounded identifiers.', [
      'identityKeys',
    ]);
  if (!validTargetGrain(request.targetGrain))
    return failure('runtime.evaluation-invalid', 'The target grain contains an invalid field identifier.', [
      'targetGrain',
    ]);
  return deadlineFailure(request, context);
}

function resolveHandle(
  request: CohortRequest,
  context: CohortResolverContext,
): Outcome<{ readonly handle: ResultHandle; readonly lease: ReturnType<ResultHandle['retain']> }> {
  let handle: ResultHandle | undefined;
  try {
    handle = context.resolveResult(request.source);
  } catch {
    return failure('runtime.evaluation-denied', 'The host result resolver failed.');
  }
  if (handle === undefined)
    return failure('runtime.evaluation-denied', 'The cohort source is not a host-owned live result.');
  try {
    return { ok: true, value: { handle, lease: handle.retain() } };
  } catch {
    return failure('runtime.evaluation-denied', 'The cohort source could not be retained.');
  }
}

interface ReadySource {
  readonly snapshot: ResultSnapshot;
  readonly descriptor: NonNullable<ResultSnapshot['descriptor']>;
}

function readySource(
  request: CohortRequest,
  context: CohortResolverContext,
  handle: ResultHandle,
): Outcome<ReadySource> {
  const snapshot = handle.snapshot();
  const descriptor = snapshot.descriptor;
  if (descriptor === undefined || !sameRef(descriptor.ref, request.source))
    return failure(
      'runtime.evaluation-stale',
      'The cohort source descriptor does not match the requested immutable reference.',
    );
  if (snapshot.status !== 'ready' || descriptor.coverage.kind !== 'complete')
    return failure(
      'runtime.evaluation-incomplete',
      'A cohort requires a complete ready result; partial or sampled pages cannot define membership.',
    );
  if (descriptor.consistency.kind !== 'snapshot' || descriptor.consistency.snapshotId !== handle.key.sourceRevision)
    return failure('runtime.evaluation-stale', 'The cohort source does not carry one stable source snapshot.');
  if (request.source.scopeDigest !== context.scopeDigest)
    return failure('runtime.evaluation-denied', 'The cohort source reference is outside the current scope.');
  return { ok: true, value: { snapshot, descriptor } };
}

function identityFields(
  request: CohortRequest,
  context: CohortResolverContext,
  descriptor: NonNullable<ResultSnapshot['descriptor']>,
): Outcome<readonly Result['fields'][number][]> {
  const fields = request.identityKeys.map((key) => findField(descriptor, key));
  if (fields.some((field) => field === undefined))
    return failure(
      'runtime.evaluation-grain',
      'Every cohort identity key must be a unique field in the source result.',
      ['identityKeys'],
    );
  const selected = fields as Result['fields'][number][];
  for (let index = 0; index < selected.length; index++) {
    const field = selected[index]!;
    const requested = request.identityKeys[index]!;
    if (!grainHas(descriptor.rowGrain, field.id, requested))
      return failure('runtime.evaluation-grain', 'Cohort identity keys must be present in the source row grain.', [
        'identityKeys',
        index,
      ]);
    const catalog = catalogField(context.catalog, requested);
    if (catalog !== undefined && !sameType(field.type, catalog.field.type))
      return failure(
        'runtime.evaluation-grain',
        'Cohort identity field semantics do not match the authorized catalog.',
        ['identityKeys', index],
      );
  }
  return { ok: true, value: selected };
}

function completeRows(
  snapshot: ResultSnapshot,
  descriptor: NonNullable<ResultSnapshot['descriptor']>,
): Outcome<readonly Record<string, DataValue>[]> {
  const rows = resultRows(snapshot);
  if (rows.length !== snapshot.loadedRows)
    return failure(
      'runtime.evaluation-incomplete',
      'The retained result batches do not match the result store row count.',
    );
  if (descriptor.counts.population.kind !== 'exact' || descriptor.counts.population.value !== rows.length)
    return failure('runtime.evaluation-incomplete', 'A complete cohort source must declare an exact population count.');
  return { ok: true, value: rows };
}

function rowTuple(
  row: Record<string, DataValue>,
  fields: readonly Result['fields'][number][],
): Outcome<{ readonly tuple: readonly DataValue[]; readonly key: string }> {
  const tuple: DataValue[] = [];
  for (const field of fields) {
    const value = row[field.id];
    if (value === undefined || value === null || !validValue(value, field.type))
      return failure('runtime.evaluation-grain', 'Cohort identity values must be present, typed and non-null.');
    tuple.push(value);
  }
  const key = tupleKey(
    tuple,
    fields.map((field) => field.type),
  );
  if (!key.ok) return key;
  return { ok: true, value: { tuple: Object.freeze(tuple), key: key.value } };
}

function uniqueTuples(
  rows: readonly Record<string, DataValue>[],
  fields: readonly Result['fields'][number][],
  request: CohortRequest,
  context: CohortResolverContext,
  maxTuples: number,
  maxBytes: number,
): Outcome<readonly (readonly DataValue[])[]> {
  const tuples: (readonly DataValue[])[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const row of rows) {
    const expired = deadlineFailure(request, context);
    if (expired !== undefined) return expired;
    const parsed = rowTuple(row, fields);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.key)) continue;
    seen.add(parsed.value.key);
    tuples.push(parsed.value.tuple);
    if (tuples.length > maxTuples)
      return failure('runtime.evaluation-budget', 'The cohort exceeds its bounded identity tuple budget.');
    bytes += new TextEncoder().encode(parsed.value.key).byteLength;
    if (bytes > maxBytes)
      return failure('runtime.evaluation-budget', 'The cohort exceeds its bounded identity byte budget.');
  }
  return { ok: true, value: Object.freeze(tuples) };
}

function sourceLineage(descriptor: NonNullable<ResultSnapshot['descriptor']>): readonly ResultRef[] {
  const lineage = new Map<string, ResultRef>();
  lineage.set(canonical(descriptor.ref), descriptor.ref);
  for (const entry of descriptor.lineage) {
    for (const input of entry.inputs) lineage.set(canonical(input), input);
  }
  return Object.freeze([...lineage.values()]);
}

async function createMembership(
  request: CohortRequest,
  context: CohortResolverContext,
  handle: ResultHandle,
  descriptor: NonNullable<ResultSnapshot['descriptor']>,
  fields: readonly Result['fields'][number][],
  tuples: readonly (readonly DataValue[])[],
): Promise<Outcome<CohortMembership>> {
  const types = fields.map((field) => field.type);
  const sourceRevision = handle.key.sourceRevision;
  const digest = await cohortDigest({
    source: descriptor.ref,
    identityKeys: request.identityKeys,
    types,
    tuples,
    scopeDigest: context.scopeDigest,
    ...(context.policyRevision === undefined ? {} : { policyRevision: context.policyRevision }),
    catalogRevision: context.catalogRevision,
    sourceRevision,
  });
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: Object.freeze({
      source: descriptor.ref,
      identityKeys: Object.freeze([...request.identityKeys]),
      types: Object.freeze(types),
      tuples,
      tupleDigest: digest.value,
      scopeDigest: context.scopeDigest,
      ...(context.policyRevision === undefined ? {} : { policyRevision: context.policyRevision }),
      catalogRevision: context.catalogRevision,
      sourceRevision,
      lineage: sourceLineage(descriptor),
      complete: true as const,
    }),
  };
}

async function resolveCohort(
  request: CohortRequest,
  context: CohortResolverContext,
  maxTuples: number,
  maxBytes: number,
): Promise<Outcome<CohortMembership>> {
  const invalid = requestFailure(request, context);
  if (invalid !== undefined) return invalid;
  const resolved = resolveHandle(request, context);
  if (!resolved.ok) return resolved;
  const { handle, lease } = resolved.value;
  try {
    const authority = authorityCheck(request, context, handle);
    if (!authority.ok) return authority;
    const source = readySource(request, context, handle);
    if (!source.ok) return source;
    const selected = identityFields(request, context, source.value.descriptor);
    if (!selected.ok) return selected;
    const rows = completeRows(source.value.snapshot, source.value.descriptor);
    if (!rows.ok) return rows;
    const tuples = uniqueTuples(rows.value, selected.value, request, context, maxTuples, maxBytes);
    if (!tuples.ok) return tuples;
    return createMembership(request, context, handle, source.value.descriptor, selected.value, tuples.value);
  } finally {
    lease.release();
  }
}

/**
 * Compute the digest that a fixed population must carry in its wire query.
 * The digest is over the trusted, deduplicated membership and its authority
 * pins; a caller-provided string is never accepted as proof by itself.
 */
export async function cohortDigest(input: {
  readonly source: ResultRef;
  readonly identityKeys: readonly string[];
  readonly types: readonly SemanticType[];
  readonly tuples: readonly (readonly DataValue[])[];
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  readonly sourceRevision: string;
}): Promise<Outcome<string>> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined)
    return failure('runtime.evaluation-crypto', 'WebCrypto SHA-256 is required for cohort identities.');
  try {
    // Membership is a set, while each tuple's position remains meaningful for
    // composite identities. scalarIdentity supplies the typed canonical form
    // (including decimal, signed-zero and instant equivalence); sorting those
    // identities makes the digest stable when source row order changes.
    const tuples: string[] = [];
    for (const tuple of input.tuples) {
      const key = tupleKey(tuple, input.types);
      if (!key.ok) return key;
      tuples.push(key.value);
    }
    tuples.sort((left, right) => left.localeCompare(right));
    const encoded = new TextEncoder().encode(canonical({ ...input, tuples }));
    const bytes = new Uint8Array(await subtle.digest('SHA-256', encoded));
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return { ok: true, value: `cohort-${hex}` };
  } catch {
    return failure('runtime.evaluation-crypto', 'The cohort identity could not be hashed.');
  }
}

export interface ResultCohortResolverOptions {
  readonly maxTuples?: number;
  readonly maxBytes?: number;
}

function resolverLimits(options: ResultCohortResolverOptions): {
  readonly maxTuples: number;
  readonly maxBytes: number;
} {
  const maxTuples = options.maxTuples ?? 10_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxTuples) || maxTuples < 1 || maxTuples > WIRE_LIMITS.array)
    throw new TypeError('maxTuples must be a bounded positive count.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WIRE_LIMITS.bytes)
    throw new TypeError('maxBytes must be a bounded positive byte limit.');
  return { maxTuples, maxBytes };
}

/** Resolver over host-owned ResultHandles; it never trusts a wire ResultRef alone. */
export function createResultCohortResolver(options: ResultCohortResolverOptions = {}): CohortResolver {
  const { maxTuples, maxBytes } = resolverLimits(options);
  return { resolve: (request, context) => resolveCohort(request, context, maxTuples, maxBytes) };
}
