import type { Catalog, Outcome } from '../../contracts/types.js';
import type { PlanNode, QueryRow, QueryValue, ProjectionSpec, DeriveSpec, TimeBucketSpec } from '../types.js';
import { appendRow, outputValue, tick } from './execution-budget.js';
import { evaluateExpression, evaluatePredicate } from './expression-runtime.js';
import { failure, type EvalRelation, type EvalState } from './shared.js';
import { bucket } from './ordering.js';
import { normalizeSourceRelation } from './source-relation.js';

type ProjectionNode = Extract<PlanNode, { op: 'project' | 'derive' | 'time-bucket' }>;
type ProjectionItem = ProjectionSpec | DeriveSpec | TimeBucketSpec;

function firstInput(inputs: readonly EvalRelation[]): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input !== undefined) return { ok: true, value: input };
  return failure('query.plan', 'Plan operator input is missing.');
}

export function evaluateScan(
  node: Extract<PlanNode, { op: 'scan' }>,
  state: EvalState,
  catalog: Catalog,
): Outcome<EvalRelation> {
  const source = state.source.relations[node.entity];
  if (source === undefined) return failure('query.source', `Source relation ${node.entity} is missing.`);
  return normalizeSourceRelation(source, catalog, node.entity, state);
}

export function evaluateFilter(
  node: Extract<PlanNode, { op: 'filter' }>,
  inputs: readonly EvalRelation[],
  state: EvalState,
): Outcome<EvalRelation> {
  const resolved = firstInput(inputs);
  if (!resolved.ok) return resolved;
  const input = resolved.value;
  const rows: QueryRow[] = [];
  for (const row of input.rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const predicate = evaluatePredicate(state, node.predicate, row, input.schema);
    if (!predicate.ok) return predicate;
    if (predicate.value !== 'true') continue;
    const added = appendRow(state, rows, row);
    if (!added.ok) return added;
  }
  return { ok: true, value: { schema: node.output, rows, complete: input.complete } };
}

function projectedValue(
  node: ProjectionNode,
  item: ProjectionItem,
  row: QueryRow,
  input: EvalRelation,
  state: EvalState,
): Outcome<QueryValue | undefined> {
  const value = evaluateExpression(state, item.expression, row, input.schema);
  if (!value.ok) return value;
  if (node.op === 'time-bucket') return bucket(value.value, item as TimeBucketSpec);
  return value;
}

function projectRow(
  node: ProjectionNode,
  items: readonly ProjectionItem[],
  row: QueryRow,
  input: EvalRelation,
  state: EvalState,
): Outcome<Record<string, QueryValue>> {
  const output: Record<string, QueryValue> = { ...row };
  for (const item of items) {
    const value = projectedValue(node, item, row, input, state);
    if (!value.ok) return value;
    const checked = outputValue(
      value.value,
      node.output.fields.find((field) => field.id === item.id),
    );
    if (!checked.ok) return checked;
    output[item.id] = checked.value;
  }
  return { ok: true, value: output };
}

function projectOnlyFields(node: ProjectionNode, row: Record<string, QueryValue>): QueryRow {
  const output: Record<string, QueryValue> = {};
  for (const field of node.output.fields) output[field.id] = row[field.id] ?? null;
  return Object.freeze(output);
}

export function evaluateProjection(
  node: ProjectionNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
): Outcome<EvalRelation> {
  const resolved = firstInput(inputs);
  if (!resolved.ok) return resolved;
  const input = resolved.value;
  const items = node.items as readonly ProjectionItem[];
  const rows: QueryRow[] = [];
  for (const row of input.rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const projected = projectRow(node, items, row, input, state);
    if (!projected.ok) return projected;
    const output = node.op === 'project' ? projectOnlyFields(node, projected.value) : Object.freeze(projected.value);
    const added = appendRow(state, rows, output);
    if (!added.ok) return added;
  }
  return { ok: true, value: { schema: node.output, rows, complete: input.complete } };
}
