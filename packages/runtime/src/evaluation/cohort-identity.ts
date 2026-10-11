import { scalarIdentity, WIRE_LIMITS } from '@varendo/core';
import type { Catalog, Outcome, QuerySpec, Result, ResultRef, SemanticType } from '@varendo/core';
import { canonicalJson } from '../canonical.js';
import type { DataValue } from '../data/types.js';
import type { CohortMembership } from './types.js';

export { canonicalJson as canonical };

function failure<T = never>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

export function safeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function sameRef(left: ResultRef, right: ResultRef): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.sourceLineage === right.sourceLineage &&
    left.outputId === right.outputId &&
    left.queryDigest === right.queryDigest &&
    left.scopeDigest === right.scopeDigest
  );
}

function sameType(left: SemanticType, right: SemanticType): boolean {
  if (
    left.value !== right.value ||
    left.nullable !== right.nullable ||
    canonicalJson(left.unit) !== canonicalJson(right.unit) ||
    canonicalJson(left.temporal) !== canonicalJson(right.temporal)
  )
    return false;
  if (left.grain === undefined || right.grain === undefined) return true;
  return canonicalJson(normalizeGrain(left.grain)) === canonicalJson(normalizeGrain(right.grain));
}

function normalizeGrain(grain: readonly string[]): readonly string[] {
  return [...grain].sort().map(fieldSuffix);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDate(value: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (matched === null) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function validInstant(value: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (matched === null || !validDate(`${matched[1]}-${matched[2]}-${matched[3]}`)) return false;
  if (Number(matched[4]) > 23 || Number(matched[5]) > 59 || Number(matched[6]) > 59) return false;
  return matched[8] === 'Z' || (Number(matched[9]) <= 23 && Number(matched[10]) <= 59);
}

function isDecimalValue(value: DataValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.decimal === 'string' &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value.decimal)
  );
}

function dateValue(value: DataValue): boolean {
  return typeof value === 'string' && validDate(value);
}

function instantValue(value: DataValue): boolean {
  return typeof value === 'string' && validInstant(value);
}

function integerValue(value: DataValue): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function floatValue(value: DataValue): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function validValue(value: DataValue, type: SemanticType): boolean {
  if (value === null) return type.nullable;
  switch (type.value) {
    case 'text':
      return typeof value === 'string';
    case 'date':
      return dateValue(value);
    case 'instant':
      return instantValue(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return integerValue(value);
    case 'float':
      return floatValue(value);
    case 'decimal':
      return isDecimalValue(value);
    default:
      return false;
  }
}

export function tupleKey(tuple: readonly DataValue[], types: readonly SemanticType[]): Outcome<string> {
  if (tuple.length !== types.length)
    return failure('runtime.evaluation-grain', 'Cohort identity tuple arity does not match its declared types.');
  const identities: string[] = [];
  for (let index = 0; index < tuple.length; index++) {
    const identity = scalarIdentity(tuple[index], types[index]!);
    if (!identity.ok)
      return failure('runtime.evaluation-grain', 'Cohort identity value does not match its declared scalar type.');
    identities.push(identity.value);
  }
  return { ok: true, value: canonicalJson(identities) };
}

function fieldSuffix(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === 'string') return parsed[1];
  } catch {
    /* Opaque field identifiers remain exact. */
  }
  return value;
}

function entityFor(catalog: Catalog, id: string): Catalog['entities'][number] | undefined {
  return catalog.entities.find((entity) => entity.id === id);
}

function fieldFor(
  entity: Catalog['entities'][number],
  requested: string,
): Catalog['entities'][number]['fields'][number] | undefined {
  const exact = entity.fields.find((field) => field.id === requested);
  if (exact !== undefined) return exact;
  const suffix = fieldSuffix(requested);
  const matches = entity.fields.filter((field) => field.id === suffix || fieldSuffix(field.id) === suffix);
  return matches.length === 1 ? matches[0] : undefined;
}

function sameTargetType(left: SemanticType, right: SemanticType): boolean {
  return sameType(left, right);
}

function cohortPredicate(
  entity: string,
  keys: readonly string[],
  tuples: readonly (readonly DataValue[])[],
): NonNullable<QuerySpec['where']> {
  const compare = (tuple: readonly DataValue[]): NonNullable<QuerySpec['where']> => {
    const predicates = keys.map((field, index) => ({
      op: 'compare' as const,
      field,
      entity,
      comparison: 'eq' as const,
      value: tuple[index] as DataValue,
    }));
    return predicates.length === 1 ? predicates[0]! : { op: 'and' as const, predicates };
  };
  if (tuples.length === 0) return { op: 'in', field: keys[0]!, entity, values: [] };
  if (keys.length === 1) return { op: 'in', field: keys[0]!, entity, values: tuples.map((tuple) => tuple[0]!) };
  const predicates = tuples.map(compare);
  return predicates.length === 1 ? predicates[0]! : { op: 'or' as const, predicates };
}

function findField(result: Result, key: string): Result['fields'][number] | undefined {
  const exact = result.fields.find((field) => field.id === key);
  if (exact !== undefined) return exact;
  const suffix = fieldSuffix(key);
  const matches = result.fields.filter((field) => field.id === suffix || fieldSuffix(field.id) === suffix);
  return matches.length === 1 ? matches[0] : undefined;
}

export function grainHas(grain: readonly string[], fieldId: string, requested: string): boolean {
  return (
    grain.includes(fieldId) ||
    grain.includes(requested) ||
    grain.some((candidate) => fieldSuffix(candidate) === fieldSuffix(fieldId))
  );
}

export function catalogField(
  catalog: Catalog,
  requested: string,
): { readonly entity: string; readonly field: Catalog['entities'][number]['fields'][number] } | undefined {
  const suffix = fieldSuffix(requested);
  const matches: { readonly entity: string; readonly field: Catalog['entities'][number]['fields'][number] }[] = [];
  for (const entity of catalog.entities) {
    for (const field of entity.fields) {
      if (field.id === requested || field.id === suffix) matches.push({ entity: entity.id, field });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function lowerCohortQuery(query: QuerySpec, membership: CohortMembership, catalog: Catalog): Outcome<QuerySpec> {
  const entity = entityFor(catalog, query.entity);
  if (entity === undefined)
    return failure('runtime.evaluation-grain', 'The task query entity is absent from the trusted catalog.', ['entity']);
  if (query.page?.cursor !== undefined)
    return failure(
      'runtime.evaluation-unsupported',
      'Paged cohort follow-ups require a cursor bound to the original cohort query.',
      ['page', 'cursor'],
    );
  if (membership.identityKeys.length === 0)
    return failure('runtime.evaluation-invalid', 'A cohort requires at least one target identity field.');
  const targetFields: string[] = [];
  for (let index = 0; index < membership.identityKeys.length; index++) {
    const requested = membership.identityKeys[index]!;
    const target = fieldFor(entity, requested);
    if (target === undefined)
      return failure(
        'runtime.evaluation-grain',
        'The cohort identity field is not present or is ambiguous in the target query entity.',
        ['population', 'identityKeys', index],
      );
    if (!sameTargetType(target.type, membership.types[index]!))
      return failure(
        'runtime.evaluation-grain',
        'The cohort identity field type does not match the target catalog field.',
        ['population', 'identityKeys', index],
      );
    targetFields.push(target.id);
  }
  const predicate = cohortPredicate(query.entity, targetFields, membership.tuples);
  const where: NonNullable<QuerySpec['where']> =
    query.where === undefined ? predicate : { op: 'and' as const, predicates: [predicate, query.where] };
  return { ok: true, value: { ...query, population: { kind: 'all-authorized' as const }, where } };
}

export { findField, validValue, sameType };
