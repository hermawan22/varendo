import type { Catalog, Outcome } from '../../contracts/types.js';
import type { PlanNode, QueryRow, QuerySchema } from '../types.js';
import { failure, relationship, type EvalRelation, type EvalState } from './shared.js';
import { appendRow, tick } from './execution-budget.js';
import { evaluatePredicate } from './expression-runtime.js';
import { scalarKey } from './value-utils.js';

type JoinNode = Extract<PlanNode, { op: 'join' | 'semijoin' }>;
type JoinSide = 'left' | 'right';

function incompleteInput(): Outcome<EvalRelation> {
  return failure('query.incomplete-input', 'Join and semijoin require complete source populations.');
}

function filterRightRows(node: JoinNode, input: EvalRelation, state: EvalState): Outcome<QueryRow[]> {
  const rows: QueryRow[] = [];
  for (const row of input.rows) {
    const step = tick(state);
    if (!step.ok) return step;
    if (node.spec.where === undefined) {
      rows.push(row);
      continue;
    }
    const predicate = evaluatePredicate(state, node.spec.where, row, input.schema);
    if (!predicate.ok) return predicate;
    if (predicate.value === 'true') rows.push(row);
  }
  return { ok: true, value: rows };
}

function fieldForSide(key: JoinNode['keys'][number], side: JoinSide): string {
  return side === 'left' ? key.left : key.right;
}

function joinKey(row: QueryRow, schema: QuerySchema, keys: JoinNode['keys'], side: JoinSide): string | undefined {
  const parts: string[] = [];
  for (const item of keys) {
    const fieldId = fieldForSide(item, side);
    const value = row[fieldId];
    if (value === null || value === undefined) return undefined;
    const type = schema.fields.find((field) => field.id === fieldId)?.type.value;
    parts.push(scalarKey(value, type));
  }
  return parts.join('|');
}

function indexRightRows(
  rows: readonly QueryRow[],
  schema: QuerySchema,
  keys: JoinNode['keys'],
  state: EvalState,
): Outcome<Map<string, QueryRow[]>> {
  const index = new Map<string, QueryRow[]>();
  for (const row of rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const key = joinKey(row, schema, keys, 'right');
    if (key === undefined) continue;
    const matches = index.get(key) ?? [];
    matches.push(row);
    index.set(key, matches);
  }
  return { ok: true, value: index };
}

function duplicateIndex(index: ReadonlyMap<string, readonly QueryRow[]>): boolean {
  return [...index.values()].some((rows) => rows.length > 1);
}

function duplicateCount(counts: ReadonlyMap<string, number>): boolean {
  return [...counts.values()].some((count) => count > 1);
}

function declaredRelationship(node: JoinNode, catalog: Catalog) {
  return relationship(catalog, node.spec.relationship);
}

function validateRightCardinality(node: JoinNode, index: ReadonlyMap<string, readonly QueryRow[]>, catalog: Catalog) {
  if (node.op !== 'join') return { ok: true as const, value: undefined };
  const declared = declaredRelationship(node, catalog);
  if (declared === undefined) return { ok: true as const, value: undefined };
  const onePerKey = declared.cardinality === 'one-to-one' || declared.cardinality === 'many-to-one';
  if (onePerKey && duplicateIndex(index))
    return failure(
      'query.cardinality',
      'Declared relationship cardinality was violated by duplicate right-side join keys.',
    );
  return { ok: true as const, value: undefined };
}

function validateLeftCardinality(
  node: JoinNode,
  rows: readonly QueryRow[],
  schema: QuerySchema,
  catalog: Catalog,
  state: EvalState,
): Outcome<void> {
  if (node.op !== 'join') return { ok: true, value: undefined };
  const declared = declaredRelationship(node, catalog);
  if (declared?.cardinality !== 'one-to-one') return { ok: true, value: undefined };
  const counts = new Map<string, number>();
  for (const row of rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const key = joinKey(row, schema, node.keys, 'left');
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (duplicateCount(counts))
    return failure(
      'query.cardinality',
      'Declared one-to-one relationship was violated by duplicate left-side join keys.',
    );
  return { ok: true, value: undefined };
}

function nullResult(row: QueryRow, fields: QuerySchema['fields']): QueryRow {
  const output: Record<string, QueryRow[string]> = { ...row };
  for (const field of fields) output[field.id] = null;
  return Object.freeze(output);
}

function addMatchedRows(
  node: JoinNode,
  leftRow: QueryRow,
  matches: readonly QueryRow[],
  rightSchema: QuerySchema,
  rows: QueryRow[],
  state: EvalState,
): Outcome<void> {
  if (node.op === 'semijoin') {
    if (matches.length === 0) return { ok: true, value: undefined };
    return appendRow(state, rows, leftRow);
  }
  if (matches.length > 1)
    return failure('query.cardinality', 'Declared one-to-one or many-to-one cardinality was violated by source rows.');
  if (matches.length === 0) {
    if (node.spec.kind !== 'left') return { ok: true, value: undefined };
    return appendRow(state, rows, nullResult(leftRow, rightSchema.fields));
  }
  return appendRow(state, rows, Object.freeze({ ...leftRow, ...matches[0] }));
}

function buildJoinRows(
  node: JoinNode,
  left: EvalRelation,
  right: EvalRelation,
  rightIndex: ReadonlyMap<string, readonly QueryRow[]>,
  state: EvalState,
): Outcome<QueryRow[]> {
  const rows: QueryRow[] = [];
  for (const leftRow of left.rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const key = joinKey(leftRow, left.schema, node.keys, 'left');
    const matches = key === undefined ? [] : (rightIndex.get(key) ?? []);
    const added = addMatchedRows(node, leftRow, matches, right.schema, rows, state);
    if (!added.ok) return added;
  }
  return { ok: true, value: rows };
}

export function evaluateJoin(
  node: JoinNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
  catalog: Catalog,
): Outcome<EvalRelation> {
  const left = inputs[0];
  const right = inputs[1];
  if (left === undefined || right === undefined) return failure('query.plan', 'Join input is missing.');
  if (!left.complete || !right.complete) return incompleteInput();
  const filtered = filterRightRows(node, right, state);
  if (!filtered.ok) return filtered;
  const rightIndex = indexRightRows(filtered.value, right.schema, node.keys, state);
  if (!rightIndex.ok) return rightIndex;
  const rightCardinality = validateRightCardinality(node, rightIndex.value, catalog);
  if (!rightCardinality.ok) return rightCardinality;
  const leftCardinality = validateLeftCardinality(node, left.rows, left.schema, catalog, state);
  if (!leftCardinality.ok) return leftCardinality;
  const rows = buildJoinRows(node, left, right, rightIndex.value, state);
  if (!rows.ok) return rows;
  return { ok: true, value: { schema: node.output, rows: rows.value, complete: true } };
}
