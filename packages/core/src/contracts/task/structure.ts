import { parseTask } from '../parse.js';
import type { Diagnostic, Outcome, ResultRef, Task } from '../types.js';
import { WIRE_LIMITS } from '../limits.js';
import { resultRefKey } from '../stable.js';

export type TaskStructure = {
  readonly task: Task;
  /** Stable topological order of named data outputs; empty for queryless tasks. */
  readonly outputOrder: readonly string[];
  /** External immutable handles, including fixed cohorts, never visible row indices. */
  readonly resultReferences: readonly ResultRef[];
};

const refKey = resultRefKey;
type DataTaskOutput = Extract<Task, { readonly kind: 'data' }>['outputs'][number];

interface TaskValidationState {
  readonly diagnostics: Diagnostic[];
  readonly outputIds: Set<string>;
  readonly ambiguousOutputIds: Set<string>;
  readonly references: Map<string, ResultRef>;
  readonly order: string[];
}

function taskFailure(
  state: TaskValidationState,
  code: string,
  message: string,
  path: readonly (string | number)[],
): void {
  if (state.diagnostics.length >= WIRE_LIMITS.diagnostics) return;
  state.diagnostics.push({ code, message, path, retryable: false });
}

function unique(values: readonly string[], path: readonly (string | number)[], state: TaskValidationState): void {
  const seen = new Set<string>();
  values.forEach((id, index) => {
    if (seen.has(id))
      taskFailure(state, 'task.duplicate', 'The identifier must be unique in this list.', [...path, index]);
    seen.add(id);
  });
}

function validateNeedIdentities(task: Task, state: TaskValidationState): void {
  unique(
    task.needs.map((need) => need.id),
    ['needs'],
    state,
  );
  task.needs.forEach((need, index) => unique(need.fields, ['needs', index, 'fields'], state));
}

function recordDependency(
  dependency: string,
  output: DataTaskOutput,
  index: number,
  dependencyIndex: number,
  outputIds: ReadonlySet<string>,
  dependents: Map<string, string[]>,
  state: TaskValidationState,
): void {
  if (!outputIds.has(dependency))
    taskFailure(state, 'task.dependency-missing', 'The named output dependency does not exist.', [
      'outputs',
      index,
      'dependsOn',
      dependencyIndex,
    ]);
  const next = dependents.get(dependency) ?? [];
  next.push(output.id);
  dependents.set(dependency, next);
}

function validateQueryPopulation(
  output: Extract<DataTaskOutput, { readonly kind: 'query' }>,
  index: number,
  outputById: ReadonlyMap<string, DataTaskOutput>,
  state: TaskValidationState,
): void {
  const population = output.query.population;
  if (population.kind !== 'all-authorized')
    unique(population.identityKeys, ['outputs', index, 'query', 'population', 'identityKeys'], state);
  if (population.kind === 'fixed') state.references.set(refKey(population.source), population.source);
  if (population.kind !== 'live-output') return;
  if (!output.dependsOn.includes(population.outputId))
    taskFailure(
      state,
      'task.cohort-dependency',
      'A live cohort must declare its named upstream output as a dependency.',
      ['outputs', index, 'query', 'population', 'outputId'],
    );
  if (outputById.get(population.outputId)?.kind === 'reuse')
    taskFailure(
      state,
      'task.cohort-source',
      'Live membership requires an upstream query; an immutable reused result is a fixed cohort source.',
      ['outputs', index, 'query', 'population', 'outputId'],
    );
}

function validateOutputDependencies(
  output: DataTaskOutput,
  index: number,
  outputIds: ReadonlySet<string>,
  outputById: ReadonlyMap<string, DataTaskOutput>,
  indegree: Map<string, number>,
  dependents: Map<string, string[]>,
  state: TaskValidationState,
): void {
  unique(output.dependsOn, ['outputs', index, 'dependsOn'], state);
  indegree.set(output.id, output.dependsOn.length);
  for (let dependencyIndex = 0; dependencyIndex < output.dependsOn.length; dependencyIndex += 1)
    recordDependency(output.dependsOn[dependencyIndex]!, output, index, dependencyIndex, outputIds, dependents, state);
  if (output.kind === 'reuse') {
    state.references.set(refKey(output.result), output.result);
    return;
  }
  validateQueryPopulation(output, index, outputById, state);
}

function resolveOutputOrder(
  task: Extract<Task, { readonly kind: 'data' }>,
  indegree: Map<string, number>,
  dependents: ReadonlyMap<string, readonly string[]>,
  state: TaskValidationState,
): void {
  if (state.diagnostics.length > 0) return;
  const queue = task.outputs.filter((output) => indegree.get(output.id) === 0).map((output) => output.id);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    state.order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (state.order.length !== task.outputs.length)
    taskFailure(state, 'task.output-cycle', 'Named output dependencies must be acyclic.', ['outputs']);
}

function validateDataTask(task: Extract<Task, { readonly kind: 'data' }>, state: TaskValidationState): void {
  unique(
    task.outputs.map((output) => output.id),
    ['outputs'],
    state,
  );
  for (const output of task.outputs) state.outputIds.add(output.id);
  const outputById = new Map(task.outputs.map((output) => [output.id, output]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (let index = 0; index < task.outputs.length; index += 1)
    validateOutputDependencies(task.outputs[index]!, index, state.outputIds, outputById, indegree, dependents, state);
  resolveOutputOrder(task, indegree, dependents, state);
}

function validatePresentationTask(
  task: Extract<Task, { readonly kind: 'presentation' }>,
  state: TaskValidationState,
): void {
  const byOutput = new Map<string, string>();
  for (const ref of task.inputs) {
    const previous = byOutput.get(ref.outputId);
    if (previous !== undefined && previous !== refKey(ref)) state.ambiguousOutputIds.add(ref.outputId);
    byOutput.set(ref.outputId, refKey(ref));
    state.outputIds.add(ref.outputId);
    state.references.set(refKey(ref), ref);
  }
}

function validateNeedOutputs(task: Task, state: TaskValidationState): void {
  for (let index = 0; index < task.needs.length; index += 1) {
    const need = task.needs[index]!;
    if (need.outputId === undefined) continue;
    if (!state.outputIds.has(need.outputId))
      taskFailure(state, 'task.operation-output', 'The operation refers to an output absent from this task.', [
        'needs',
        index,
        'outputId',
      ]);
    if (state.ambiguousOutputIds.has(need.outputId))
      taskFailure(
        state,
        'task.output-ambiguous',
        'The operation target matches different result handles; use named reuse outputs to disambiguate.',
        ['needs', index, 'outputId'],
      );
  }
}

/** Structure only: catalog binding, result authorization and grain semantics are later passes. */
export function inspectTaskStructure(input: unknown): Outcome<TaskStructure> {
  const parsed = parseTask(input);
  if (!parsed.ok) return parsed;
  const task = parsed.value;
  const state: TaskValidationState = {
    diagnostics: [],
    outputIds: new Set<string>(),
    ambiguousOutputIds: new Set<string>(),
    references: new Map<string, ResultRef>(),
    order: [],
  };
  validateNeedIdentities(task, state);
  if (task.kind === 'data') validateDataTask(task, state);
  if (task.kind === 'presentation') validatePresentationTask(task, state);
  validateNeedOutputs(task, state);
  if (state.diagnostics.length > 0)
    return { ok: false, diagnostics: state.diagnostics as [Diagnostic, ...Diagnostic[]] };
  return { ok: true, value: { task, outputOrder: state.order, resultReferences: [...state.references.values()] } };
}
