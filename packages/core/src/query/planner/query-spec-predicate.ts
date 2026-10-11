import type { Catalog, QuerySpec } from '../../contracts/types.js';
import type { PredicateSpec, QueryOutcome } from '../types.js';
import { failure, fieldKey, semanticType } from './shared.js';
import { fieldExpression, literalExpression } from './expressions.js';

function queryEntity(catalog: Catalog, entityId: string) {
  return catalog.entities.find((candidate) => candidate.id === entityId);
}

function convertPredicateGroup(
  input: Extract<NonNullable<QuerySpec['where']>, { op: 'and' | 'or' }>,
  defaultEntity: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec> {
  const predicates: PredicateSpec[] = [];
  for (const child of input.predicates) {
    const converted = convertQueryPredicate(child, defaultEntity, catalog);
    if (!converted.ok) return converted;
    predicates.push(converted.value);
  }
  return { ok: true, value: { op: input.op, predicates } };
}

function convertNegation(
  input: Extract<NonNullable<QuerySpec['where']>, { op: 'not' }>,
  defaultEntity: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec> {
  const converted = convertQueryPredicate(input.predicate, defaultEntity, catalog);
  if (!converted.ok) return converted;
  return { ok: true, value: { op: 'not', predicate: converted.value } };
}

function selectedField(
  input: Exclude<NonNullable<QuerySpec['where']>, { op: 'and' | 'or' | 'not' }>,
  defaultEntity: string,
  catalog: Catalog,
): QueryOutcome<{
  readonly entity: string;
  readonly definition: Catalog['entities'][number];
  readonly field: Catalog['entities'][number]['fields'][number];
}> {
  const selectedEntity = input.entity ?? defaultEntity;
  const definition = queryEntity(catalog, selectedEntity);
  if (definition === undefined)
    return failure('query.entity', `Entity ${selectedEntity} is not declared.`, ['where', 'entity']);
  const field = definition.fields.find((candidate) => candidate.id === input.field);
  if (field === undefined)
    return failure('query.field', `Field ${input.field} is not declared on ${selectedEntity}.`, ['where', 'field']);
  return { ok: true as const, value: { entity: selectedEntity, definition, field } };
}

function convertLeafPredicate(
  input: Exclude<NonNullable<QuerySpec['where']>, { op: 'and' | 'or' | 'not' }>,
  defaultEntity: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec> {
  const selected = selectedField(input, defaultEntity, catalog);
  if (!selected.ok) return selected;
  const { entity: selectedEntity, definition, field } = selected.value;
  const left = fieldExpression(selectedEntity, input.field);
  if (input.op === 'is-null') return { ok: true, value: { op: 'is-null', expression: left, negate: input.negate } };
  const type = semanticType(
    field.type,
    definition.rowGrain.map((grain) => fieldKey(selectedEntity, grain)),
  );
  switch (input.op) {
    case 'compare':
      return {
        ok: true,
        value: {
          op: 'compare',
          left,
          comparison: input.comparison,
          right: literalExpression(input.value, { ...type, nullable: input.value === null }),
        },
      };
    case 'in':
      return {
        ok: true,
        value: {
          op: 'in',
          expression: left,
          values: input.values.map((value) => literalExpression(value, { ...type, nullable: value === null })),
        },
      };
  }
}

function convertQueryPredicate(
  input: QuerySpec['where'],
  defaultEntity: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec> {
  if (input === undefined) return failure('query.predicate', 'Predicate is missing.');
  switch (input.op) {
    case 'and':
    case 'or':
      return convertPredicateGroup(input, defaultEntity, catalog);
    case 'not':
      return convertNegation(input, defaultEntity, catalog);
    default:
      return convertLeafPredicate(input, defaultEntity, catalog);
  }
}

export function querySpecPredicate(
  predicate: QuerySpec['where'],
  entityId: string,
  catalog: Catalog,
): QueryOutcome<PredicateSpec | undefined> {
  if (predicate === undefined) return { ok: true, value: undefined };
  if (queryEntity(catalog, entityId) === undefined)
    return failure('query.entity', `Entity ${entityId} is not declared.`);
  return convertQueryPredicate(predicate, entityId, catalog);
}
