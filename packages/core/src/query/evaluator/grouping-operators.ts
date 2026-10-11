import type { Outcome } from '../../contracts/types.js';
import type { PlanNode, QueryRow, QueryValue } from '../types.js';
import { failure, type EvalGroup, type EvalRelation, type EvalState } from './shared.js';
import { appendRow, outputValue, tick } from './execution-budget.js';
import { aggregateValues } from './aggregation.js';
import { evaluateExpression } from './expression-runtime.js';
import { scalarKey } from './value-utils.js';

type GroupNode = Extract<PlanNode, { op: 'group' }>;
type AggregateNode = Extract<PlanNode, { op: 'aggregate' }>;

interface MutableGroup {
  readonly keys: Record<string, QueryValue>;
  readonly rows: QueryRow[];
}

function evaluateGroupKey(
  node: GroupNode,
  row: QueryRow,
  schema: EvalRelation['schema'],
  state: EvalState,
): Outcome<{ readonly id: string; readonly value: QueryValue }[]> {
  const values: { id: string; value: QueryValue }[] = [];
  for (const key of node.keys) {
    const evaluated = evaluateExpression(state, key.expression, row, schema);
    if (!evaluated.ok) return evaluated;
    const field = node.output.fields.find((candidate) => candidate.id === key.id);
    const checked = outputValue(evaluated.value, field);
    if (!checked.ok) return checked;
    values.push({ id: key.id, value: checked.value });
  }
  return { ok: true, value: values };
}

function groupIdentity(
  node: GroupNode,
  values: readonly { readonly id: string; readonly value: QueryValue }[],
): string {
  return values.map((entry, index) => scalarKey(entry.value, node.output.fields[index]?.type.value)).join('|');
}

function addToGroup(
  groups: Map<string, MutableGroup>,
  key: string,
  values: readonly { readonly id: string; readonly value: QueryValue }[],
  row: QueryRow,
): void {
  const current = groups.get(key) ?? { keys: {}, rows: [] };
  for (const entry of values) current.keys[entry.id] = entry.value;
  current.rows.push(row);
  groups.set(key, current);
}

function materializeGroups(groups: ReadonlyMap<string, MutableGroup>, schema: EvalRelation['schema']): EvalGroup[] {
  return [...groups.values()].map((group) => ({
    keyRow: Object.freeze(group.keys),
    rows: Object.freeze(group.rows),
    schema,
  }));
}

export function evaluateGroup(
  node: GroupNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input === undefined) return failure('query.plan', 'Group input is missing.');
  if (!input.complete) return failure('query.incomplete-input', 'Grouping requires a complete source population.');
  const groups = new Map<string, MutableGroup>();
  for (const row of input.rows) {
    const step = tick(state);
    if (!step.ok) return step;
    const values = evaluateGroupKey(node, row, input.schema, state);
    if (!values.ok) return values;
    addToGroup(groups, groupIdentity(node, values.value), values.value, row);
  }
  if (node.keys.length === 0 && groups.size === 0) groups.set('[]', { keys: {}, rows: [] });
  const grouped = materializeGroups(groups, input.schema);
  return {
    ok: true,
    value: {
      schema: node.output,
      rows: grouped.map((group) => group.keyRow),
      complete: true,
      groups: grouped,
    },
  };
}

function aggregateGroupRow(node: AggregateNode, group: EvalGroup, state: EvalState): Outcome<QueryRow> {
  const output: Record<string, QueryValue> = { ...group.keyRow };
  for (const item of node.items) {
    const value = aggregateValues(state, item, group);
    if (!value.ok) return value;
    const checked = outputValue(
      value.value,
      node.output.fields.find((field) => field.id === item.id),
    );
    if (!checked.ok) return checked;
    output[item.id] = checked.value;
  }
  return { ok: true, value: Object.freeze(output) };
}

export function evaluateAggregate(
  node: AggregateNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
): Outcome<EvalRelation> {
  const input = inputs[0];
  if (input === undefined) return failure('query.plan', 'Aggregate input is missing.');
  if (input.groups === undefined) return failure('query.aggregate', 'Aggregate node requires a preceding group node.');
  const rows: QueryRow[] = [];
  for (const group of input.groups) {
    const step = tick(state);
    if (!step.ok) return step;
    const output = aggregateGroupRow(node, group, state);
    if (!output.ok) return output;
    const added = appendRow(state, rows, output.value);
    if (!added.ok) return added;
  }
  return { ok: true, value: { schema: node.output, rows, complete: true } };
}
