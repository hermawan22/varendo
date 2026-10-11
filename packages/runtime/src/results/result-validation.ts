import { scalarIdentity, validateScalar, WIRE_LIMITS } from '@varendo/core';
import type { Result } from '@varendo/core';
import type { Outcome, ResultCell } from './internal-types.js';
import { failure, isKnownCoverage, lineageDigest, sameRef, sameRefParts } from './store-utils.js';
import type { ResultBatch, ResultCacheKey, ResultEvent } from './types.js';

const COVERAGE_KINDS: ReadonlySet<Result['coverage']['kind']> = new Set(['unknown', 'complete', 'partial', 'sample']);

function matchesAcceptedRevision(descriptor: Result, key: ResultCacheKey): boolean {
  if (descriptor.ref.revision === key.sourceRevision) return true;
  if (descriptor.consistency.kind !== 'mixed' || descriptor.consistency.sourceLineage !== key.sourceLineage)
    return false;
  return Object.values(descriptor.consistency.sourceRevisions).includes(descriptor.ref.revision);
}

function validateDescriptorPins(
  descriptor: Result,
  key: ResultCacheKey,
  populationDigest: string | undefined,
): Outcome<void> {
  if (descriptor.taskId !== key.taskId)
    return failure('data.result-task', 'The result descriptor belongs to another task.');
  if (!sameRefParts(descriptor.ref, key))
    return failure('data.result-scope', 'The result descriptor does not match the authorized result pins.');
  if (key.planDigest !== undefined && !matchesAcceptedRevision(descriptor, key))
    return failure('data.result-lineage', 'The result descriptor does not match the accepted source revision.');
  if (
    populationDigest !== undefined &&
    (!isKnownCoverage(descriptor.coverage) || descriptor.coverage.populationDigest !== populationDigest)
  )
    return failure('data.result-population', 'The result descriptor does not match the accepted population.');
  return { ok: true, value: undefined };
}

function validateFieldReferences(
  refs: readonly string[],
  label: string,
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<void> {
  const unique = new Set(refs);
  if (unique.size !== refs.length)
    return failure('data.result-schema', `The result descriptor contains duplicate ${label} identities.`);
  for (const ref of refs) {
    if (!fields.has(ref))
      return failure('data.result-schema', `The result ${label} is not present in the projected fields.`);
  }
  return { ok: true, value: undefined };
}

function validateDescriptorSchema(descriptor: Result): Outcome<void> {
  const fields = new Map<string, Result['fields'][number]>();
  for (const field of descriptor.fields) {
    if (fields.has(field.id))
      return failure('data.result-schema', 'The result descriptor contains duplicate field identities.');
    fields.set(field.id, field);
  }
  const identity = validateFieldReferences(descriptor.identity, 'identity', fields);
  if (!identity.ok) return identity;
  return validateFieldReferences(descriptor.rowGrain, 'row grain', fields);
}

function validateDescriptorCounts(descriptor: Result, key: ResultCacheKey): Outcome<void> {
  if (descriptor.counts.loaded > WIRE_LIMITS.array)
    return failure('data.result-budget', 'The result loaded count exceeds the bounded result limit.');
  const population = descriptor.counts.population;
  if (
    population.kind === 'exact' &&
    population.value < descriptor.counts.loaded &&
    !isProvenGlobalAggregate(descriptor, key, descriptor.counts.loaded)
  )
    return failure('data.result-count', 'The loaded count cannot exceed its exact population count.');
  return { ok: true, value: undefined };
}

function validateDescriptorCoverage(descriptor: Result): Outcome<void> {
  const coverage = descriptor.coverage;
  const population = descriptor.counts.population;
  if (
    isKnownCoverage(coverage) &&
    population.kind !== 'unknown' &&
    population.populationDigest !== coverage.populationDigest
  )
    return failure(
      'data.result-population',
      'The result population count and coverage refer to different populations.',
    );
  if (!COVERAGE_KINDS.has(coverage.kind))
    return failure('data.result-coverage', 'The result descriptor has an invalid coverage state.');
  return { ok: true, value: undefined };
}

function validateDescriptorConsistency(descriptor: Result, key: ResultCacheKey): Outcome<void> {
  if (
    descriptor.consistency.kind === 'snapshot' &&
    descriptor.consistency.snapshotId !== key.sourceRevision &&
    !Object.values(descriptor.consistency.sourceRevisions).includes(key.sourceRevision)
  )
    return failure('data.result-consistency', 'The result snapshot does not include the pinned source revision.');
  if (
    descriptor.consistency.kind === 'mixed' &&
    (key.sourceLineage === undefined || descriptor.consistency.sourceLineage !== key.sourceLineage)
  )
    return failure('data.result-consistency', 'Mixed result consistency is not bound to the accepted source lineage.');
  return { ok: true, value: undefined };
}

function validateDescriptorEvidence(descriptor: Result, key: ResultCacheKey): Outcome<void> {
  if (descriptor.evidence.kind === 'computed' && descriptor.evidence.queryDigest !== key.queryDigest)
    return failure('data.result-evidence', 'Computed evidence belongs to a different query.');
  if (descriptor.evidence.kind !== 'observed' || descriptor.consistency.kind === 'unknown')
    return { ok: true, value: undefined };
  const pinned = descriptor.consistency.sourceRevisions[descriptor.evidence.source.id];
  if (pinned !== undefined && pinned !== descriptor.evidence.source.revision)
    return failure('data.result-evidence', 'Observed evidence contradicts the declared source revision.');
  return { ok: true, value: undefined };
}

function validateLineageEdges(descriptor: Result, key: ResultCacheKey): Outcome<void> {
  for (const edge of descriptor.lineage) {
    if (edge.output !== descriptor.ref.outputId)
      return failure('data.result-lineage', 'Result lineage has an unrelated output binding.');
    for (const ref of edge.inputs) {
      if (ref.scopeDigest !== key.scopeDigest)
        return failure('data.result-lineage', 'Result lineage belongs to another authorization scope.');
    }
  }
  return { ok: true, value: undefined };
}

async function validateDescriptorLineage(descriptor: Result, key: ResultCacheKey): Promise<Outcome<void>> {
  if (key.sourceLineage !== undefined && descriptor.ref.sourceLineage !== key.sourceLineage)
    return failure('data.result-lineage', 'The result descriptor belongs to a different source lineage.');
  if (descriptor.lineage.length > 0 && key.lineageDigest === undefined)
    return failure('data.result-lineage', 'Result lineage requires an accepted plan proof.');
  const recomputed = await lineageDigest(descriptor.ref.outputId, descriptor.lineage);
  if (key.lineageDigest !== undefined && (recomputed === undefined || descriptor.lineageDigest !== recomputed))
    return failure('data.result-lineage', 'Result lineage proof does not match its declared inputs.');
  if (key.lineageDigest !== undefined && descriptor.lineageDigest !== key.lineageDigest)
    return failure('data.result-lineage', 'Result lineage does not match the accepted plan.');
  return validateLineageEdges(descriptor, key);
}

export async function validateResultDescriptor(
  descriptor: Result,
  key: ResultCacheKey,
  populationDigest: string | undefined,
): Promise<Outcome<void>> {
  const pins = validateDescriptorPins(descriptor, key, populationDigest);
  if (!pins.ok) return pins;
  const schema = validateDescriptorSchema(descriptor);
  if (!schema.ok) return schema;
  const counts = validateDescriptorCounts(descriptor, key);
  if (!counts.ok) return counts;
  const coverage = validateDescriptorCoverage(descriptor);
  if (!coverage.ok) return coverage;
  const consistency = validateDescriptorConsistency(descriptor, key);
  if (!consistency.ok) return consistency;
  const evidence = validateDescriptorEvidence(descriptor, key);
  if (!evidence.ok) return evidence;
  return validateDescriptorLineage(descriptor, key);
}

function validateKnownRowFields(
  row: Record<string, unknown>,
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<void> {
  for (const key of Object.keys(row)) {
    if (!fields.has(key)) return failure('data.result-schema', `The result batch contains an unknown field ${key}.`);
  }
  return { ok: true, value: undefined };
}

function validateCell(value: unknown, field: Result['fields'][number]): Outcome<ResultCell | undefined> {
  if (value === undefined) {
    if (!field.type.nullable)
      return failure('data.result-schema', `The result batch is missing non-nullable field ${field.id}.`);
    return { ok: true, value: undefined };
  }
  const checked = validateScalar(value, field.type);
  if (!checked.ok)
    return failure('data.result-value', `The result value for ${field.id} does not match its declared semantic type.`);
  return { ok: true, value: checked.value };
}

function normalizeRowCells(
  row: Record<string, unknown>,
  descriptor: Result,
  normalized: Record<string, ResultCell>,
): Outcome<void> {
  for (const field of descriptor.fields) {
    const checked = validateCell(row[field.id], field);
    if (!checked.ok) return checked;
    if (checked.value !== undefined) normalized[field.id] = checked.value;
  }
  return { ok: true, value: undefined };
}

function attachIdentityKeys(
  normalized: Record<string, ResultCell>,
  identities: readonly string[],
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<void> {
  for (const identity of identities) {
    const field = fields.get(identity)!;
    const value = normalized[identity];
    if (value === undefined) return failure('data.result-identity', 'Result identity fields must be present.');
    const key = scalarIdentity(value, field.type);
    if (!key.ok) return failure('data.result-identity', 'Result identity value is invalid.');
    // The caller checks duplicate tuples after all fields have been visited.
    normalized[`\u0000identity:${identity}`] = key.value;
  }
  return { ok: true, value: undefined };
}

export function validateResultRow(
  row: Record<string, unknown>,
  descriptor: Result,
): Outcome<Record<string, ResultCell>> {
  const fields = new Map(descriptor.fields.map((field) => [field.id, field] as const));
  const knownFields = validateKnownRowFields(row, fields);
  if (!knownFields.ok) return knownFields;
  const normalized: Record<string, ResultCell> = {};
  const cells = normalizeRowCells(row, descriptor, normalized);
  if (!cells.ok) return cells;
  const identities = attachIdentityKeys(normalized, descriptor.identity, fields);
  if (!identities.ok) return identities;
  return { ok: true, value: normalized };
}

export function validateBatchHeader(
  event: ResultBatch,
  descriptor: Result,
  nextSequence: number,
  loadedRows: number,
): Outcome<void> {
  if (!sameRef(descriptor.ref, event.result))
    return failure('data.result-lineage', 'The result batch belongs to another result handle.');
  if (event.sequence !== nextSequence)
    return failure('data.result-sequence', 'Result batch sequences must be consecutive and start at zero.');
  if (loadedRows + event.rows.length > descriptor.counts.loaded)
    return failure('data.result-count', 'Result batches contain more rows than the descriptor loaded count.');
  return { ok: true, value: undefined };
}

export function validateResultProgress(
  event: Extract<ResultEvent, { readonly kind: 'progress' }>,
  descriptor: Result,
  prior: number,
): Outcome<void> {
  if (event.completed < prior || (event.total !== undefined && event.completed > event.total))
    return failure('data.result-progress', 'Result progress is not monotonic.');
  if (event.unit === 'rows' && event.completed > descriptor.counts.loaded)
    return failure('data.result-count', 'Result row progress exceeds the descriptor loaded count.');
  const population = descriptor.counts.population;
  if (
    event.unit === 'rows' &&
    event.total !== undefined &&
    population.kind !== 'unknown' &&
    typeof population.value === 'number' &&
    event.total > population.value
  )
    return failure('data.result-count', 'Result row progress exceeds the declared population count.');
  return { ok: true, value: undefined };
}

function validateCompletionIdentity(
  event: Extract<ResultEvent, { readonly kind: 'complete' }>,
  descriptor: Result,
  loadedRows: number,
): Outcome<void> {
  if (!sameRef(descriptor.ref, event.result))
    return failure('data.result-lineage', 'The result completion belongs to another result handle.');
  if (loadedRows !== descriptor.counts.loaded)
    return failure('data.result-count', 'Result completion does not match the descriptor loaded count.');
  return { ok: true, value: undefined };
}

function validateCoverageTransition(initial: Result['coverage'], final: Result['coverage']): Outcome<void> {
  if (initial.kind !== 'unknown' && final.kind !== 'unknown' && initial.populationDigest !== final.populationDigest)
    return failure('data.result-population', 'Completion cannot change the descriptor population.');
  if (initial.kind !== 'unknown' && initial.kind !== 'complete' && final.kind === 'complete')
    return failure(
      'data.result-coverage',
      'A partial or sampled result cannot be promoted to complete by its terminal event.',
    );
  return { ok: true, value: undefined };
}

function validateAcceptedPopulation(final: Result['coverage'], populationDigest: string | undefined): Outcome<void> {
  if (populationDigest !== undefined && (final.kind === 'unknown' || final.populationDigest !== populationDigest))
    return failure('data.result-population', 'The result completion does not match the accepted population.');
  return { ok: true, value: undefined };
}

function validateCountPopulation(final: Result['coverage'], count: Result['counts']['population']): Outcome<void> {
  if (final.kind !== 'unknown' && count.kind !== 'unknown' && count.populationDigest !== final.populationDigest)
    return failure('data.result-population', 'The result completion population differs from its count population.');
  return { ok: true, value: undefined };
}

function validateCompleteCount(
  descriptor: Result,
  key: ResultCacheKey,
  final: Result['coverage'],
  count: Result['counts']['population'],
  loadedRows: number,
): Outcome<void> {
  if (
    final.kind === 'complete' &&
    count.kind === 'exact' &&
    count.value !== loadedRows &&
    !isProvenGlobalAggregate(descriptor, key, loadedRows)
  )
    return failure('data.result-count', 'Complete coverage must contain the exact population row count.');
  return { ok: true, value: undefined };
}

function hasGlobalAggregateShape(descriptor: Result, key: ResultCacheKey, loadedRows: number): boolean {
  return !(
    loadedRows !== 1 ||
    descriptor.coverage.kind !== 'complete' ||
    descriptor.identity.length !== 0 ||
    descriptor.rowGrain.length !== 0 ||
    key.resultShape !== 'global-aggregate' ||
    key.planDigest === undefined ||
    key.lineageDigest === undefined ||
    key.sourceLineage === undefined ||
    descriptor.ref.sourceLineage !== key.sourceLineage ||
    descriptor.fields.length === 0
  );
}

function hasGlobalAggregateEvidence(descriptor: Result, key: ResultCacheKey): boolean {
  if (
    descriptor.lineageDigest !== key.lineageDigest ||
    descriptor.evidence.kind !== 'computed' ||
    descriptor.evidence.queryDigest !== key.queryDigest
  )
    return false;
  const definitions = new Set(
    descriptor.evidence.definitions.map((definition) => `${definition.id}\u0000${definition.revision}`),
  );
  if (definitions.size !== descriptor.evidence.definitions.length || definitions.size !== descriptor.fields.length)
    return false;
  return descriptor.fields.every(
    (field) =>
      field.role === 'measure' &&
      field.derivation !== undefined &&
      definitions.has(`${field.derivation.id}\u0000${field.derivation.revision}`),
  );
}

function isProvenGlobalAggregate(descriptor: Result, key: ResultCacheKey, loadedRows: number): boolean {
  return hasGlobalAggregateShape(descriptor, key, loadedRows) && hasGlobalAggregateEvidence(descriptor, key);
}

export function validateResultCompletion(
  event: Extract<ResultEvent, { readonly kind: 'complete' }>,
  descriptor: Result,
  key: ResultCacheKey,
  populationDigest: string | undefined,
  loadedRows: number,
): Outcome<void> {
  const identity = validateCompletionIdentity(event, descriptor, loadedRows);
  if (!identity.ok) return identity;
  const transition = validateCoverageTransition(descriptor.coverage, event.finalCoverage);
  if (!transition.ok) return transition;
  const accepted = validateAcceptedPopulation(event.finalCoverage, populationDigest);
  if (!accepted.ok) return accepted;
  const population = validateCountPopulation(event.finalCoverage, descriptor.counts.population);
  if (!population.ok) return population;
  return validateCompleteCount(descriptor, key, event.finalCoverage, descriptor.counts.population, loadedRows);
}
