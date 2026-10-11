import type { Outcome } from '../../contracts/types.js';
import type { PlanNode, QueryRow } from '../types.js';
import { failure, type EvalRelation, type EvalState } from './shared.js';
import { compareRows } from './ordering.js';
import { executeWindow } from './window.js';

type SortNode = Extract<PlanNode, { op: 'sort' }>;
type TopKNode = Extract<PlanNode, { op: 'top-k' }>;
type WindowNode = Extract<PlanNode, { op: 'window' }>;

function completeInput(input: EvalRelation, operation: string): Outcome<void> {
  if (input.complete) return { ok: true, value: undefined };
  return failure('query.incomplete-input', `${operation} requires a complete source population.`);
}

function sortRows(rows: QueryRow[], node: SortNode, schema: EvalRelation['schema'], state: EvalState): Outcome<void> {
  let sortError: Extract<Outcome<number>, { ok: false }> | undefined;
  rows.sort((left, right) => {
    if (sortError !== undefined) return 0;
    const compared = compareRows(left, right, schema, node.items, state);
    if (!compared.ok) {
      sortError = compared;
      return 0;
    }
    return compared.value;
  });
  return sortError ?? { ok: true, value: undefined };
}

export function evaluateSort(node: SortNode, inputs: readonly EvalRelation[], state: EvalState): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input === undefined) return failure('query.plan', 'Sort input is missing.');
  const complete = completeInput(input, 'Exact sorting');
  if (!complete.ok) return complete;
  const rows = [...input.rows];
  const sorted = sortRows(rows, node, input.schema, state);
  if (!sorted.ok) return sorted;
  return { ok: true, value: { schema: node.output, rows, complete: true } };
}

export function evaluateTopK(node: TopKNode, inputs: readonly EvalRelation[]): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input === undefined) return failure('query.plan', 'Top-K input is missing.');
  const complete = completeInput(input, 'Top-K');
  if (!complete.ok) return complete;
  return {
    ok: true,
    value: { schema: node.output, rows: input.rows.slice(0, node.limit), complete: true },
  };
}

export function evaluateWindowNode(
  node: WindowNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input === undefined) return failure('query.plan', 'Window input is missing.');
  const complete = completeInput(input, 'Window evaluation');
  if (!complete.ok) return complete;
  return executeWindow(state, input, node.items, node.output);
}
