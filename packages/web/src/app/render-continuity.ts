import {
  validateCommitReadSet,
  type CommitPreconditions,
  type InteractionState,
  type Outcome,
  type PresentationPlan,
  type Result,
  type Task,
} from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { stableDataRecordKey } from '../data/shared.js';
import { rowIdentity } from '../region/data-registry-selection.js';
import type { VarendoRegionResult } from '../region/types.js';

export type RenderContinuity =
  | { readonly kind: 'replace' }
  | {
      readonly kind: 'retain';
      readonly incumbent: PresentationPlan;
      readonly interaction: InteractionState | undefined;
    };

interface ContinuityInput {
  readonly previousTask: Task | undefined;
  readonly task: Task;
  readonly previous: ValidatedPresentation | undefined;
  readonly interaction: InteractionState | undefined;
  readonly current: CommitPreconditions;
  readonly results: readonly Result[];
  readonly bindings: readonly VarendoRegionResult[];
  readonly previousAuthority: string | undefined;
  readonly currentAuthority: string | undefined;
}

type ResultPair = { readonly previous: Result; readonly next: Result };
type Value = InteractionState['values'][number];

const failure = (message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: 'web.app.continuity', message, retryable: false }],
});

function canonical(value: unknown): string {
  if (Object.is(value, -0)) return '-0';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function taskSemantics(task: Task): string {
  const { id: _id, revision: _revision, goal: _goal, viewPreference: _viewPreference, ...semantics } = task;
  return canonical(semantics);
}

function resultSemantics(result: Result): string {
  const { taskId: _taskId, ref, ...semantics } = result;
  const { id: _id, ...pins } = ref;
  return canonical({ ...semantics, ref: pins });
}

function emptyInteraction(state: InteractionState | undefined): boolean {
  return (state?.values.length ?? 0) === 0 && (state?.drafts.length ?? 0) === 0;
}

function resultPairs(
  input: ContinuityInput,
  previous: ValidatedPresentation,
): Outcome<readonly ResultPair[] | undefined> {
  const pairs: ResultPair[] = [];
  for (const node of previous.nodes) {
    if (node.result === undefined) continue;
    const candidates = input.results.filter((result) => result.ref.outputId === node.result!.ref.outputId);
    const next = candidates[0];
    if (candidates.length !== 1 || next === undefined || next.taskId !== input.task.id)
      return failure('The layout transition has no unique candidate Result owner.');
    if (resultSemantics(node.result) !== resultSemantics(next)) {
      if (emptyInteraction(input.interaction)) return { ok: true, value: undefined };
      return failure('The layout transition changed Result scope, lineage, shape, or population semantics.');
    }
    pairs.push({ previous: node.result, next });
  }
  return { ok: true, value: pairs };
}

function pairFor(value: Value, previous: ValidatedPresentation, pairs: readonly ResultPair[]): ResultPair | undefined {
  const node = previous.nodes.find((candidate) => candidate.node.id === value.nodeId);
  if (node === undefined) return undefined;
  const source = node.config.ports.find((port) => port.id === value.portId && port.payload === value.payload.kind);
  if (source === undefined) return undefined;
  if (
    value.payload.kind === 'selection' &&
    value.payload.selection.mode !== 'clear' &&
    value.payload.selection.entity !== source.entity
  )
    return undefined;
  if (node.result !== undefined)
    return pairs.find((pair) => canonical(pair.previous.ref) === canonical(node.result!.ref));
  if (!('outputId' in value.payload)) return undefined;
  const outputId = value.payload.outputId;
  return pairs.find((pair) => pair.previous.ref.outputId === outputId);
}

function memberSelection(keys: readonly string[], result: Result, bindings: readonly VarendoRegionResult[]): boolean {
  if (result.identity.length === 0 || new Set(keys).size !== keys.length) return false;
  const matches = bindings.filter((binding) => canonical(binding.ref) === canonical(result.ref));
  const binding = matches[0];
  if (matches.length !== 1 || binding === undefined) return false;
  const members = new Set<string>();
  const dataMembers = new Set<string>();
  for (const row of binding.rows) {
    const identity = rowIdentity(row, result);
    if (!identity.ok || members.has(identity.value)) return false;
    members.add(identity.value);
    const dataKey = stableDataRecordKey(row, result.identity);
    if (dataKey === undefined || dataMembers.has(dataKey)) return false;
    dataMembers.add(dataKey);
  }
  return keys.every((key) => members.has(key)) || keys.every((key) => dataMembers.has(key));
}

function retainSelection(value: Value, pair: ResultPair, bindings: readonly VarendoRegionResult[]): Outcome<Value> {
  if (value.payload.kind !== 'selection') return failure('A selection payload is required.');
  const selection = value.payload.selection;
  if (selection.mode === 'clear') return { ok: true, value };
  const sameRef = canonical(pair.previous.ref) === canonical(pair.next.ref);
  if (selection.mode === 'predicate') {
    if (!sameRef || selection.queryDigest !== pair.next.ref.queryDigest)
      return failure('A population selection requires explicit host revalidation across Result generations.');
    return { ok: true, value };
  }
  if (canonical(selection.result) !== canonical(pair.previous.ref))
    return failure('The retained selection does not belong to its previous Result owner.');
  if (!sameRef && !memberSelection(selection.keys, pair.next, bindings))
    return failure('The candidate Result does not prove every retained selected identity.');
  return {
    ok: true,
    value: Object.freeze({
      ...value,
      payload: Object.freeze({
        kind: 'selection',
        selection: Object.freeze({ ...selection, result: pair.next.ref }),
      }),
    }),
  };
}

function retainValue(value: Value, pair: ResultPair, bindings: readonly VarendoRegionResult[]): Outcome<Value> {
  if (value.payload.kind === 'selection') return retainSelection(value, pair, bindings);
  if (value.payload.outputId !== pair.next.ref.outputId)
    return failure('The interaction output does not match its candidate Result owner.');
  if (
    value.payload.kind === 'page' &&
    (canonical(pair.previous.ref) !== canonical(pair.next.ref) ||
      value.payload.queryDigest !== pair.next.ref.queryDigest)
  )
    return failure('A page cursor requires explicit host revalidation across Result generations.');
  return { ok: true, value };
}

function retainedState(
  input: ContinuityInput,
  previous: ValidatedPresentation,
  pairs: readonly ResultPair[],
): Outcome<InteractionState | undefined> {
  if (input.interaction === undefined) return { ok: true, value: undefined };
  const values: Value[] = [];
  for (const value of input.interaction.values) {
    const pair = pairFor(value, previous, pairs);
    if (pair === undefined) return failure('An active interaction has no compatible previous Result and port owner.');
    const retained = retainValue(value, pair, input.bindings);
    if (!retained.ok) return retained;
    values.push(retained.value);
  }
  return { ok: true, value: Object.freeze({ ...input.interaction, values: Object.freeze(values) }) };
}

/** Preflight only: the core resolver and runtime projector still validate every layout transfer. */
export function prepareRenderContinuity(input: ContinuityInput): Outcome<RenderContinuity> {
  const previousTask = input.previousTask;
  if (previousTask === undefined || previousTask.kind !== 'data' || input.task.kind !== 'data')
    return { ok: true, value: { kind: 'replace' } };
  if (taskSemantics(previousTask) !== taskSemantics(input.task)) return { ok: true, value: { kind: 'replace' } };
  const previous = input.previous;
  if (previous === undefined) return failure('A layout transition requires its previous validated presentation.');
  if (input.previousAuthority === undefined || input.previousAuthority !== input.currentAuthority)
    return failure('The interaction owner no longer has the same authority.');
  const priorRefs = previous.nodes.flatMap((node) => (node.result === undefined ? [] : [node.result.ref]));
  const incumbent = validateCommitReadSet(previous.plan.preconditions, input.current, priorRefs);
  if (!incumbent.ok) return incumbent;
  const candidateRefs = input.results.map((result) => result.ref);
  const candidates = validateCommitReadSet({ ...input.current, results: candidateRefs }, input.current, candidateRefs);
  if (!candidates.ok) return candidates;
  return matchedContinuity(input, previous);
}

function matchedContinuity(input: ContinuityInput, previous: ValidatedPresentation): Outcome<RenderContinuity> {
  const pairs = resultPairs(input, previous);
  if (!pairs.ok) return pairs;
  if (pairs.value === undefined) return { ok: true, value: { kind: 'replace' } };
  const interaction = retainedState(input, previous, pairs.value);
  if (!interaction.ok) return interaction;
  return { ok: true, value: { kind: 'retain', incumbent: previous.plan, interaction: interaction.value } };
}
