import type { Catalog, Expression, MeaningDefinition, QuerySpec, VersionRef } from '../../contracts/types.js';
import type { AggregateSpec, GroupKeySpec, ProjectionSpec, QueryOutcome, WindowSpec } from '../types.js';
import { failure, relationKey, unsupported } from './shared.js';
import { fieldExpression } from './expressions.js';
import type { LoweredSelection } from './lowering-types.js';

function meaningByRef(
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  ref: VersionRef,
): MeaningDefinition | undefined {
  const key = relationKey(ref);
  return [...catalog.meanings, ...definitions].find((meaning) => relationKey(meaning) === key);
}

function aggregateFromMeaning(meaning: MeaningDefinition, query: QuerySpec): QueryOutcome<AggregateSpec> {
  if (meaning.implementation.kind === 'host-capability')
    return unsupported('host-capability', `Host: ${meaning.id}@${meaning.revision}.`, ['Use executor.']);
  const expression = meaning.implementation.expression;
  if (expression.kind !== 'call')
    return unsupported('meaning-aggregate', `Not aggregate: ${meaning.id}@${meaning.revision}.`, ['Use aggregate.']);
  if (meaning.aggregation === 'semi-additive' && query.timeBucket === undefined)
    return unsupported('semi-additive-time', `Bucket: ${meaning.id}@${meaning.revision}.`);
  const value: AggregateSpec = {
    id: meaning.id,
    label: meaning.label,
    function: expression.function,
    arguments: expression.arguments,
    semantics: {
      meaning: { id: meaning.id, revision: meaning.revision },
      aggregation: meaning.aggregation,
      aggregationDimensions: meaning.aggregationDimensions,
      missingPolicy: meaning.missingPolicy,
      output: meaning.output,
      ...(meaning.aggregation === 'semi-additive'
        ? { timeExpression: { kind: 'field' as const, ref: query.timeBucket!.field } }
        : {}),
    },
  };
  return { ok: true, value };
}

export function bucketFieldExpression(
  field: string,
  query: QuerySpec,
  bucketId: string | undefined,
): Expression | undefined {
  if (bucketId === undefined || query.timeBucket?.field !== field) return undefined;
  if ((query.groupBy ?? []).includes(field)) return { kind: 'field', ref: field };
  return { kind: 'field', ref: bucketId };
}

function projectedFieldExpression(
  field: string,
  query: QuerySpec,
  bucketId: string | undefined,
  measures: ReadonlySet<string>,
  windows: ReadonlySet<string>,
): Expression {
  const bucketExpression = bucketFieldExpression(field, query, bucketId);
  if (bucketExpression !== undefined) return bucketExpression;
  if (measures.has(field) || windows.has(field)) return { kind: 'field', ref: field };
  return fieldExpression(query.entity, field);
}

function groupFieldExpression(field: string, query: QuerySpec, bucketId: string | undefined): Expression {
  if (bucketId !== undefined && query.timeBucket?.field === field) return { kind: 'field', ref: bucketId };
  return fieldExpression(query.entity, field);
}

function rewriteWindowExpression(expression: Expression, query: QuerySpec, bucketId: string | undefined): Expression {
  if (expression.kind === 'field') {
    const refersToBucketSource =
      bucketId !== undefined &&
      query.timeBucket !== undefined &&
      expression.ref === query.timeBucket.field &&
      (expression.entity === undefined || expression.entity === query.entity);
    if (refersToBucketSource) return { kind: 'field', ref: bucketId };
    return expression;
  }
  if (expression.kind !== 'call') return expression;
  const arguments_ = expression.arguments.map((argument) => rewriteWindowExpression(argument, query, bucketId));
  return { kind: 'call', function: expression.function, arguments: arguments_ };
}

function addSelectedField(
  field: string,
  selected: Set<string>,
  select: ProjectionSpec[],
  query: QuerySpec,
  bucketId: string | undefined,
  measures: ReadonlySet<string>,
  windows: ReadonlySet<string>,
): void {
  if (selected.has(field)) return;
  selected.add(field);
  select.push({
    id: field,
    expression: projectedFieldExpression(field, query, bucketId, measures, windows),
  });
}

function lowerAggregates(
  query: QuerySpec,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
): QueryOutcome<AggregateSpec[]> {
  const items: AggregateSpec[] = [];
  for (let index = 0; index < query.measures.length; index += 1) {
    const reference = query.measures[index]!;
    const meaning = meaningByRef(catalog, definitions, reference);
    if (meaning === undefined)
      return failure('query.meaning', `Meaning ${reference.id}@${reference.revision} is not authorized or declared.`, [
        'measures',
        index,
      ]);
    const aggregate = aggregateFromMeaning(meaning, query);
    if (!aggregate.ok) return aggregate;
    items.push(aggregate.value);
  }
  return { ok: true, value: items };
}

function validateGroupedFields(query: QuerySpec, groupBy: readonly GroupKeySpec[]): QueryOutcome<void> {
  if (groupBy.length === 0) return { ok: true, value: undefined };
  for (const field of query.fields) {
    if (groupBy.some((group) => group.id === field)) continue;
    return failure('query.group-grain', `Projected field ${field} is not part of the requested grouping grain.`, [
      'fields',
    ]);
  }
  return { ok: true, value: undefined };
}

export function buildSelection(
  query: QuerySpec,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
  bucketId: string | undefined,
): QueryOutcome<LoweredSelection> {
  const measureIds = new Set(query.measures.map((measure) => measure.id));
  const windowIds = new Set((query.windows ?? []).map((window) => window.id));
  const select: ProjectionSpec[] = [];
  const selected = new Set<string>();
  for (const field of query.fields) {
    addSelectedField(field, selected, select, query, bucketId, measureIds, windowIds);
  }
  const groupFields = query.groupBy ?? [];
  const groupBy = groupFields.map((field) => ({
    id: field,
    expression: groupFieldExpression(field, query, bucketId),
  }));
  for (const field of groupFields) {
    addSelectedField(field, selected, select, query, bucketId, measureIds, windowIds);
  }
  const aggregates = lowerAggregates(query, catalog, definitions);
  if (!aggregates.ok) return aggregates;
  for (const aggregate of aggregates.value) {
    if (select.some((item) => item.id === aggregate.id)) continue;
    select.push({ id: aggregate.id, expression: { kind: 'field', ref: aggregate.id } });
  }
  const grouped = validateGroupedFields(query, groupBy);
  if (!grouped.ok) return grouped;
  return { ok: true, value: { select, groupBy, aggregates: aggregates.value } };
}

export function lowerWindows(query: QuerySpec, bucketId: string | undefined): readonly WindowSpec[] {
  return (query.windows ?? []).map((window) => ({
    id: window.id,
    function: window.function,
    arguments: window.arguments.map((expression) => rewriteWindowExpression(expression, query, bucketId)),
    partitionBy: window.partitionBy.map((expression) => rewriteWindowExpression(expression, query, bucketId)),
    orderBy: window.orderBy.map((entry) => ({
      ...entry,
      expression: rewriteWindowExpression(entry.expression, query, bucketId),
    })),
    frame: { preceding: window.frame.preceding, following: window.frame.following },
  }));
}
