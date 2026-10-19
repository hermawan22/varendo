import { WIRE_LIMITS, compileIntent, parseIntent, parseTask } from '@varendo/core';
import type { Intent, Outcome, Task } from '@varendo/core';
import { createTaskEvaluator } from '../evaluation/task.js';
import type { MaterializedTaskOutput, TaskEvaluation } from '../evaluation/types.js';
import type { RegionHandle, RegionOutcome, RegionSnapshot, RegionStore } from '../regions/types.js';
import type {
  VarendoRuntimeOptions,
  AppAuthorityContext,
  RuntimeCommittedReceipt,
  RuntimeRenderInput,
  RuntimeRenderOptions,
  RuntimeRenderPreparation,
  RuntimePreparedRender,
  RuntimeRenderReceipt,
} from './types.js';
import type { MountedRegion } from './runtime-state.js';
import { diagnostic, linkedSignal, statusFor, uniqueRefs } from './runtime-state.js';
import type { RuntimeResourceBinding } from './types.js';
import { frozen } from '../regions/region-contracts.js';
import { applyPrepared, preparedRender } from './render-projection.js';
import { readSourceRevisionPin } from '../data/local/source-pin.js';

export interface RuntimeRenderHost {
  readonly regions: RegionStore;
  readonly evaluator: ReturnType<typeof createTaskEvaluator>;
  readonly intents: VarendoRuntimeOptions['intents'];
  getSlot(regionId: string): MountedRegion | undefined;
  getResource(slot: MountedRegion): RuntimeResourceBinding | undefined;
  preparePrincipal(slot: MountedRegion, signal: AbortSignal): Outcome<AppAuthorityContext>;
  setState(slot: MountedRegion, state: MountedRegion['state']): void;
  recoverState(
    slot: MountedRegion,
    state: MountedRegion['state'],
    authority: AppAuthorityContext,
    sequence: number,
  ): Outcome<void>;
  failReceipt(
    slot: MountedRegion,
    sequence: number,
    requestId: string,
    diagnostics: RuntimeRenderReceipt['diagnostics'],
    task?: Task,
  ): RuntimeRenderReceipt;
}

interface CompiledIntent {
  readonly intent: Intent;
  readonly task: Task;
}

interface EvaluationOutput {
  readonly outputs: readonly MaterializedTaskOutput[];
  readonly evaluation?: TaskEvaluation;
}

export type RuntimeRenderPrepare = NonNullable<RuntimeRenderOptions['prepare']>;

interface RenderRequest {
  readonly slot: MountedRegion;
  readonly beforeState: MountedRegion['state'];
  readonly sequence: number;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  cleanup(): void;
  evaluation?: TaskEvaluation;
  outputs?: readonly MaterializedTaskOutput[];
  authority?: AppAuthorityContext;
}

export class RuntimeRenderCoordinator {
  private readonly host: RuntimeRenderHost;
  private readonly requests = new WeakMap<MountedRegion, RenderRequest>();

  constructor(host: RuntimeRenderHost) {
    this.host = host;
  }

  async render(input: RuntimeRenderInput, prepare?: RuntimeRenderPrepare): Promise<RuntimeRenderReceipt> {
    const slot = this.host.getSlot(input.regionId);
    if (slot === undefined) return this.notMounted(input.regionId);
    const request = this.beginRequest(slot, input.signal);
    try {
      const result = await this.execute(input, request, prepare);
      return result;
    } catch {
      return this.host.failReceipt(slot, request.sequence, request.requestId, [
        diagnostic('runtime.render-failed', 'The render pipeline failed safely.'),
      ]);
    } finally {
      this.finishRequest(request);
    }
  }

  checkPublication(slot: MountedRegion): RegionOutcome<void> {
    const request = this.requests.get(slot);
    return request?.outputs === undefined
      ? { ok: true, value: undefined }
      : this.sequenceCheck(slot, request.sequence, request.outputs);
  }

  private notMounted(regionId: string): RuntimeRenderReceipt {
    const requestId = `render-${regionId}`.slice(0, WIRE_LIMITS.id);
    return {
      status: 'failed',
      requestId,
      regionId,
      diagnostics: [diagnostic('runtime.mount-missing', 'Mount the Region before rendering.')],
    };
  }

  private beginRequest(slot: MountedRegion, parent?: AbortSignal): RenderRequest {
    const requestId = `render-${slot.regionId}-${++slot.sequence}`.slice(0, WIRE_LIMITS.id);
    slot.active?.abort();
    slot.pendingRefs = [];
    const linked = linkedSignal(parent);
    slot.active = linked.controller;
    const beforeState = slot.state;
    this.host.setState(slot, {
      regionId: slot.regionId,
      resourceId: slot.resourceId,
      phase: 'rendering',
      requestId,
      results: slot.refs,
      diagnostics: [],
      ...(this.host.regions.get(slot.regionId) === undefined
        ? {}
        : { region: this.host.regions.get(slot.regionId)!.snapshot() }),
    });
    const request = {
      slot,
      beforeState,
      sequence: slot.sequence,
      requestId,
      signal: linked.controller.signal,
      controller: linked.controller,
      cleanup: linked.cleanup,
    };
    this.requests.set(slot, request);
    return request;
  }

  private finishRequest(request: RenderRequest): void {
    if (this.requests.get(request.slot) === request) this.requests.delete(request.slot);
    if (request.slot.sequence === request.sequence) request.slot.pendingRefs = [];
    request.evaluation?.release();
    request.cleanup();
    if (request.slot.active === request.controller) delete request.slot.active;
  }

  private async execute(
    input: RuntimeRenderInput,
    request: RenderRequest,
    prepare?: RuntimeRenderPrepare,
  ): Promise<RuntimeRenderReceipt> {
    const { slot, sequence, requestId, signal } = request;
    const authority = this.host.preparePrincipal(slot, signal);
    if (!authority.ok) return this.fail(slot, sequence, requestId, authority.diagnostics);
    request.authority = { ...authority.value };
    const compiled = this.compile(input, slot, sequence);
    if (!compiled.ok) return this.fail(slot, sequence, requestId, compiled.diagnostics);
    const evaluated = await this.evaluate(compiled.value.task, signal);
    if (!evaluated.ok) return this.fail(slot, sequence, requestId, evaluated.diagnostics, compiled.value.task);
    if (evaluated.value.evaluation !== undefined) request.evaluation = evaluated.value.evaluation;
    if (this.isCancelled(request)) return this.cancelled(slot, sequence, requestId, compiled.value.task);
    return this.commitTask(request, compiled.value, evaluated.value.outputs, prepare);
  }

  private compile(input: RuntimeRenderInput, slot: MountedRegion, sequence: number): Outcome<CompiledIntent> {
    const intent = parseIntent(input.intent);
    if (!intent.ok) return intent;
    const binding = this.host.getResource(slot);
    if (binding === undefined) return this.invalidResource();
    const compiled = compileIntent(intent.value, {
      resource: binding.resource,
      regionId: slot.regionId,
      taskRevision: String(sequence),
      ...(this.host.intents === undefined ? {} : { customIntents: this.host.intents }),
    });
    if (!compiled.ok) return compiled;
    return { ok: true, value: { intent: intent.value, task: compiled.value } };
  }

  private invalidResource(): Outcome<never> {
    return {
      ok: false,
      diagnostics: [diagnostic('runtime.render-resource', 'The mounted resource binding is unavailable.')],
    };
  }

  private evaluate(task: Task, signal: AbortSignal): Promise<Outcome<EvaluationOutput>> {
    if (task.kind !== 'data') return Promise.resolve({ ok: true, value: { outputs: [] } });
    return this.host.evaluator.evaluate({ task, signal }).then((result) => {
      if (!result.ok) return result;
      return { ok: true, value: { outputs: result.value.outputs, evaluation: result.value } };
    });
  }

  private isCancelled(request: RenderRequest): boolean {
    return request.signal.aborted || request.sequence !== request.slot.sequence;
  }

  private cancelled(slot: MountedRegion, sequence: number, requestId: string, task: Task): RuntimeRenderReceipt {
    return this.fail(
      slot,
      sequence,
      requestId,
      [diagnostic('runtime.render-cancelled', 'A newer render replaced this request.')],
      task,
    );
  }

  private fail(
    slot: MountedRegion,
    sequence: number,
    requestId: string,
    diagnostics: RuntimeRenderReceipt['diagnostics'],
    task?: Task,
  ): RuntimeRenderReceipt {
    return this.host.failReceipt(slot, sequence, requestId, diagnostics, task);
  }

  private async commitTask(
    request: RenderRequest,
    compiled: CompiledIntent,
    outputs: readonly MaterializedTaskOutput[],
    prepare?: RuntimeRenderPrepare,
  ): Promise<RuntimeRenderReceipt> {
    const { slot, sequence, requestId } = request;
    request.outputs = outputs;
    const region = this.ensureRegion(request, compiled.task);
    if (!region.ok) return this.fail(slot, sequence, requestId, region.diagnostics, compiled.task);
    const before = region.value.snapshot();
    if (before.readSet === undefined)
      return this.fail(
        slot,
        sequence,
        requestId,
        [diagnostic('runtime.region-stale', 'The Region has no active read set.')],
        compiled.task,
      );
    // A new Region starts with committed dependencies, never this unpublished candidate's results.
    slot.pendingRefs = outputs.map((output) => output.ref);
    const current = frozen({
      ...before.readSet,
      results: uniqueRefs([...before.readSet.results, ...slot.pendingRefs]),
    });
    const prepared = await this.prepareRender(prepare, {
      requestId,
      regionId: slot.regionId,
      intent: compiled.intent,
      task: frozen({ ...compiled.task, revision: current.taskRevision }),
      region: before,
      outputs,
      signal: request.signal,
      current,
    });
    if (!prepared.ok) return this.rejectPreparation(request, compiled.task, prepared.diagnostics);
    const projection = prepared.value || undefined;
    let published = false;
    try {
      if (this.isCancelled(request))
        return this.rejectPreparation(request, compiled.task, [
          diagnostic('runtime.render-cancelled', 'The render was cancelled before publication.'),
        ]);
      const committed = await this.stageRender(request, region.value, compiled.task, outputs, current, projection);
      if (!committed.ok) {
        projection?.rollback();
        return this.rejectPreparation(request, compiled.task, committed.diagnostics);
      }
      published = true;
      return this.publishCommit(slot, requestId, compiled, outputs, committed.value);
    } finally {
      if (!published) projection?.rollback();
    }
  }

  private async prepareRender(
    prepare: RuntimeRenderPrepare | undefined,
    input: RuntimeRenderPreparation,
  ): Promise<Outcome<void | RuntimePreparedRender>> {
    if (prepare === undefined) return { ok: true, value: undefined };
    try {
      return preparedRender(await prepare(input));
    } catch {
      return {
        ok: false,
        diagnostics: [diagnostic('runtime.projection-failed', 'The pre-publication preparation failed.')],
      };
    }
  }

  private async stageRender(
    request: RenderRequest,
    region: RegionHandle,
    task: Task,
    outputs: readonly MaterializedTaskOutput[],
    current: RuntimeRenderPreparation['current'],
    projection: RuntimePreparedRender | undefined,
  ): Promise<RegionOutcome<RegionSnapshot>> {
    const staged = await region.stage({
      requestId: request.requestId,
      expected: current,
      state: {
        task,
        ...(projection === undefined
          ? {}
          : {
              presentation: projection.presentation,
              ...(projection.interaction === undefined ? {} : { interaction: projection.interaction }),
            }),
      },
      resultHandles: outputs.map((output) => output.handle),
    });
    if (!staged.ok) return staged;
    return region.commit(staged.value, {
      signal: request.signal,
      recheck: (next) => {
        const checked = this.sequenceCheck(request.slot, request.sequence, outputs);
        if (!checked.ok) return checked;
        if (next === undefined)
          return {
            ok: false,
            diagnostics: [diagnostic('runtime.region-stale', 'The prospective Region is unavailable.')],
          };
        const applied = applyPrepared(projection, next);
        if (!applied.ok) return applied;
        return this.sequenceCheck(request.slot, request.sequence, outputs);
      },
    });
  }

  private rejectPreparation(
    request: RenderRequest,
    task: Task,
    diagnostics: RuntimeRenderReceipt['diagnostics'],
  ): RuntimeRenderReceipt {
    const { slot, sequence, requestId } = request;
    if (slot.sequence !== sequence || this.host.getSlot(slot.regionId) !== slot)
      return { status: 'cancelled', requestId, regionId: slot.regionId, diagnostics, task };
    if (request.authority !== undefined) {
      const recovered = this.host.recoverState(slot, request.beforeState, request.authority, sequence);
      if (!recovered.ok) return this.fail(slot, sequence, requestId, recovered.diagnostics);
    }
    return { status: statusFor(diagnostics), requestId, regionId: slot.regionId, diagnostics, task };
  }

  private ensureRegion(request: RenderRequest, task: Task): RegionOutcome<RegionHandle> {
    const current = this.host.regions.get(request.slot.regionId);
    if (current !== undefined) return { ok: true, value: current };
    const seedTask = parseTask({ ...task, revision: String(Math.max(0, request.sequence - 1)) });
    if (!seedTask.ok) return seedTask;
    return this.host.regions.create({ id: request.slot.regionId, state: { task: seedTask.value } });
  }

  private sequenceCheck(
    slot: MountedRegion,
    sequence: number,
    outputs: readonly MaterializedTaskOutput[],
  ): RegionOutcome<void> {
    if (slot.sequence !== sequence || this.host.getSlot(slot.regionId) !== slot)
      return {
        ok: false,
        diagnostics: [diagnostic('runtime.render-cancelled', 'A newer render replaced this request.')],
      };
    const binding = this.host.getResource(slot);
    const sourceRevision = binding === undefined ? { kind: 'absent' as const } : readSourceRevisionPin(binding.data);
    if (sourceRevision.kind === 'invalid')
      return {
        ok: false,
        diagnostics: [diagnostic('runtime.render-stale', 'The local source revision could not be verified.')],
      };
    if (
      sourceRevision.kind === 'current' &&
      outputs.some((output) => output.handle.key.sourceRevision !== sourceRevision.value)
    )
      return {
        ok: false,
        diagnostics: [diagnostic('runtime.render-stale', 'A local source changed before Region publication.')],
      };
    return {
      ok: true,
      value: undefined,
    };
  }

  private publishCommit(
    slot: MountedRegion,
    requestId: string,
    compiled: CompiledIntent,
    outputs: readonly MaterializedTaskOutput[],
    region: RegionSnapshot,
  ): RuntimeRenderReceipt {
    slot.refs = uniqueRefs(region.readSet?.results ?? slot.pendingRefs);
    slot.pendingRefs = [];
    const task = region.state?.task ?? compiled.task;
    const receipt: RuntimeCommittedReceipt = {
      status: 'committed',
      requestId,
      regionId: slot.regionId,
      diagnostics: [],
      intent: compiled.intent,
      task,
      outputs,
      region,
    };
    this.host.setState(slot, {
      regionId: slot.regionId,
      resourceId: slot.resourceId,
      phase: 'committed',
      requestId,
      task,
      results: slot.refs,
      diagnostics: [],
      region,
    });
    return receipt;
  }
}
