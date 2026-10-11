import type { Diagnostic, Outcome, ResultRef, Task } from '@varendo/core';
import { WIRE_LIMITS } from '@varendo/core';
import type { CohortResolver } from './types.js';
import type { DataService, QueryBudget, ReadContext } from '../data/types.js';
import type { ResultHandle, ResultSnapshot, ResultStatus } from '../results/types.js';
import type { MaterializedTaskOutput, TaskEvaluatorOptions, TrustedEvaluationContext } from './types.js';

export const DEFAULT_BUDGET: QueryBudget = Object.freeze({
  maxRows: 10_000,
  maxBytes: WIRE_LIMITS.bytes,
  maxMessages: 64,
  maxMilliseconds: 30_000,
  maxColumns: 128,
});

type FailureDiagnostic = Extract<Outcome<never>, { readonly ok: false }>;
export type FailureOutcome = Extract<Outcome<void>, { readonly ok: false }>;
export type ExecutableTask = Extract<Task, { readonly kind: 'data' }>;
export type TaskOutput = ExecutableTask['outputs'][number];

export interface OutputSelection {
  readonly outputById: ReadonlyMap<string, TaskOutput>;
  readonly selected: ReadonlySet<string>;
  readonly requiresInspect: boolean;
}

export function failure<T = never>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  const diagnostic: Diagnostic = {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path: [...path] }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

function failed(code: string, message: string): FailureDiagnostic {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
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

export function safeRequestId(counter: number, outputId: string): string {
  const value = `task-evaluation-${counter}-${outputId}`;
  return value.length <= WIRE_LIMITS.id ? value : value.slice(0, WIRE_LIMITS.id);
}

export function grant(context: TrustedEvaluationContext, name: string): Outcome<void> {
  if (context.grants.includes(name)) return { ok: true, value: undefined };
  return failure('runtime.evaluation-denied', `The host did not grant ${name}.`);
}

export function budgetFor(
  context: TrustedEvaluationContext,
  options: TaskEvaluatorOptions,
  remaining: number,
): QueryBudget {
  const configured = context.budget ?? options.budget ?? DEFAULT_BUDGET;
  return Object.freeze({
    maxRows: Math.max(1, Math.min(DEFAULT_BUDGET.maxRows, configured.maxRows)),
    maxBytes: Math.max(1, Math.min(DEFAULT_BUDGET.maxBytes, configured.maxBytes)),
    maxMessages: Math.max(3, Math.min(DEFAULT_BUDGET.maxMessages, configured.maxMessages)),
    maxMilliseconds: Math.max(
      1,
      Math.min(DEFAULT_BUDGET.maxMilliseconds, configured.maxMilliseconds, Math.floor(remaining)),
    ),
    maxColumns: Math.max(1, Math.min(DEFAULT_BUDGET.maxColumns, configured.maxColumns)),
  });
}

export interface EvaluationDeadline {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  cleanup(): void;
}

export function createDeadline(
  parent: AbortSignal | undefined,
  milliseconds: number,
  now: () => number,
): EvaluationDeadline {
  const bounded = Math.max(1, Math.min(86_400_000, Math.floor(milliseconds)));
  const controller = new AbortController();
  const deadlineAt = now() + bounded;
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), bounded);
  const onAbort = (): void => controller.abort();
  parent?.addEventListener('abort', onAbort, { once: true });
  if (parent?.aborted === true) controller.abort();
  return {
    signal: controller.signal,
    deadlineAt,
    cleanup() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export function remaining(deadlineAt: number, now: () => number): number {
  const value = deadlineAt - now();
  return Number.isFinite(value) ? value : 0;
}

export function aborted(signal: AbortSignal, deadlineAt: number, now: () => number): FailureOutcome | undefined {
  if (signal.aborted) return failed('runtime.evaluation-cancelled', 'Task evaluation was cancelled.');
  if (remaining(deadlineAt, now) <= 0)
    return failed('runtime.evaluation-budget', 'Task evaluation exceeded its deadline.');
  return undefined;
}

export function contextRead(
  context: TrustedEvaluationContext,
  signal: AbortSignal,
  cohort?: ReadContext['cohort'],
): ReadContext {
  return { ...context.readContext, signal, ...(cohort === undefined ? {} : { cohort }) };
}

export function trustedEquivalent(left: TrustedEvaluationContext, right: TrustedEvaluationContext): boolean {
  return (
    left.principalKey === right.principalKey &&
    left.scopeDigest === right.scopeDigest &&
    left.policyRevision === right.policyRevision &&
    left.catalogRevision === right.catalogRevision &&
    left.functionRegistryDigest === right.functionRegistryDigest
  );
}

export function localResolver(data: DataService): CohortResolver | undefined {
  const candidate = data as DataService & { readonly cohortResolver?: CohortResolver };
  return candidate.cohortResolver;
}

export function resolveContextResult(
  materialized: ReadonlyMap<string, { readonly ref: ResultRef; readonly handle: ResultHandle }>,
  context: TrustedEvaluationContext,
  ref: ResultRef,
): ResultHandle | undefined {
  const output = materialized.get(ref.outputId);
  if (output !== undefined && sameRef(output.ref, ref)) return output.handle;
  return context.resolveResult(ref);
}

function addTaskDependencies(id: string, outputById: ReadonlyMap<string, TaskOutput>, selected: Set<string>): void {
  const output = outputById.get(id);
  if (output === undefined) return;
  for (const dependency of output.dependsOn) {
    if (selected.has(dependency)) continue;
    selected.add(dependency);
    addTaskDependencies(dependency, outputById, selected);
  }
}

function needsResultInspection(output: TaskOutput | undefined): boolean {
  if (output === undefined) return false;
  if (output.kind === 'reuse') return true;
  return output.query.population.kind !== 'all-authorized';
}

export function selectOutputs(task: ExecutableTask, explicit?: readonly string[]): Outcome<OutputSelection> {
  const outputById = new Map(task.outputs.map((output) => [output.id, output] as const));
  const selected = new Set<string>();
  const seeds =
    explicit ??
    task.outputs.filter((output) => output.kind === 'reuse' || output.delivery === 'eager').map((output) => output.id);
  for (const id of seeds) {
    if (!outputById.has(id))
      return failure('runtime.evaluation-invalid', `Requested output ${id} is absent from the Task.`, [
        'requestedOutputs',
      ]);
    selected.add(id);
  }
  for (const id of [...selected]) addTaskDependencies(id, outputById, selected);
  const requiresInspect = [...selected].some((id) => needsResultInspection(outputById.get(id)));
  return { ok: true, value: { outputById, selected, requiresInspect } };
}

export function reuseAuthorityMatches(handle: ResultHandle, context: TrustedEvaluationContext): boolean {
  return (
    handle.key.principalKey === context.principalKey &&
    handle.key.scopeDigest === context.scopeDigest &&
    handle.key.catalogRevision === context.catalogRevision &&
    handle.key.functionRegistryDigest === context.functionRegistryDigest &&
    handle.key.policyRevision === context.policyRevision
  );
}

const FAILURE_STATUSES: ReadonlySet<ResultStatus> = new Set(['failed', 'denied', 'unsupported', 'stale', 'cancelled']);

export function outputFailure(snapshot: ResultSnapshot): Outcome<never> | undefined {
  const status = snapshot.status;
  if (!FAILURE_STATUSES.has(status)) return undefined;
  const diagnostic = snapshot.diagnostics[0];
  return failure(diagnostic?.code ?? 'runtime.evaluation-failed', diagnostic?.message ?? 'The task output failed.');
}

export function readyOutputSnapshot(handle: ResultHandle): Outcome<ResultSnapshot> {
  const snapshot = handle.snapshot();
  if ((snapshot.status === 'ready' || snapshot.status === 'partial') && snapshot.descriptor !== undefined)
    return { ok: true, value: snapshot };
  const diagnostic = snapshot.diagnostics[0];
  return failure(
    diagnostic?.code ?? 'runtime.evaluation-failed',
    diagnostic?.message ?? 'The task output did not become a complete result.',
  );
}

export function materializedOutput(
  outputId: string,
  kind: MaterializedTaskOutput['kind'],
  handle: ResultHandle,
  snapshot: ResultSnapshot,
  accepted?: MaterializedTaskOutput['accepted'],
): MaterializedTaskOutput {
  const descriptor = snapshot.descriptor!;
  return {
    outputId,
    kind,
    ref: descriptor.ref,
    descriptor,
    handle,
    ...(accepted === undefined ? {} : { accepted }),
    lineage: descriptor.lineage.flatMap((entry) => entry.inputs),
  };
}
