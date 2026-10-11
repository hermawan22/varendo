import { validateTaskStructure } from '@varendo/core';
import type { Outcome, QuerySpec, ResultRef, Task } from '@varendo/core';
import type { AcceptedQuery, PlanAcceptance, PlanRequest, ReadContext } from '../data/types.js';
import { readSourceRevisionPin } from '../data/local/source-pin.js';
import type { ResultHandle, ResultLease } from '../results/types.js';
import { createResultCohortResolver } from './cohort.js';
import type {
  CohortRequest,
  CohortResolver,
  CohortResolverContext,
  MaterializedTaskOutput,
  TaskEvaluation,
  TaskEvaluationInput,
  TaskEvaluatorOptions,
  TrustedEvaluationContext,
} from './types.js';
import {
  DEFAULT_BUDGET,
  aborted,
  budgetFor,
  contextRead,
  createDeadline,
  failure,
  grant,
  localResolver,
  materializedOutput,
  outputFailure,
  readyOutputSnapshot,
  remaining,
  resolveContextResult,
  reuseAuthorityMatches,
  safeRequestId,
  selectOutputs,
  sameRef,
  trustedEquivalent,
  type OutputSelection,
  type TaskOutput,
} from './task-support.js';

type ValidTaskStructure = Extract<ReturnType<typeof validateTaskStructure>, { readonly ok: true }>['value'];
type ReuseOutput = Extract<TaskOutput, { readonly kind: 'reuse' }>;
type QueryOutput = Extract<TaskOutput, { readonly kind: 'query' }>;

let evaluationSequence = 0;

export class TaskEvaluationSession {
  private readonly options: TaskEvaluatorOptions;
  private readonly input: TaskEvaluationInput;
  private readonly sequence: number;
  private readonly deadline: ReturnType<typeof createDeadline>;
  private readonly onFinished: () => void;
  private readonly owned = new Set<ResultHandle>();
  private readonly leases: ResultLease[] = [];
  private readonly materialized = new Map<string, MaterializedTaskOutput>();
  private context: TrustedEvaluationContext | undefined;
  private resolver: CohortResolver | undefined;
  private selection: OutputSelection | undefined;
  private published = false;
  private released = false;

  constructor(options: TaskEvaluatorOptions, input: TaskEvaluationInput, onFinished: () => void) {
    this.options = options;
    this.input = input;
    this.sequence = ++evaluationSequence;
    this.onFinished = onFinished;
    const milliseconds = input.deadlineMs ?? options.maxMilliseconds ?? DEFAULT_BUDGET.maxMilliseconds;
    this.deadline = createDeadline(input.signal, milliseconds, () => Date.now());
  }

  async run(): Promise<Outcome<TaskEvaluation>> {
    try {
      return await this.evaluate();
    } catch {
      this.clearOwned();
      return failure('runtime.evaluation-failed', 'The bounded task evaluation failed.');
    } finally {
      if (!this.published) this.clearOwned();
      this.deadline.cleanup();
      this.onFinished();
    }
  }

  private async evaluate(): Promise<Outcome<TaskEvaluation>> {
    const structure = validateTaskStructure(this.input.task);
    if (!structure.ok) return structure;
    if (this.input.task.kind !== 'data')
      return failure('runtime.evaluation-unsupported', 'Only data Tasks have executable output DAGs.');
    const context = await this.readContext(structure.value);
    if (!context.ok) return context;
    this.context = context.value;
    const checked = this.checkInitialAuthority();
    if (!checked.ok) return checked;
    const selection = selectOutputs(this.input.task, this.input.requestedOutputs);
    if (!selection.ok) return selection;
    this.selection = selection.value;
    const inspect = this.checkInspectGrant(selection.value.requiresInspect);
    if (!inspect.ok) return inspect;
    this.resolver = this.chooseResolver();
    const materialized = await this.materializeOutputs(structure.value.outputOrder);
    if (!materialized.ok) return materialized;
    const authority = await this.verifyPublication(structure.value.task);
    if (!authority.ok) return authority;
    return this.publish(structure.value.task, structure.value.outputOrder);
  }

  private async readContext(structure: ValidTaskStructure): Promise<Outcome<TrustedEvaluationContext>> {
    return this.options.host.readContext({ signal: this.deadline.signal, task: structure.task });
  }

  private contextValue(): TrustedEvaluationContext {
    if (this.context === undefined) throw new Error('Task evaluation context is unavailable.');
    return this.context;
  }

  private checkInitialAuthority(): Outcome<void> {
    const context = this.contextValue();
    const active = aborted(this.deadline.signal, this.deadline.deadlineAt, context.now);
    if (active !== undefined) return active;
    return grant(context, 'task.evaluate');
  }

  private checkInspectGrant(required: boolean): Outcome<void> {
    if (!required || this.contextValue().grants.includes('result.inspect')) return { ok: true, value: undefined };
    return failure(
      'runtime.evaluation-denied',
      'The host did not grant result inspection for the selected cohort or reused output.',
    );
  }

  private chooseResolver(): CohortResolver {
    const context = this.contextValue();
    return (
      context.cohortResolver ??
      this.options.cohortResolver ??
      localResolver(context.data) ??
      createResultCohortResolver()
    );
  }

  private resolveResult(ref: ResultRef): ResultHandle | undefined {
    return resolveContextResult(this.materialized, this.contextValue(), ref);
  }

  private cohortCapability(): NonNullable<ReadContext['cohort']> {
    const context = this.contextValue();
    return {
      principalKey: context.principalKey,
      resolver: this.resolver!,
      resultStore: context.resultStore,
      resolveResult: (ref) => this.resolveResult(ref),
    };
  }

  private resolverContext(): CohortResolverContext {
    const context = this.contextValue();
    return {
      readContext: contextRead(context, this.deadline.signal),
      principalKey: context.principalKey,
      scopeDigest: context.scopeDigest,
      ...(context.policyRevision === undefined ? {} : { policyRevision: context.policyRevision }),
      catalogRevision: context.catalogRevision,
      functionRegistryDigest: context.functionRegistryDigest,
      grants: context.grants,
      catalog: context.catalog,
      resultStore: context.resultStore,
      resolveResult: (ref) => this.resolveResult(ref),
      now: context.now,
    };
  }

  private async bindLivePopulation(query: QuerySpec): Promise<Outcome<QuerySpec>> {
    if (query.population.kind !== 'live-output') return { ok: true, value: query };
    const context = this.contextValue();
    const inspect = grant(context, 'result.inspect');
    if (!inspect.ok) return inspect;
    const upstream = this.materialized.get(query.population.outputId);
    if (upstream === undefined)
      return failure('runtime.evaluation-dependency', 'The live cohort upstream output was not materialized.', [
        'population',
        'outputId',
      ]);
    const entity = context.catalog.entities.find((candidate) => candidate.id === query.entity);
    const request: CohortRequest = {
      source: upstream.ref,
      identityKeys: query.population.identityKeys,
      ...(entity === undefined ? {} : { targetGrain: entity.rowGrain }),
      scopeDigest: context.scopeDigest,
      ...(context.policyRevision === undefined ? {} : { policyRevision: context.policyRevision }),
      catalogRevision: context.catalogRevision,
      sourceRevision: upstream.ref.revision,
      deadlineAt: this.deadline.deadlineAt,
      signal: this.deadline.signal,
    };
    const membership = await this.resolver!.resolve(request, this.resolverContext());
    if (!membership.ok) return membership;
    return {
      ok: true,
      value: {
        ...query,
        population: {
          kind: 'fixed',
          source: membership.value.source,
          identityKeys: [...membership.value.identityKeys] as [string, ...string[]],
          cohortDigest: membership.value.tupleDigest,
        },
      },
    };
  }

  private async materializeOutputs(order: readonly string[]): Promise<Outcome<void>> {
    const selection = this.selection!;
    for (const outputId of order) {
      if (!selection.selected.has(outputId)) continue;
      const state = aborted(this.deadline.signal, this.deadline.deadlineAt, this.contextValue().now);
      if (state !== undefined) return state;
      const output = selection.outputById.get(outputId);
      if (output === undefined) return failure('runtime.evaluation-dependency', 'A selected Task output disappeared.');
      const outcome =
        output.kind === 'reuse' ? await this.materializeReuse(output) : await this.materializeQuery(output);
      if (!outcome.ok) return outcome;
    }
    return { ok: true, value: undefined };
  }

  private async materializeReuse(output: ReuseOutput): Promise<Outcome<void>> {
    const context = this.contextValue();
    const inspect = grant(context, 'result.inspect');
    if (!inspect.ok) return inspect;
    const handle = this.resolveReuse(output.result);
    if (!handle.ok) return handle;
    const lease = this.retainReuse(handle.value);
    if (!lease.ok) return lease;
    this.leases.push(lease.value);
    if (lease.value.released)
      return failure('runtime.evaluation-denied', 'The reused output is no longer available.', ['outputs', output.id]);
    const snapshot = handle.value.snapshot();
    if (snapshot.descriptor === undefined || !sameRef(snapshot.descriptor.ref, output.result))
      return failure(
        'runtime.evaluation-stale',
        'The reused result descriptor does not match its immutable reference.',
        ['outputs', output.id],
      );
    if (!reuseAuthorityMatches(handle.value, context))
      return failure('runtime.evaluation-denied', 'The reused result is outside the current authority pins.', [
        'outputs',
        output.id,
      ]);
    this.materialized.set(output.id, materializedOutput(output.id, 'reuse', handle.value, snapshot));
    return { ok: true, value: undefined };
  }

  private resolveReuse(ref: ResultRef): Outcome<ResultHandle> {
    try {
      const handle = this.contextValue().resolveResult(ref);
      if (handle !== undefined) return { ok: true, value: handle };
    } catch {
      return failure('runtime.evaluation-denied', 'The host result resolver failed for a reused output.');
    }
    return failure('runtime.evaluation-denied', 'The reused output is not a host-owned live result.', [
      'outputs',
      ref.outputId,
    ]);
  }

  private retainReuse(handle: ResultHandle): Outcome<ResultLease> {
    try {
      return { ok: true, value: handle.retain() };
    } catch {
      return failure('runtime.evaluation-denied', 'The reused output could not be retained.', ['outputs']);
    }
  }

  private async materializeQuery(output: QueryOutput): Promise<Outcome<void>> {
    const bound = await this.bindLivePopulation(output.query);
    if (!bound.ok) return bound;
    const request = this.planRequest(output, bound.value);
    const context = this.contextValue();
    const planned = await context.data.plan(
      request,
      contextRead(context, this.deadline.signal, this.cohortCapability()),
    );
    if (!planned.ok) return planned;
    const accepted = planned.value;
    if (!this.acceptedPlanMatches(accepted, output))
      return failure('runtime.evaluation-stale', 'Data plan scope or policy differs from the app authority.');
    const handle = this.allocateHandle(accepted, request.requestId);
    if (!handle.ok) return handle;
    const consumed = await this.consumeResult(handle.value, accepted);
    if (!consumed.ok) return consumed;
    const snapshot = readyOutputSnapshot(handle.value);
    if (!snapshot.ok) return snapshot;
    this.materialized.set(output.id, materializedOutput(output.id, 'query', handle.value, snapshot.value, accepted));
    return { ok: true, value: undefined };
  }

  private planRequest(output: QueryOutput, query: QuerySpec): PlanRequest {
    const context = this.contextValue();
    return {
      version: '1',
      requestId: safeRequestId(this.sequence, output.id),
      catalogRevision: context.catalogRevision,
      target: { taskId: this.input.task.id, outputId: output.id },
      query,
      budget: budgetFor(context, this.options, remaining(this.deadline.deadlineAt, context.now)),
    };
  }

  private acceptedPlanMatches(accepted: PlanAcceptance, output: QueryOutput): boolean {
    const context = this.contextValue();
    return (
      accepted.catalogRevision === context.catalogRevision &&
      accepted.scopeDigest === context.scopeDigest &&
      accepted.functionRegistryDigest === context.functionRegistryDigest &&
      accepted.policyRevision === context.policyRevision &&
      accepted.target.taskId === this.input.task.id &&
      accepted.target.outputId === output.id
    );
  }

  private allocateHandle(accepted: PlanAcceptance, requestId: string): Outcome<ResultHandle> {
    const context = this.contextValue();
    try {
      const handle = context.resultStore.begin({
        principalKey: context.principalKey,
        scopeDigest: context.scopeDigest,
        ...(accepted.policyRevision === undefined ? {} : { policyRevision: accepted.policyRevision }),
        populationDigest: accepted.populationDigest,
        queryDigest: accepted.queryDigest,
        catalogRevision: accepted.catalogRevision,
        functionRegistryDigest: accepted.functionRegistryDigest,
        sourceRevision: accepted.sourceRevision,
        sourceLineage: accepted.sourceLineage,
        planDigest: accepted.planDigest,
        resultShape: accepted.resultShape,
        lineageDigest: accepted.lineageDigest,
        outputId: accepted.target.outputId,
        taskId: accepted.target.taskId,
        requestId,
      });
      this.owned.add(handle);
      return { ok: true, value: handle };
    } catch {
      return failure('runtime.evaluation-budget', 'The result store could not allocate the task output.');
    }
  }

  private async consumeResult(handle: ResultHandle, accepted: AcceptedQuery): Promise<Outcome<void>> {
    const context = this.contextValue();
    const subscription = handle.subscribe(
      context.data.execute(accepted, contextRead(context, this.deadline.signal, this.cohortCapability())),
      { signal: this.deadline.signal },
    );
    try {
      for await (const update of subscription) {
        const state = aborted(this.deadline.signal, this.deadline.deadlineAt, context.now);
        if (state !== undefined) {
          subscription.cancel();
          return state;
        }
        const invalid = outputFailure(update.snapshot);
        if (invalid !== undefined) {
          subscription.cancel();
          return invalid;
        }
      }
    } catch {
      subscription.cancel();
      return failure('runtime.evaluation-failed', 'The data service result stream could not be materialized.');
    }
    return { ok: true, value: undefined };
  }

  private async verifyPublication(task: Task): Promise<Outcome<void>> {
    const context = this.contextValue();
    const finalHost = await this.options.host.readContext({ signal: this.deadline.signal, task });
    if (!finalHost.ok) return finalHost;
    if (
      !trustedEquivalent(context, finalHost.value) ||
      !finalHost.value.grants.includes('task.evaluate') ||
      (this.selection!.requiresInspect && !finalHost.value.grants.includes('result.inspect'))
    )
      return failure('runtime.evaluation-stale', 'Task authority changed before the evaluation could be published.');
    const sourceRevision = readSourceRevisionPin(finalHost.value.data);
    if (sourceRevision.kind === 'invalid')
      return failure('runtime.evaluation-stale', 'The local source revision could not be verified before publication.');
    if (
      sourceRevision.kind === 'current' &&
      [...this.materialized.values()].some((output) => output.handle.key.sourceRevision !== sourceRevision.value)
    )
      return failure('runtime.evaluation-stale', 'A local source changed before task publication.');
    return { ok: true, value: undefined };
  }

  private publish(task: Task, order: readonly string[]): Outcome<TaskEvaluation> {
    const outputs = order.filter((id) => this.materialized.has(id)).map((id) => this.materialized.get(id)!);
    this.published = true;
    return {
      ok: true,
      value: {
        task,
        outputs: Object.freeze(outputs),
        get: (id) => this.materialized.get(id),
        release: () => this.release(),
      },
    };
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    for (const lease of this.leases.splice(0)) lease.release();
    for (const handle of this.owned) {
      try {
        handle.release();
      } catch {
        // Ownership release is best effort after publication.
      }
    }
    this.owned.clear();
  }

  private clearOwned(): void {
    for (const handle of this.owned) {
      try {
        handle.dispose();
      } catch {
        // Disposal is best effort after authorization has changed.
      }
    }
    this.owned.clear();
    for (const lease of this.leases.splice(0)) lease.release();
  }
}
