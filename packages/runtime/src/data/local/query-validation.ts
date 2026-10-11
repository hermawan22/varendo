import { createCatalogIndex } from '@varendo/core/semantics';
import type { Catalog, Outcome, QuerySpec } from '@varendo/core';
import type { CatalogEntity } from '@varendo/core/semantics';
import type { ReadGrant } from '../types.js';
import { allowedEntity, allowedField, allowedIdentity, getEntity } from './access.js';
import { failure, unsupported } from './shared.js';

export function normalizedQuery(query: QuerySpec): QuerySpec {
  if (query.page === undefined || query.page.cursor === undefined) return query;
  return { ...query, page: { size: query.page.size } };
}

export function queryWithoutPage(query: QuerySpec): QuerySpec {
  const { page: _page, ...logical } = query;
  return logical as QuerySpec;
}

export function validateQuery(
  query: QuerySpec,
  catalog: Catalog,
  grant: ReadGrant,
  allowFixedCohort = false,
): Outcome<void> {
  const entityOutcome = validateEntityAccess(query.entity, catalog, grant);
  if (!entityOutcome.ok) return entityOutcome;
  const projectionOutcome = validateProjection(query.fields);
  if (!projectionOutcome.ok) return projectionOutcome;
  if (!hasDerivedRows(query)) {
    const lineageOutcome = validateLineageProjection(query, entityOutcome.value);
    if (!lineageOutcome.ok) return lineageOutcome;
  }
  return validatePopulation(query, allowFixedCohort);
}

function validateEntityAccess(entityId: string, catalog: Catalog, grant: ReadGrant): Outcome<CatalogEntity> {
  const indexOutcome = createCatalogIndex(catalog);
  if (!indexOutcome.ok) return indexOutcome;
  if (!allowedEntity(grant, entityId))
    return failure('data.denied', 'The requested data is not available in the current authorization scope.', [
      'query',
      'entity',
    ]);
  const entity = getEntity(catalog, entityId);
  if (entity === undefined)
    return failure('data.invalid-entity', `Entity ${entityId} is not available.`, ['query', 'entity']);
  if (hasHiddenIdentityOrGrain(entity, grant))
    return failure('data.denied', 'The requested data is not available in the current authorization scope.', [
      'query',
      'entity',
    ]);
  return { ok: true, value: entity };
}

function hasHiddenIdentityOrGrain(entity: CatalogEntity, grant: ReadGrant): boolean {
  if (!allowedIdentity(grant, entity)) return true;
  return !entity.rowGrain.every((field) => allowedField(grant, entity.id, field));
}

function validateProjection(fields: readonly string[]): Outcome<void> {
  if (fields.length === 0)
    return failure('data.invalid-projection', 'A query must project at least one field.', ['query', 'fields']);
  if (new Set(fields).size !== fields.length)
    return failure('data.invalid-projection', 'Projection fields must be unique.', ['query', 'fields']);
  return { ok: true, value: undefined };
}

function hasDerivedRows(query: QuerySpec): boolean {
  return (
    query.measures.length > 0 ||
    query.groupBy.length > 0 ||
    query.relations.length > 0 ||
    (query.windows?.length ?? 0) > 0 ||
    query.timeBucket !== undefined
  );
}

function validateLineageProjection(query: QuerySpec, entity: CatalogEntity): Outcome<void> {
  const identity = entity.identity.find((field) => !query.fields.includes(field));
  if (identity !== undefined) return missingIdentity(identity);
  const unprojectedOrder = query.order.findIndex((entry) => !query.fields.includes(entry.field));
  if (unprojectedOrder >= 0) return missingOrderField(unprojectedOrder);
  return { ok: true, value: undefined };
}

function missingIdentity(field: string): Outcome<void> {
  return unsupported(
    {
      kind: 'source',
      id: 'identity-projection',
      reason: `Identity field ${field} must be projected for stable result lineage.`,
      alternatives: ['Include all identity fields in the projection.'],
    },
    ['query', 'fields'],
  );
}

function missingOrderField(index: number): Outcome<void> {
  return unsupported(
    {
      kind: 'operator',
      id: 'order-projection',
      reason: 'Ordering by an unprojected field is outside the bounded projection subset.',
      alternatives: ['Project every order field.'],
    },
    ['query', 'order', index, 'field'],
  );
}

function validatePopulation(query: QuerySpec, allowFixedCohort: boolean): Outcome<void> {
  if (query.population.kind === 'all-authorized') return { ok: true, value: undefined };
  if (query.population.kind === 'fixed' && allowFixedCohort) return { ok: true, value: undefined };
  const reason =
    query.population.kind === 'live-output'
      ? 'Live named-output population binding belongs to the trusted task evaluator.'
      : 'A fixed population requires a host-owned complete cohort resolver.';
  return unsupported(
    {
      kind: 'source',
      id: 'population',
      reason,
      alternatives: ['Use a host source with a stable cohort contract.'],
    },
    ['query', 'population'],
  );
}
