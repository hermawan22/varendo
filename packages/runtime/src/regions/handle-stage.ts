import { validateCommitReadSet, WIRE_LIMITS } from '@varendo/core';
import type { ResultRef } from '@varendo/core';
import type { ResultHandle } from '../results/types.js';
import type {
  RegionAuthority,
  RegionCommitToken,
  RegionContent,
  RegionOutcome,
  RegionReadSet,
  RegionStageInput,
} from './types.js';
import {
  FAILURE,
  authorityReadSet,
  bindCandidateToReadSet,
  canonical,
  failure,
  frozen,
  interactionResultReferences,
  normalizeHostOutcome,
  normalizeRefs,
  refKey,
  requiredResultReferences,
  stripData,
  validateReadSet,
  validateState,
  validateAuthority,
  validId,
} from './region-contracts.js';
import {
  bindResultHandleToAuthority,
  releaseLeases,
  resultHandleGeneration,
  resultRefFromHandle,
  retainResultHandle,
} from './result-handles.js';
import type { OwnedResultLease } from './result-handles.js';
import { RegionHandleBase, type StageRecord } from './handle-base.js';

const TOKEN_MARKER = Symbol('varendo-region-token');

function isStageInputObject(value: unknown): value is RegionStageInput {
  return value !== null && typeof value === 'object';
}

interface ParsedStageInput {
  readonly requestId: string;
  readonly state: RegionContent;
  readonly expected: RegionReadSet;
  readonly handles: readonly ResultHandle[];
  readonly interactionWasExplicit: boolean;
}

interface StageContext extends ParsedStageInput {
  readonly epoch: number;
  readonly authority: RegionAuthority;
  readonly actual: RegionReadSet;
  readonly required: readonly ResultRef[];
  readonly declaredRequired: readonly ResultRef[];
}

interface RetainedStageHandle {
  readonly ref: ResultRef;
  readonly generation: number;
}

export class RegionStageHandle extends RegionHandleBase {
  protected currentAuthority(expectedEpoch = this.epoch): RegionOutcome<RegionAuthority> {
    if (typeof this.readAuthority !== 'function') return failure('runtime.region-denied', FAILURE.denied);
    try {
      const result = this.readAuthority(this.id);
      if (!this.live(expectedEpoch)) return this.closedOutcome();
      const normalized = normalizeHostOutcome<RegionAuthority>(result);
      if (!this.live(expectedEpoch)) return this.closedOutcome();
      if (!normalized.ok) return normalized as RegionOutcome<RegionAuthority>;
      return validateAuthority(normalized.value);
    } catch {
      if (!this.live(expectedEpoch)) return this.closedOutcome();
      return failure('runtime.region-denied', FAILURE.denied);
    }
  }

  private parseStageInput(input: RegionStageInput): RegionOutcome<ParsedStageInput> {
    if (!isStageInputObject(input)) return failure('runtime.region-invalid', FAILURE.invalid);
    const allowed = ['requestId', 'expected', 'state', 'resultHandles'];
    if (Object.keys(input).some((key) => !allowed.includes(key)) || !validId(input.requestId))
      return failure('runtime.region-invalid', FAILURE.invalid);
    let checkedState = validateState(input.state, this.id);
    if (!checkedState.ok) return checkedState;
    const interactionWasExplicit = checkedState.value.interaction !== undefined;
    // Layout/Task updates do not implicitly discard semantic controls or drafts.
    // Explicit controller transactions supply the replacement interaction state.
    if (checkedState.value.interaction === undefined && this.state?.interaction !== undefined) {
      checkedState = validateState({ ...checkedState.value, interaction: this.state.interaction }, this.id);
      if (!checkedState.ok) return checkedState;
    }
    const expected = validateReadSet(input.expected);
    if (!expected.ok) return expected;
    const binding = bindCandidateToReadSet(checkedState.value, expected.value);
    if (!binding.ok) return binding;
    return {
      ok: true,
      value: {
        requestId: input.requestId,
        state: checkedState.value,
        expected: expected.value,
        handles: input.resultHandles ?? [],
        interactionWasExplicit,
      },
    };
  }

  private prepareStage(input: ParsedStageInput, epoch: number): RegionOutcome<StageContext> {
    const authority = this.currentAuthority(epoch);
    if (!authority.ok) return authority as RegionOutcome<StageContext>;
    if (!this.live(epoch)) return this.closedOutcome();
    const actual = authorityReadSet(authority.value, this.taskRevision, this.regionRevision, this.dataRevision);
    const required = requiredResultReferences(input.state);
    const stateWithoutInteraction: RegionContent = {
      task: input.state.task,
      ...(input.state.presentation === undefined ? {} : { presentation: input.state.presentation }),
    };
    const declaredRequired = Object.freeze([
      ...requiredResultReferences(stateWithoutInteraction),
      ...(input.interactionWasExplicit ? [] : interactionResultReferences(input.state.interaction)),
    ]);
    if (!Array.isArray(input.handles) || input.handles.length > WIRE_LIMITS.array)
      return failure('runtime.region-budget', FAILURE.budget);
    return {
      ok: true,
      value: { ...input, epoch, authority: authority.value, actual, required, declaredRequired },
    };
  }

  private retainStageHandle(
    handle: ResultHandle,
    context: StageContext,
    leases: OwnedResultLease[],
  ): RegionOutcome<RetainedStageHandle> {
    const ref = resultRefFromHandle(handle);
    if (!ref.ok) return ref as RegionOutcome<RetainedStageHandle>;
    if (!this.live(context.epoch)) return this.closedOutcome();
    const binding = bindResultHandleToAuthority(handle, context.authority);
    if (!binding.ok) return binding as RegionOutcome<RetainedStageHandle>;
    if (!this.live(context.epoch)) return this.closedOutcome();
    const lease = retainResultHandle(handle);
    if (!lease.ok) return lease as RegionOutcome<RetainedStageHandle>;
    leases.push({ ref: ref.value, lease: lease.value });
    if (!this.live(context.epoch)) return this.closedOutcome();
    const generation = resultHandleGeneration(handle);
    if (!generation.ok) return generation as RegionOutcome<RetainedStageHandle>;
    if (!this.live(context.epoch)) return this.closedOutcome();
    return { ok: true, value: { ref: ref.value, generation: generation.value } };
  }

  private retainStageHandles(
    context: StageContext,
    leases: OwnedResultLease[],
    required: ResultRef[],
    generations: Map<string, number>,
  ): RegionOutcome<void> {
    for (const handle of context.handles) {
      const retained = this.retainStageHandle(handle, context, leases);
      if (!retained.ok) return retained;
      required.push(retained.value.ref);
      generations.set(refKey(retained.value.ref), retained.value.generation);
    }
    return { ok: true, value: undefined };
  }

  private createStageRecord(
    context: StageContext,
    leases: readonly OwnedResultLease[],
    required: readonly ResultRef[],
    generations: ReadonlyMap<string, number>,
  ): RegionOutcome<StageRecord> {
    if (context.expected.dataRevision !== context.actual.dataRevision)
      return failure('runtime.region-stale', FAILURE.stale);
    const priorCheck = validateCommitReadSet(
      stripData(context.expected),
      stripData(context.actual),
      context.declaredRequired,
    );
    if (!priorCheck.ok) return failure('runtime.region-stale', priorCheck.diagnostics[0]!.message);
    const capturedRefs = new Map<string, ResultRef>();
    for (const ref of context.expected.results) capturedRefs.set(refKey(ref), ref);
    for (const ref of required) capturedRefs.set(refKey(ref), ref);
    const capturedResults = normalizeRefs([...capturedRefs.values()], context.actual.scopeDigest);
    if (!capturedResults.ok) return capturedResults as RegionOutcome<StageRecord>;
    const checked = validateCommitReadSet(
      stripData({ ...context.expected, results: capturedResults.value }),
      stripData(context.actual),
      required,
    );
    if (!checked.ok) return failure('runtime.region-stale', checked.diagnostics[0]!.message);
    // Preserve only declared and candidate-required refs so unrelated host outputs do not stale this proposal.
    const capturedReadSet = frozen({ ...context.expected, results: capturedResults.value });
    const bytes =
      new TextEncoder().encode(canonical(context.state)).byteLength +
      new TextEncoder().encode(canonical(capturedReadSet)).byteLength;
    if (this.staged.size >= this.maxStagedCommits || this.stagedBytes + bytes > this.maxStagedBytes)
      return failure('runtime.region-budget', FAILURE.budget);
    const token = Object.freeze({ [TOKEN_MARKER]: true }) as unknown as RegionCommitToken;
    return {
      ok: true,
      value: {
        token,
        state: context.state,
        requestId: context.requestId,
        capturedReadSet,
        requiredResults: Object.freeze([...new Map(required.map((ref) => [refKey(ref), frozen({ ...ref })])).values()]),
        resultHandles: Object.freeze([...context.handles]),
        resultLeases: Object.freeze([...leases]),
        handleGenerations: generations,
        baseTaskRevision: this.taskRevision,
        baseRegionRevision: this.regionRevision,
        baseDataRevision: this.dataRevision,
        principalKey: context.authority.principalKey,
        bytes,
        consumed: false,
      },
    };
  }

  async stage(input: RegionStageInput): Promise<RegionOutcome<RegionCommitToken>> {
    if (this.status !== 'active') return this.closedOutcome();
    if (!this.authorizationConfigured) return failure('runtime.region-denied', FAILURE.denied);
    const stagedEpoch = this.epoch;
    const parsed = this.parseStageInput(input);
    if (!parsed.ok) return parsed;
    const context = this.prepareStage(parsed.value, stagedEpoch);
    if (!context.ok) return context as RegionOutcome<RegionCommitToken>;
    const generations = new Map<string, number>();
    const leases: OwnedResultLease[] = [];
    const required = [...context.value.required];
    let retainedForStage = false;
    try {
      const captured = this.retainStageHandles(context.value, leases, required, generations);
      if (!captured.ok) return captured as RegionOutcome<RegionCommitToken>;
      const created = this.createStageRecord(context.value, leases, required, generations);
      if (!created.ok) return created as RegionOutcome<RegionCommitToken>;
      this.staged.set(created.value.token, created.value);
      this.stagedBytes += created.value.bytes;
      retainedForStage = true;
      return { ok: true, value: created.value.token };
    } finally {
      if (!retainedForStage) releaseLeases(leases);
    }
  }
}
