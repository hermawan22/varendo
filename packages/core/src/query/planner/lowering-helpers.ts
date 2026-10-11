import type { Catalog, Expression, QuerySpec, VersionRef } from '../../contracts/types.js';
import type { JoinSpec, PredicateSpec, QueryOutcome, SemiJoinSpec, SortSpec, TimeBucketSpec } from '../types.js';
import {
  BUCKET_GRAINS,
  failure,
  fieldKey,
  relationKey,
  semanticType,
  unsupported,
  type CatalogEntity,
} from './shared.js';
import { fieldExpression, literalExpression } from './expressions.js';
import { querySpecPredicate } from './query-spec-predicate.js';
import { relationshipFor } from './relations.js';
import { bucketFieldExpression } from './selection-lowering.js';
import type { LoweredRelations, LoweredTimeBuckets } from './lowering-types.js';

export function entityDefinition(catalog: Catalog, entityId: string): CatalogEntity | undefined {
  return catalog.entities.find((candidate) => candidate.id === entityId);
}

function relationUsage(query: QuerySpec): readonly NonNullable<QuerySpec['relationUsage']>[number][] | undefined {
  return query.relationUsage;
}

function lowerRelationWhere(
  where: QuerySpec['where'],
  entity: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec | undefined> {
  return querySpecPredicate(where, entity, catalog);
}

function appendRelationUsage(
  reference: VersionRef,
  usage: NonNullable<QuerySpec['relationUsage']>[number],
  index: number,
  catalog: Catalog,
  joins: JoinSpec[],
  semiJoins: SemiJoinSpec[],
  seen: Set<string>,
): QueryOutcome<void> {
  const referenceKey = relationKey(reference);
  if (seen.has(referenceKey))
    return failure('query.relation-usage', 'Relation usage references must match each relation exactly once.', [
      'relationUsage',
      index,
    ]);
  seen.add(referenceKey);
  const declared = relationshipFor(catalog, reference);
  if (declared === undefined)
    return failure('query.relationship', `Relationship ${referenceKey} is not declared.`, ['relations', index]);
  const where = lowerRelationWhere(usage.where, declared.targetEntity, catalog);
  if (!where.ok) return where;
  if (usage.kind === 'semi') {
    semiJoins.push({
      id: declared.id,
      rightEntity: declared.targetEntity,
      relationship: reference,
      ...(where.value === undefined ? {} : { where: where.value }),
    });
  } else {
    joins.push({
      id: declared.id,
      rightEntity: declared.targetEntity,
      relationship: reference,
      kind: usage.kind,
      ...(where.value === undefined ? {} : { where: where.value }),
    });
  }
  return { ok: true, value: undefined };
}

export function lowerRelations(query: QuerySpec, catalog: Catalog): QueryOutcome<LoweredRelations> {
  const usage = relationUsage(query);
  if (query.relations.length > 0 && (usage === undefined || usage.length !== query.relations.length))
    return unsupported(
      'query.relation-usage',
      'Every relation reference must declare explicit inner, left or semijoin semantics.',
      ['Provide one relationUsage entry for each relation.'],
      ['relations'],
    );
  if (query.relations.length === 0 && usage !== undefined && usage.length > 0)
    return failure(
      'query.relation-usage',
      'Relation usage cannot introduce a relation absent from the relation references.',
      ['relationUsage'],
    );
  const joins: JoinSpec[] = [];
  const semiJoins: SemiJoinSpec[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < query.relations.length; index += 1) {
    const reference = query.relations[index]!;
    const declaredUsage = usage?.find((candidate) => relationKey(candidate.relation) === relationKey(reference));
    if (declaredUsage === undefined)
      return failure('query.relation-usage', 'Relation usage references must match each relation exactly once.', [
        'relationUsage',
        index,
      ]);
    const result = appendRelationUsage(reference, declaredUsage, index, catalog, joins, semiJoins, seen);
    if (!result.ok) return result;
  }
  return { ok: true, value: { joins, semiJoins } };
}

function searchFieldPredicate(
  entity: CatalogEntity,
  entityId: string,
  fieldId: string,
  searchText: string,
  index: number,
): QueryOutcome<PredicateSpec> {
  const field = entity.fields.find((candidate) => candidate.id === fieldId);
  if (field === undefined)
    return failure('query.field', `Search field ${fieldId} is not declared on ${entityId}.`, [
      'search',
      'fields',
      index,
    ]);
  if (field.type.value !== 'text')
    return failure('query.search-type', `Search field ${fieldId} must be text.`, ['search', 'fields', index]);
  const call: Expression = {
    kind: 'call',
    function: { id: 'core.text.includes-casefold', revision: '1' },
    arguments: [fieldExpression(entityId, fieldId), literalExpression(searchText, { value: 'text', nullable: false })],
  };
  return {
    ok: true,
    value: {
      op: 'compare',
      left: call,
      comparison: 'eq',
      right: literalExpression(true, { value: 'boolean', nullable: false }),
    },
  };
}

export function buildSearchPredicate(query: QuerySpec, entity: CatalogEntity): QueryOutcome<PredicateSpec | undefined> {
  if (query.search === undefined) return { ok: true, value: undefined };
  const fields = new Set(query.search.fields);
  if (fields.size !== query.search.fields.length)
    return failure('query.search-fields', 'Search fields must be unique.', ['search', 'fields']);
  const predicates: PredicateSpec[] = [];
  for (let index = 0; index < query.search.fields.length; index += 1) {
    const result = searchFieldPredicate(entity, query.entity, query.search.fields[index]!, query.search.text, index);
    if (!result.ok) return result;
    predicates.push(result.value);
  }
  if (predicates.length === 1) return { ok: true, value: predicates[0] };
  return { ok: true, value: { op: 'or', predicates } };
}

function bucketTemporalPolicy(
  query: QuerySpec,
): QueryOutcome<{ readonly calendar: string; readonly timezone: string }> {
  const bucket = query.timeBucket!;
  const calendar = bucket.calendar ?? query.period?.calendar;
  const timezone = bucket.timezone ?? query.period?.timezone;
  if (calendar === undefined || timezone === undefined)
    return unsupported(
      'query.time-bucket-policy',
      'Time buckets require an explicit calendar and timezone policy.',
      ['Provide both fields on timeBucket or an instant period policy.'],
      ['timeBucket'],
    );
  if ((bucket.calendar === undefined) !== (bucket.timezone === undefined))
    return failure('query.time-bucket-policy', 'Calendar and timezone must be supplied together.', ['timeBucket']);
  if (query.period !== undefined && (calendar !== query.period.calendar || timezone !== query.period.timezone))
    return failure('query.time-bucket-policy', 'The bucket and period policies disagree.', ['timeBucket']);
  return { ok: true, value: { calendar, timezone } };
}

function makeTimeBucket(
  query: QuerySpec,
  entity: CatalogEntity,
  policy: { readonly calendar: string; readonly timezone: string },
): QueryOutcome<LoweredTimeBuckets> {
  const bucket = query.timeBucket!;
  const temporalField = entity.fields.find((candidate) => candidate.id === bucket.field);
  if (temporalField === undefined)
    return failure('query.field', `Field ${bucket.field} is not declared on ${query.entity}.`, ['timeBucket', 'field']);
  if (temporalField.type.value !== 'instant' && temporalField.type.value !== 'date')
    return failure('query.period-type', 'Time buckets require a date or instant field.', ['timeBucket']);
  if (!BUCKET_GRAINS.has(bucket.grain))
    return unsupported(
      'temporal-grain',
      'The requested temporal grain is not in the bounded evaluator subset.',
      ['Use day, week, month, quarter or year.'],
      ['timeBucket', 'grain'],
    );
  if (policy.calendar !== 'gregorian' && policy.calendar !== 'iso8601')
    return unsupported(
      'temporal-policy',
      'The requested civil calendar is not supported.',
      ['Use an explicit Gregorian or ISO8601 civil calendar.'],
      ['timeBucket'],
    );
  if (bucket.grain === 'week' && bucket.weekStartsOn === undefined)
    return unsupported(
      'temporal-week-start',
      'Weekly buckets require an explicit week start.',
      ['Supply weekStartsOn from the domain policy.'],
      ['timeBucket'],
    );
  const bucketId = `__aeliqo_bucket_${bucket.field}_${bucket.grain}`;
  if (entity.fields.some((field) => field.id === bucketId))
    return failure('query.time-bucket', 'Generated time bucket identifier collides with a source field.', [
      'timeBucket',
      'field',
    ]);
  const item: TimeBucketSpec = {
    id: bucketId,
    expression: fieldExpression(query.entity, bucket.field),
    grain: bucket.grain as TimeBucketSpec['grain'],
    calendar: policy.calendar as TimeBucketSpec['calendar'],
    timezone: policy.timezone,
    ...(bucket.weekStartsOn === undefined ? {} : { weekStartsOn: bucket.weekStartsOn }),
    label: temporalField.label,
  };
  return { ok: true, value: { bucketId, items: [item] } };
}

export function buildTimeBuckets(query: QuerySpec, entity: CatalogEntity): QueryOutcome<LoweredTimeBuckets> {
  if (query.timeBucket === undefined) return { ok: true, value: { items: [] } };
  const policy = bucketTemporalPolicy(query);
  if (!policy.ok) return policy;
  return makeTimeBucket(query, entity, policy.value);
}

function orderExpression(
  field: string,
  query: QuerySpec,
  bucketId: string | undefined,
  measures: ReadonlySet<string>,
): Expression {
  const bucketExpression = bucketFieldExpression(field, query, bucketId);
  if (bucketExpression !== undefined) return bucketExpression;
  if (measures.has(field)) return { kind: 'field', ref: field };
  return fieldExpression(query.entity, field);
}

export function lowerOrderBy(query: QuerySpec, bucketId: string | undefined): readonly SortSpec[] {
  const measureIds = new Set(query.measures.map((measure) => measure.id));
  return query.order.map((entry) => ({
    expression: orderExpression(entry.field, query, bucketId, measureIds),
    direction: entry.direction,
    nulls: entry.nulls,
  }));
}

export function combineFilters(
  current: PredicateSpec | undefined,
  added: PredicateSpec | undefined,
): PredicateSpec | undefined {
  if (current === undefined) return added;
  if (added === undefined) return current;
  return { op: 'and', predicates: [current, added] };
}

export function periodPredicate(query: QuerySpec, entity: CatalogEntity): QueryOutcome<PredicateSpec | undefined> {
  if (query.period === undefined) return { ok: true, value: undefined };
  if (query.timeBucket === undefined)
    return unsupported(
      'query.period-field',
      'A period needs an explicit temporal field or time bucket.',
      ['Provide timeBucket.field with period.'],
      ['period'],
    );
  if (query.period.calendar !== 'gregorian' || query.period.timezone !== 'UTC')
    return unsupported(
      'temporal-policy',
      'Only explicit Gregorian UTC periods are implemented in the pure evaluator.',
      ['Supply a host temporal policy for the requested calendar and timezone.'],
      ['period'],
    );
  const field = entity.fields.find((candidate) => candidate.id === query.timeBucket!.field);
  if (field === undefined)
    return failure('query.field', `Field ${query.timeBucket.field} is not declared on ${query.entity}.`, [
      'timeBucket',
      'field',
    ]);
  if (field.type.value !== 'instant')
    return unsupported(
      'query.period-type',
      'QuerySpec period bounds are instants and require an instant-valued time bucket field.',
      ['Use a typed RelationalQuery date predicate for local dates.'],
      ['period'],
    );
  const type = semanticType(
    field.type,
    entity.rowGrain.map((grain) => fieldKey(query.entity, grain)),
  );
  return {
    ok: true,
    value: {
      op: 'and',
      predicates: [
        {
          op: 'compare',
          left: fieldExpression(query.entity, field.id),
          comparison: 'gte',
          right: literalExpression(query.period.from, { ...type, nullable: false }),
        },
        {
          op: 'compare',
          left: fieldExpression(query.entity, field.id),
          comparison: 'lt',
          right: literalExpression(query.period.toExclusive, { ...type, nullable: false }),
        },
      ],
    },
  };
}

export function validateQueryDelivery(query: QuerySpec): QueryOutcome<void> {
  if (query.page !== undefined)
    return unsupported(
      'query.pagination',
      'Delivery paging requires the data service adapter and does not define the query population.',
      ['Use topK for an explicit ranked population, or execute paging through the data service adapter.'],
      ['page'],
    );
  if (query.topK !== undefined && query.order.length === 0)
    return failure('query.top-k-order', 'A top-K population requires an explicit deterministic ordering.', ['topK']);
  return { ok: true, value: undefined };
}

export function validatePopulation(query: QuerySpec): QueryOutcome<void> {
  if (query.population.kind === 'all-authorized') return { ok: true, value: undefined };
  return unsupported(
    'query.population-lineage',
    'Fixed and live populations require an authorized result lineage input.',
    ['Provide a complete cohort source.'],
    ['population'],
  );
}
