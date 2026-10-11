import type { Catalog, MeaningDefinition, QuerySpec } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { PredicateSpec, QueryOutcome, RelationalQuery } from '../types.js';
import { failure } from './shared.js';
import { querySpecPredicate } from './query-spec-predicate.js';
import type { CatalogEntity } from './shared.js';
import {
  buildSearchPredicate,
  buildTimeBuckets,
  combineFilters,
  entityDefinition,
  lowerOrderBy,
  lowerRelations,
  periodPredicate,
  validatePopulation,
  validateQueryDelivery,
} from './lowering-helpers.js';
import { buildSelection, lowerWindows } from './selection-lowering.js';
import type { LoweredRelations, LoweredSelection, LoweredTimeBuckets } from './lowering-types.js';

interface QueryRoot {
  readonly relations: LoweredRelations;
  readonly where: PredicateSpec | undefined;
  readonly entity: CatalogEntity;
}

interface QuerySelection {
  readonly search: PredicateSpec | undefined;
  readonly buckets: LoweredTimeBuckets;
  readonly selection: LoweredSelection;
}

interface PreparedLowering {
  readonly root: QueryRoot;
  readonly selection: QuerySelection;
  readonly filter: PredicateSpec | undefined;
}

function currentFilter(query: QuerySpec, catalog: Catalog): QueryOutcome<PredicateSpec | undefined> {
  return querySpecPredicate(query.where, query.entity, catalog);
}

function prepareRoot(query: QuerySpec, catalog: Catalog): QueryOutcome<QueryRoot> {
  const relations = lowerRelations(query, catalog);
  if (!relations.ok) return relations;
  const population = validatePopulation(query);
  if (!population.ok) return population;
  const where = currentFilter(query, catalog);
  if (!where.ok) return where;
  const entity = entityDefinition(catalog, query.entity);
  if (entity === undefined) return failure('query.entity', `Entity ${query.entity} is not declared.`, ['entity']);
  return { ok: true, value: { relations: relations.value, where: where.value, entity } };
}

function prepareSelection(
  query: QuerySpec,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  entity: CatalogEntity,
): QueryOutcome<QuerySelection> {
  const search = buildSearchPredicate(query, entity);
  if (!search.ok) return search;
  const buckets = buildTimeBuckets(query, entity);
  if (!buckets.ok) return buckets;
  const selection = buildSelection(query, catalog, definitions, buckets.value.bucketId);
  if (!selection.ok) return selection;
  return {
    ok: true,
    value: { search: search.value, buckets: buckets.value, selection: selection.value },
  };
}

function prepareFilter(
  query: QuerySpec,
  entity: CatalogEntity,
  where: PredicateSpec | undefined,
  search: PredicateSpec | undefined,
): QueryOutcome<PredicateSpec | undefined> {
  const initial = combineFilters(where, search);
  const period = periodPredicate(query, entity);
  if (!period.ok) return period;
  return { ok: true, value: combineFilters(initial, period.value) };
}

function prepareLowering(
  query: QuerySpec,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
): QueryOutcome<PreparedLowering> {
  const root = prepareRoot(query, catalog);
  if (!root.ok) return root;
  const selection = prepareSelection(query, catalog, definitions, root.value.entity);
  if (!selection.ok) return selection;
  const filter = prepareFilter(query, root.value.entity, root.value.where, selection.value.search);
  if (!filter.ok) return filter;
  return { ok: true, value: { root: root.value, selection: selection.value, filter: filter.value } };
}

function relationalQuery(
  query: QuerySpec,
  catalog: Catalog,
  registry: FunctionRegistry,
  prepared: PreparedLowering,
): RelationalQuery {
  const { root, selection, filter } = prepared;
  const windows = lowerWindows(query, selection.buckets.bucketId);
  const orderBy = lowerOrderBy(query, selection.buckets.bucketId);
  return {
    root: query.entity,
    select: selection.selection.select,
    ...(filter === undefined ? {} : { filter }),
    ...(root.relations.joins.length === 0 ? {} : { joins: root.relations.joins }),
    ...(root.relations.semiJoins.length === 0 ? {} : { semiJoins: root.relations.semiJoins }),
    ...(selection.buckets.items.length === 0 ? {} : { timeBuckets: selection.buckets.items }),
    ...(windows.length === 0 ? {} : { windows }),
    ...(selection.selection.groupBy.length === 0 ? {} : { groupBy: selection.selection.groupBy }),
    ...(selection.selection.aggregates.length === 0 ? {} : { aggregates: selection.selection.aggregates }),
    ...(orderBy.length === 0 ? {} : { orderBy }),
    ...(query.topK === undefined ? {} : { topK: query.topK }),
    pins: { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest },
  };
}

export function lowerQuerySpec(
  query: QuerySpec,
  catalog: Catalog,
  registry: FunctionRegistry,
  definitions: readonly MeaningDefinition[],
): QueryOutcome<RelationalQuery> {
  const prepared = prepareLowering(query, catalog, definitions);
  if (!prepared.ok) return prepared;
  const delivery = validateQueryDelivery(query);
  if (!delivery.ok) return delivery;
  return { ok: true, value: relationalQuery(query, catalog, registry, prepared.value) };
}
