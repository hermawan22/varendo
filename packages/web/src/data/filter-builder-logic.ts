import { validateScalar } from '@varendo/core';
import type { VarendoFieldOption, VarendoFilterPredicate, VarendoFilterValue } from './types.js';
import { dataValueText } from './shared.js';
import type { VarendoFilterClause, VarendoFilterOperator } from './filter-builder-types.js';
import type { PredicateProjection, PredicateTraversal, VarendoFilterLogical } from './filter-builder-internal-types.js';
import { MAX_PREDICATE_DEPTH, MAX_PREDICATE_NODES } from './filter-builder-limits.js';

export function combineVarendoPredicates(
  predicate: VarendoFilterPredicate | undefined,
  inherited: VarendoFilterPredicate | undefined,
): VarendoFilterPredicate | undefined {
  if (predicate === undefined) return inherited;
  if (inherited === undefined) return predicate;
  return { op: 'and', predicates: [inherited, predicate] };
}

export function validateVarendoPredicate(
  predicate: VarendoFilterPredicate | undefined,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (predicate === undefined) return { ok: false, message: 'Choose a field and value before applying the filter.' };
  if (predicate.op === 'and' || predicate.op === 'or') {
    return predicate.predicates.length === 0
      ? { ok: false, message: 'Add at least one filter condition.' }
      : { ok: true };
  }
  if (predicate.op === 'not') return validateVarendoPredicate(predicate.predicate);
  if (predicate.op === 'in' && predicate.values.length === 0)
    return { ok: false, message: 'Provide at least one value.' };
  return { ok: true };
}

function fieldSemanticType(field: VarendoFieldOption | undefined) {
  if (field?.semanticType !== undefined) return field.semanticType;
  if (field?.type === undefined) return undefined;
  return { value: field.type, nullable: field.nullable ?? true } as const;
}

function parseValue(raw: string, field: VarendoFieldOption | undefined): VarendoFilterValue | undefined {
  const semanticType = fieldSemanticType(field);
  if (semanticType === undefined) return undefined;
  const value = semanticType.value === 'text' ? raw : raw.trim();
  if (semanticType.value !== 'text' && value.length === 0) return undefined;
  const candidate = scalarFromText(value, semanticType.value);
  if (candidate === undefined) return undefined;
  const checked = validateScalar(candidate, semanticType);
  return checked.ok ? checked.value : undefined;
}

function scalarFromText(value: string, type: string): unknown {
  switch (type) {
    case 'boolean':
      return booleanFromText(value);
    case 'integer':
      return integerFromText(value);
    case 'float':
      return floatFromText(value);
    case 'decimal':
      return { decimal: value };
    default:
      return value;
  }
}

function booleanFromText(value: string): boolean | undefined {
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return undefined;
}

function integerFromText(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function floatFromText(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type MembershipJsonValue = string | boolean | number | null;

function membershipJsonValue(value: VarendoFilterValue): MembershipJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finiteMembershipNumber(value);
  return decimalMembershipText(value);
}

function finiteMembershipNumber(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function decimalMembershipText(value: VarendoFilterValue): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const checked = validateScalar(value, { value: 'decimal', nullable: false });
  if (!checked.ok) return undefined;
  return decimalScalarText(checked.value);
}

function decimalScalarText(value: VarendoFilterValue): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return typeof value.decimal === 'string' ? value.decimal : undefined;
}

function membershipJsonText(values: readonly VarendoFilterValue[]): string | undefined {
  const serialized = values.map((value) => membershipJsonValue(value));
  if (serialized.some((value) => value === undefined)) return undefined;
  return JSON.stringify(serialized);
}

function predicateEntityMatches(predicate: VarendoFilterPredicate, entity: string): boolean {
  const candidate = (predicate as VarendoFilterPredicate & { readonly entity?: unknown }).entity;
  return candidate === undefined || candidate === entity;
}

function clauseFromPredicate(
  predicate: VarendoFilterPredicate | undefined,
  entity: string,
): VarendoFilterClause | undefined {
  if (predicate === undefined || !predicateEntityMatches(predicate, entity)) return undefined;
  switch (predicate.op) {
    case 'compare':
      return compareClause(predicate);
    case 'is-null':
      return nullClause(predicate);
    case 'in':
      return membershipClause(predicate);
    case 'not':
      return negatedNullClause(predicate, entity);
    default:
      return undefined;
  }
}

function compareClause(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'compare' }>,
): VarendoFilterClause | undefined {
  if (predicate.value === null || predicate.value === undefined) return undefined;
  return { field: predicate.field, operator: predicate.comparison, value: dataValueText(predicate.value, '') };
}

function nullClause(predicate: Extract<VarendoFilterPredicate, { readonly op: 'is-null' }>): VarendoFilterClause {
  return { field: predicate.field, operator: predicate.negate ? 'not-null' : 'is-null' };
}

function membershipClause(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'in' }>,
): VarendoFilterClause | undefined {
  const value = Array.isArray(predicate.values) ? membershipJsonText(predicate.values) : undefined;
  if (value === undefined) return undefined;
  return { field: predicate.field, operator: 'in', value };
}

function negatedNullClause(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'not' }>,
  entity: string,
): VarendoFilterClause | undefined {
  if (predicate.predicate.op !== 'is-null') return undefined;
  if (!predicateEntityMatches(predicate.predicate, entity)) return undefined;
  return {
    field: predicate.predicate.field,
    operator: predicate.predicate.negate ? 'is-null' : 'not-null',
  };
}

function unsupportedProjection(
  predicate: VarendoFilterPredicate,
  logical: VarendoFilterLogical = 'and',
): PredicateProjection {
  return { clauses: [], logical, unsupported: predicate };
}

export function projectPredicate(
  predicate: VarendoFilterPredicate | undefined,
  depth = 0,
  traversal: PredicateTraversal = { nodes: 0 },
  entity = '',
): PredicateProjection {
  try {
    if (predicate === undefined) return { clauses: [], logical: 'and' };
    if (depth > MAX_PREDICATE_DEPTH || traversal.nodes >= MAX_PREDICATE_NODES) return unsupportedProjection(predicate);
    traversal.nodes += 1;
    if (!predicateEntityMatches(predicate, entity)) return unsupportedProjection(predicate);
    const clause = clauseFromPredicate(predicate, entity);
    if (clause !== undefined) return { clauses: [clause], logical: 'and' };
    return logicalProjection(predicate, depth, traversal, entity);
  } catch {
    return predicate === undefined ? { clauses: [], logical: 'and' } : unsupportedProjection(predicate);
  }
}

function logicalProjection(
  predicate: VarendoFilterPredicate,
  depth: number,
  traversal: PredicateTraversal,
  entity: string,
): PredicateProjection {
  if (predicate.op !== 'and' && predicate.op !== 'or') return unsupportedProjection(predicate);
  if (!Array.isArray(predicate.predicates) || predicate.predicates.length === 0)
    return unsupportedProjection(predicate, predicate.op);
  return projectLogicalChildren(predicate, depth, traversal, entity);
}

function projectLogicalChildren(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'and' | 'or' }>,
  depth: number,
  traversal: PredicateTraversal,
  entity: string,
): PredicateProjection {
  const clauses: VarendoFilterClause[] = [];
  for (const child of predicate.predicates) {
    const projection = projectChild(child, predicate.op, depth, traversal, entity);
    if (projection === undefined) return unsupportedProjection(predicate, predicate.op);
    clauses.push(...projection.clauses);
  }
  if (clauses.length === 0) return unsupportedProjection(predicate, predicate.op);
  return { clauses, logical: predicate.op };
}

function projectChild(
  child: VarendoFilterPredicate,
  logical: VarendoFilterLogical,
  depth: number,
  traversal: PredicateTraversal,
  entity: string,
): PredicateProjection | undefined {
  if (traversal.nodes >= MAX_PREDICATE_NODES) return undefined;
  const projection = projectPredicate(child, depth + 1, traversal, entity);
  if (projection.unsupported !== undefined) return undefined;
  if (projection.clauses.length > 1 && projection.logical !== logical) return undefined;
  return projection;
}

export function predicateText(
  predicate: VarendoFilterPredicate,
  depth = 0,
  traversal: PredicateTraversal = { nodes: 0 },
  parentLogical = false,
): string {
  try {
    if (depth > MAX_PREDICATE_DEPTH || traversal.nodes >= MAX_PREDICATE_NODES) return 'Unsupported filter condition';
    traversal.nodes += 1;
    return predicateTextBody(predicate, depth, traversal, parentLogical);
  } catch {
    return 'Unsupported filter condition';
  }
}

function predicateTextBody(
  predicate: VarendoFilterPredicate,
  depth: number,
  traversal: PredicateTraversal,
  parentLogical: boolean,
): string {
  switch (predicate.op) {
    case 'compare':
      return comparePredicateText(predicate);
    case 'is-null':
      return `${predicate.field} ${predicate.negate ? 'is not empty' : 'is empty'}`;
    case 'in':
      return membershipPredicateText(predicate);
    case 'not':
      return `NOT (${predicateText(predicate.predicate, depth + 1, traversal)})`;
    case 'and':
    case 'or':
      return logicalPredicateText(predicate, depth, traversal, parentLogical);
    default:
      return 'Unsupported filter condition';
  }
}

function comparePredicateText(predicate: Extract<VarendoFilterPredicate, { readonly op: 'compare' }>): string {
  if (predicate.value === null || predicate.value === undefined) return 'Unsupported filter condition';
  return `${predicate.field} ${predicate.comparison} ${dataValueText(predicate.value, '')}`;
}

function membershipPredicateText(predicate: Extract<VarendoFilterPredicate, { readonly op: 'in' }>): string {
  const value = Array.isArray(predicate.values) ? membershipJsonText(predicate.values) : undefined;
  if (value === undefined) return 'Unsupported filter condition';
  return `${predicate.field} is one of ${value}`;
}

function logicalPredicateText(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'and' | 'or' }>,
  depth: number,
  traversal: PredicateTraversal,
  parentLogical: boolean,
): string {
  if (!Array.isArray(predicate.predicates) || predicate.predicates.length === 0) return 'Unsupported filter condition';
  const children = logicalChildrenText(predicate.predicates, depth, traversal);
  if (children === undefined) return 'Unsupported filter condition';
  const joiner = predicate.op === 'and' ? ' AND ' : ' OR ';
  const text = children.join(joiner);
  return parentLogical ? `(${text})` : text;
}

function logicalChildrenText(
  predicates: readonly VarendoFilterPredicate[],
  depth: number,
  traversal: PredicateTraversal,
): readonly string[] | undefined {
  const children: string[] = [];
  for (const child of predicates) {
    if (traversal.nodes >= MAX_PREDICATE_NODES) return undefined;
    children.push(predicateText(child, depth + 1, traversal, true));
  }
  return children;
}

export function predicateSourceSignature(
  predicate: VarendoFilterPredicate,
  projection: PredicateProjection,
  entity: string,
): string {
  if (projection.unsupported !== undefined) return `unsupported:${predicateText(predicate)}`;
  const logical = projection.clauses.length > 1 ? projection.logical : 'and';
  return JSON.stringify({ entity, logical, clauses: projection.clauses });
}

export function clausesSourceSignature(clauses: readonly VarendoFilterClause[], logical: VarendoFilterLogical): string {
  return JSON.stringify({ logical: clauses.length > 1 ? logical : 'and', clauses });
}

function parseMembershipValue(raw: unknown, field: VarendoFieldOption | undefined): VarendoFilterValue | undefined {
  const semanticType = fieldSemanticType(field);
  if (semanticType === undefined) return undefined;
  if (typeof raw === 'string') return parseValue(raw, field);
  if (raw === null || typeof raw === 'boolean' || typeof raw === 'number') {
    const checked = validateScalar(raw, semanticType);
    return checked.ok ? checked.value : undefined;
  }
  if (semanticType.value !== 'decimal' || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const checked = validateScalar(raw, semanticType);
  return checked.ok ? checked.value : undefined;
}

function parseMembershipValues(raw: string, field: VarendoFieldOption | undefined): VarendoFilterValue[] | undefined {
  const source = raw.trim();
  if (source.length === 0) return undefined;
  let rawValues: readonly unknown[];
  if (source.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(source);
      if (!Array.isArray(parsed)) return undefined;
      rawValues = parsed;
    } catch {
      return undefined;
    }
  } else {
    rawValues = source.split(',');
  }
  const values = rawValues.map((value) => parseMembershipValue(value, field));
  return values.some((value) => value === undefined) ? undefined : (values as VarendoFilterValue[]);
}

/** Convert one author-controlled draft clause into the canonical predicate
 * vocabulary. Invalid values return undefined rather than being coerced. */
export function buildVarendoPredicate(
  clause: VarendoFilterClause,
  field: VarendoFieldOption | undefined,
  entity = '',
): VarendoFilterPredicate | undefined {
  if (clause.field.length === 0 || field === undefined || field.id !== clause.field) return undefined;
  const base = entity.length === 0 ? {} : { entity };
  if (isNullOperator(clause.operator)) return nullPredicate(clause, base);
  if (clause.operator === 'in') return membershipPredicate(clause, field, base);
  return comparisonPredicate(clause, field, base);
}

function isNullOperator(operator: VarendoFilterOperator): operator is 'is-null' | 'not-null' {
  return operator === 'is-null' || operator === 'not-null';
}

function nullPredicate(clause: VarendoFilterClause, entity: { readonly entity?: string }): VarendoFilterPredicate {
  return { op: 'is-null', field: clause.field, ...entity, negate: clause.operator === 'not-null' };
}

function membershipPredicate(
  clause: VarendoFilterClause,
  field: VarendoFieldOption,
  entity: { readonly entity?: string },
): VarendoFilterPredicate | undefined {
  const values = parseMembershipValues(clause.value ?? '', field);
  if (values === undefined) return undefined;
  return { op: 'in', field: clause.field, ...entity, values };
}

function comparisonPredicate(
  clause: VarendoFilterClause,
  field: VarendoFieldOption,
  entity: { readonly entity?: string },
): VarendoFilterPredicate | undefined {
  const value = parseValue(clause.value ?? '', field);
  if (value === undefined) return undefined;
  const comparison = clause.operator as Extract<VarendoFilterPredicate, { readonly op: 'compare' }>['comparison'];
  return { op: 'compare', field: clause.field, ...entity, comparison, value };
}
