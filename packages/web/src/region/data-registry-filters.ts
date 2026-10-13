import { validateScalar, type Outcome, type Result, type SemanticType } from '@varendo/core';
import type { VarendoFilterPredicate } from '../data/index.js';
import {
  allowedKeys,
  boundedText,
  COMPARISON_OPERATORS,
  failure,
  fieldMap,
  MAX_DATA_ITEMS,
  object,
} from './data-registry-common.js';

const MAX_FILTER_DEPTH = 32;
const MAX_FILTER_NODES = 128;
const MAX_FILTER_PARSE_DEPTH = 16;

interface FilterField {
  readonly id: string;
  readonly type: SemanticType;
}

interface FilterTraversal {
  nodes: number;
}

function filterField(raw: unknown, result: Result, allowedFields: readonly string[]): Outcome<FilterField> {
  const checked = boundedText(raw, 'predicate.field');
  if (!checked.ok) return checked;
  const descriptor = fieldMap(result).get(checked.value);
  if (descriptor === undefined || !allowedFields.includes(checked.value)) {
    return failure('field', 'Filter predicates must target an exposed Result field.');
  }
  return { ok: true, value: { id: descriptor.id, type: descriptor.type } };
}

function comparePredicate(
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
): Outcome<VarendoFilterPredicate> {
  if (!allowedKeys(candidate, ['op', 'field', 'comparison', 'value'])) {
    return failure('config', 'A compare predicate contains an unknown property.');
  }
  const field = filterField(candidate.field, result, allowedFields);
  if (!field.ok) return field;
  if (!COMPARISON_OPERATORS.has(String(candidate.comparison))) {
    return failure('config', 'A compare predicate uses an invalid comparison.');
  }
  const scalar = validateScalar(candidate.value, field.value.type);
  if (!scalar.ok) return failure('field', 'A compare predicate value does not match its Result field.');
  return {
    ok: true,
    value: {
      op: 'compare',
      field: field.value.id,
      comparison: candidate.comparison as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte',
      value: scalar.value,
    },
  };
}

function nullPredicate(
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
): Outcome<VarendoFilterPredicate> {
  if (!allowedKeys(candidate, ['op', 'field', 'negate'])) {
    return failure('config', 'An is-null predicate contains an unknown property.');
  }
  const field = filterField(candidate.field, result, allowedFields);
  if (!field.ok) return field;
  if (typeof candidate.negate !== 'boolean') {
    return failure('config', 'An is-null predicate requires a boolean negate flag.');
  }
  return { ok: true, value: { op: 'is-null', field: field.value.id, negate: candidate.negate } };
}

function inPredicate(
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
): Outcome<VarendoFilterPredicate> {
  if (!allowedKeys(candidate, ['op', 'field', 'values'])) {
    return failure('config', 'An in predicate contains an unknown property.');
  }
  const field = filterField(candidate.field, result, allowedFields);
  if (!field.ok) return field;
  if (!Array.isArray(candidate.values) || candidate.values.length === 0 || candidate.values.length > MAX_DATA_ITEMS) {
    return failure('config', 'An in predicate requires a bounded nonempty values array.');
  }
  const values = [];
  for (const raw of candidate.values) {
    const scalar = validateScalar(raw, field.value.type);
    if (!scalar.ok) return failure('field', 'An in predicate value does not match its Result field.');
    values.push(scalar.value);
  }
  return { ok: true, value: { op: 'in', field: field.value.id, values } };
}

function parseFilterChildren(
  raw: unknown,
  result: Result,
  allowedFields: readonly string[],
  depth: number,
): Outcome<readonly VarendoFilterPredicate[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DATA_ITEMS) {
    return failure('config', 'A compound predicate requires a bounded nonempty predicate list.');
  }
  const predicates: VarendoFilterPredicate[] = [];
  for (const item of raw) {
    const predicate = filterPredicate(item, result, allowedFields, depth + 1);
    if (!predicate.ok) return predicate;
    predicates.push(predicate.value);
  }
  return { ok: true, value: predicates };
}

function compoundPredicate(
  operation: 'and' | 'or',
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
  depth: number,
): Outcome<VarendoFilterPredicate> {
  if (!allowedKeys(candidate, ['op', 'predicates'])) {
    return failure('config', 'A compound predicate contains an unknown property.');
  }
  const predicates = parseFilterChildren(candidate.predicates, result, allowedFields, depth);
  if (!predicates.ok) return predicates;
  return { ok: true, value: { op: operation, predicates: predicates.value } };
}

function notPredicate(
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
  depth: number,
): Outcome<VarendoFilterPredicate> {
  if (!allowedKeys(candidate, ['op', 'predicate'])) {
    return failure('config', 'A not predicate contains an unknown property.');
  }
  const predicate = filterPredicate(candidate.predicate, result, allowedFields, depth + 1);
  if (!predicate.ok) return predicate;
  return { ok: true, value: { op: 'not', predicate: predicate.value } };
}

function dispatchPredicate(
  candidate: Record<string, unknown>,
  result: Result,
  allowedFields: readonly string[],
  depth: number,
): Outcome<VarendoFilterPredicate> {
  switch (candidate.op) {
    case 'compare':
      return comparePredicate(candidate, result, allowedFields);
    case 'is-null':
      return nullPredicate(candidate, result, allowedFields);
    case 'in':
      return inPredicate(candidate, result, allowedFields);
    case 'and':
    case 'or':
      return compoundPredicate(candidate.op, candidate, result, allowedFields, depth);
    case 'not':
      return notPredicate(candidate, result, allowedFields, depth);
    default:
      return failure('config', 'The filter predicate operation is not registered.');
  }
}

/** Validate host-provided filter state against the exact fields exposed by a view. */
export function filterPredicate(
  value: unknown,
  result: Result,
  allowedFields: readonly string[],
  depth = 0,
): Outcome<VarendoFilterPredicate> {
  if (depth > MAX_FILTER_PARSE_DEPTH) return failure('config', 'Filter predicates are too deeply nested.');
  const candidate = object(value);
  if (candidate === undefined || typeof candidate.op !== 'string') {
    return failure('config', 'Filter predicates must use the registered typed vocabulary.');
  }
  try {
    return dispatchPredicate(candidate, result, allowedFields, depth);
  } catch {
    return failure('config', 'The filter predicate could not be validated.');
  }
}

function editableGroup(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'and' | 'or' }>,
  depth: number,
  traversal: FilterTraversal,
  parentLogical: 'and' | 'or' | undefined,
): boolean {
  if (parentLogical !== undefined && predicate.op !== parentLogical) return false;
  if (predicate.predicates.length === 0 || predicate.predicates.length > MAX_DATA_ITEMS) return false;
  for (const child of predicate.predicates) {
    if (!isEditableFilterPredicate(child, depth + 1, traversal, predicate.op)) return false;
  }
  return true;
}

function editableNegation(
  predicate: Extract<VarendoFilterPredicate, { readonly op: 'not' }>,
  depth: number,
  traversal: FilterTraversal,
): boolean {
  if (predicate.predicate.op !== 'is-null') return false;
  return isEditableFilterPredicate(predicate.predicate, depth + 1, traversal);
}

/** The initial filter must be expressible by the bounded clause editor. */
export function isEditableFilterPredicate(
  predicate: VarendoFilterPredicate,
  depth = 0,
  traversal: FilterTraversal = { nodes: 0 },
  parentLogical?: 'and' | 'or',
): boolean {
  if (depth > MAX_FILTER_DEPTH || traversal.nodes >= MAX_FILTER_NODES) return false;
  traversal.nodes += 1;
  switch (predicate.op) {
    case 'compare':
      return predicate.value !== null;
    case 'is-null':
    case 'in':
      return true;
    case 'not':
      return editableNegation(predicate, depth, traversal);
    case 'and':
    case 'or':
      return editableGroup(predicate, depth, traversal, parentLogical);
  }
}
