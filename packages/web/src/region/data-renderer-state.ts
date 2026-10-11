import type { InteractionState, ResultRef, Scalar, SemanticType } from '@varendo/core';
import { validateScalar } from '@varendo/core';
import type { AeliqoSelectionScope } from '../data/selection-summary.js';
import { stableDataRecordKey } from '../data/shared.js';
import type { AeliqoFilterChangeDetail, AeliqoFilterPredicate } from '../data/types.js';
import type { AeliqoDataResolvedNode } from './data-registry.js';
import { allowedKeys, COMPARISON_OPERATORS } from './data-registry-common.js';
import {
  exactKeys,
  exactRecord,
  interactionPayload,
  record,
  resultRef,
  sameRef,
  selectionPort,
} from './data-renderer-shared.js';

export function validScopeDetail(value: unknown, node: AeliqoDataResolvedNode): boolean {
  if (value === undefined) return true;
  const scope = exactRecord(
    value,
    ['loaded', 'filteredTotal', 'populationTotal', 'populationDigest', 'kind', 'label'],
    [],
  );
  if (scope === undefined) return false;
  return validScopeCounts(scope) && validScopeDigest(scope, node) && validScopeKind(scope) && validScopeLabel(scope);
}

function validScopeCounts(scope: Record<string, unknown>): boolean {
  for (const key of ['loaded', 'filteredTotal', 'populationTotal'] as const) {
    if (!Object.hasOwn(scope, key)) continue;
    if (!Number.isSafeInteger(scope[key]) || (scope[key] as number) < 0) return false;
  }
  return true;
}

function validScopeDigest(scope: Record<string, unknown>, node: AeliqoDataResolvedNode): boolean {
  if (!Object.hasOwn(scope, 'populationDigest')) return true;
  return typeof scope.populationDigest === 'string' && scope.populationDigest === node.scope.populationDigest;
}

function validScopeKind(scope: Record<string, unknown>): boolean {
  if (!Object.hasOwn(scope, 'kind')) return true;
  return ['loaded', 'filtered', 'population', 'sample', 'unknown'].includes(String(scope.kind));
}

function validScopeLabel(scope: Record<string, unknown>): boolean {
  return !Object.hasOwn(scope, 'label') || typeof scope.label === 'string';
}

export function selectedKeys(
  node: AeliqoDataResolvedNode,
  interaction: InteractionState | undefined,
): readonly string[] {
  const selection = validatedSelection(node, interaction);
  return selection?.mode === 'ids' ? selection.keys : [];
}

export function selectedSummary(
  node: AeliqoDataResolvedNode,
  interaction: InteractionState | undefined,
): {
  readonly keys: readonly string[];
  readonly scope?: AeliqoSelectionScope;
} {
  const selection = validatedSelection(node, interaction);
  if (selection === undefined || selection.mode === 'clear') return { keys: [] };
  if (selection.mode === 'ids') {
    return {
      keys: selection.keys,
      scope: { kind: 'ids', matched: selection.keys.length },
    };
  }
  return {
    keys: [],
    scope: {
      kind: 'predicate',
      label: 'All matching records in the active server filter',
    },
  };
}

export function currentFilter(
  node: AeliqoDataResolvedNode,
  interaction: InteractionState | undefined,
): AeliqoFilterChangeDetail | undefined {
  try {
    const payload = interactionPayload(node, interaction, 'filter', 'filter');
    if (payload === undefined || payload.outputId !== node.result.ref.outputId || !Array.isArray(payload.predicates))
      return undefined;
    const predicates = payload.predicates;
    if (predicates.length > 128 || predicates.some((predicate) => !validatePredicate(predicate, node)))
      return undefined;
    const predicate = filterPredicate(predicates);
    return { ...(predicate === undefined ? {} : { predicate }), applied: true };
  } catch {
    return undefined;
  }
}

function filterPredicate(predicates: unknown[]): AeliqoFilterPredicate | undefined {
  if (predicates.length === 0) return undefined;
  if (predicates.length === 1) return predicates[0] as AeliqoFilterPredicate;
  return { op: 'and', predicates: predicates as AeliqoFilterPredicate[] };
}

export function configuredPredicate(
  node: AeliqoDataResolvedNode,
  key: 'predicate' | 'inherited',
): AeliqoFilterPredicate | undefined {
  try {
    const candidate = node.config.values[key];
    return validatePredicate(candidate, node) ? (candidate as AeliqoFilterPredicate) : undefined;
  } catch {
    return undefined;
  }
}

type ValidatedSelection =
  | { readonly mode: 'clear' }
  | {
      readonly mode: 'ids';
      readonly entity: string;
      readonly keys: readonly string[];
      readonly result: ResultRef;
    }
  | {
      readonly mode: 'predicate';
      readonly entity: string;
      readonly predicate: AeliqoFilterPredicate;
      readonly queryDigest: string;
      readonly populationDigest: string;
    };

function validPopulationDigest(node: AeliqoDataResolvedNode): string | undefined {
  return typeof node.scope.populationDigest === 'string' && node.scope.populationDigest.length > 0
    ? node.scope.populationDigest
    : undefined;
}

function validatedSelection(
  node: AeliqoDataResolvedNode,
  interaction: InteractionState | undefined,
): ValidatedSelection | undefined {
  const payload = interactionPayload(node, interaction, 'selection', 'selection');
  if (payload === undefined) return undefined;
  const selection = record(payload.selection);
  const selectionPortValue = selectionPort(node);
  if (selection === undefined || selectionPortValue === undefined) return undefined;
  const entity = selection.entity;
  if (typeof entity !== 'string' || entity !== selectionPortValue.entity) return undefined;
  return validateSelectionMode(selection, node, entity);
}

function validateSelectionMode(
  selection: Record<string, unknown>,
  node: AeliqoDataResolvedNode,
  entity: string,
): ValidatedSelection | undefined {
  switch (selection.mode) {
    case 'clear':
      return validClearSelection(selection) ? { mode: 'clear' } : undefined;
    case 'ids':
      return idsSelection(selection, node, entity);
    case 'predicate':
      return predicateSelection(selection, node, entity);
    default:
      return undefined;
  }
}

function validClearSelection(selection: Record<string, unknown>): boolean {
  return Object.keys(selection).length === 1 && Object.hasOwn(selection, 'mode');
}

function idsSelection(
  selection: Record<string, unknown>,
  node: AeliqoDataResolvedNode,
  entity: string,
): ValidatedSelection | undefined {
  if (!allowedKeys(selection, ['mode', 'entity', 'keys', 'result'])) return undefined;
  const checkedResult = resultRef(selection.result);
  if (checkedResult === undefined || !sameRef(checkedResult, node.result.ref)) return undefined;
  if (!Array.isArray(selection.keys) || !exactKeys(selection.keys)) return undefined;
  return { mode: 'ids', entity, keys: [...selection.keys], result: checkedResult };
}

function predicateSelection(
  selection: Record<string, unknown>,
  node: AeliqoDataResolvedNode,
  entity: string,
): ValidatedSelection | undefined {
  if (!allowedKeys(selection, ['mode', 'entity', 'predicate', 'queryDigest', 'populationDigest'])) return undefined;
  const queryDigest = selection.queryDigest;
  const populationDigest = selection.populationDigest;
  if (typeof queryDigest !== 'string' || queryDigest !== node.result.ref.queryDigest) return undefined;
  if (typeof populationDigest !== 'string' || populationDigest !== validPopulationDigest(node)) return undefined;
  if (!validatePredicate(selection.predicate, node)) return undefined;
  return {
    mode: 'predicate',
    entity,
    predicate: selection.predicate as AeliqoFilterPredicate,
    queryDigest,
    populationDigest,
  };
}

function normalizedScalar(value: unknown): Scalar | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return value as Scalar;
  const candidate = record(value);
  return candidate !== undefined && Object.keys(candidate).length === 1 && typeof candidate.decimal === 'string'
    ? { decimal: candidate.decimal }
    : undefined;
}

export function validKeys(
  node: AeliqoDataResolvedNode,
  keys: readonly string[],
  interaction: InteractionState | undefined,
  entity: string,
): boolean {
  try {
    if (!exactKeys(keys)) return false;
    const loaded = new Set(
      node.rows
        .map((row) => stableDataRecordKey(row, node.config.identity))
        .filter((key): key is string => key !== undefined),
    );
    const authorized = validatedSelection(node, interaction);
    const retained =
      authorized?.mode === 'ids' && authorized.entity === entity ? new Set(authorized.keys) : new Set<string>();
    return keys.every((key) => loaded.has(key) || retained.has(key));
  } catch {
    return false;
  }
}

interface PredicateValidationContext {
  readonly fields: ReadonlyMap<string, AeliqoDataResolvedNode['result']['fields'][number]>;
  readonly allowedFields: ReadonlySet<string>;
  readonly seen: WeakSet<object>;
}

export function validatePredicate(value: unknown, node: AeliqoDataResolvedNode): boolean {
  try {
    const fields = new Map(node.result.fields.map((field) => [field.id, field]));
    const allowedFields = node.config.fields.length === 0 ? new Set(fields.keys()) : new Set(node.config.fields);
    return checkPredicate(value, { fields, allowedFields, seen: new WeakSet<object>() }, 0);
  } catch {
    return false;
  }
}

function checkPredicate(value: unknown, context: PredicateValidationContext, depth: number): boolean {
  if (depth > 32 || value === null || typeof value !== 'object' || context.seen.has(value)) return false;
  context.seen.add(value);
  const predicate = record(value);
  if (predicate === undefined || typeof predicate.op !== 'string') return false;
  return checkPredicateOperation(predicate, context, depth);
}

function checkPredicateOperation(
  predicate: Record<string, unknown>,
  context: PredicateValidationContext,
  depth: number,
): boolean {
  switch (predicate.op) {
    case 'and':
    case 'or':
      return validLogicalGroup(predicate, context, depth);
    case 'not':
      return validNegation(predicate, context, depth);
    case 'is-null':
    case 'compare':
    case 'in':
      return validLeafPredicate(predicate, context);
    default:
      return false;
  }
}

function validLogicalGroup(
  predicate: Record<string, unknown>,
  context: PredicateValidationContext,
  depth: number,
): boolean {
  if (!allowedKeys(predicate, ['op', 'predicates']) || !Array.isArray(predicate.predicates)) return false;
  if (predicate.predicates.length === 0 || predicate.predicates.length > 128) return false;
  return predicate.predicates.every((child) => checkPredicate(child, context, depth + 1));
}

function validNegation(
  predicate: Record<string, unknown>,
  context: PredicateValidationContext,
  depth: number,
): boolean {
  if (Object.keys(predicate).length !== 2 || !Object.hasOwn(predicate, 'predicate')) return false;
  return checkPredicate(predicate.predicate, context, depth + 1);
}

function validLeafPredicate(predicate: Record<string, unknown>, context: PredicateValidationContext): boolean {
  const field = predicateField(predicate, context);
  if (field === undefined) return false;
  switch (predicate.op) {
    case 'is-null':
      return validNullPredicate(predicate);
    case 'compare':
      return validComparisonPredicate(predicate, field.type);
    case 'in':
      return validInPredicate(predicate, field.type);
    default:
      return false;
  }
}

function predicateField(
  predicate: Record<string, unknown>,
  context: PredicateValidationContext,
): AeliqoDataResolvedNode['result']['fields'][number] | undefined {
  if (typeof predicate.field !== 'string') return undefined;
  if (!context.allowedFields.has(predicate.field)) return undefined;
  if (Object.hasOwn(predicate, 'entity') && predicate.entity !== undefined) return undefined;
  return context.fields.get(predicate.field);
}

function validNullPredicate(predicate: Record<string, unknown>): boolean {
  return allowedKeys(predicate, ['op', 'field', 'negate']) && typeof predicate.negate === 'boolean';
}

function validComparisonPredicate(predicate: Record<string, unknown>, fieldType: SemanticType): boolean {
  if (!allowedKeys(predicate, ['op', 'field', 'comparison', 'value'])) return false;
  if (!COMPARISON_OPERATORS.has(String(predicate.comparison))) return false;
  const scalar = normalizedScalar(predicate.value);
  return scalar !== undefined && validateScalar(scalar, fieldType).ok;
}

function validInPredicate(predicate: Record<string, unknown>, fieldType: SemanticType): boolean {
  if (!allowedKeys(predicate, ['op', 'field', 'values']) || !Array.isArray(predicate.values)) return false;
  if (predicate.values.length === 0 || predicate.values.length > 128) return false;
  return predicate.values.every((value) => validScalar(value, fieldType));
}

function validScalar(value: unknown, fieldType: SemanticType): boolean {
  const scalar = normalizedScalar(value);
  return scalar !== undefined && validateScalar(scalar, fieldType).ok;
}

export function hasMore(node: AeliqoDataResolvedNode): boolean {
  const population =
    node.result.counts.population.kind === 'exact' ? node.result.counts.population.value : node.scope.filteredTotal;
  return Number.isSafeInteger(population) && (population as number) > node.rows.length;
}
