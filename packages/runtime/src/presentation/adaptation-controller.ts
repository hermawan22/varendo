import type { PresentationPlan } from '@varendo/core';
import type { PresentationEnvironment, ValidatedPresentation } from '@varendo/core/presentation';
import type { PresentationNavigationState } from './renderer.js';
import type { RegionCommitToken, RegionOutcome, RegionSnapshot, RegionUpdate } from '../regions/types.js';
import {
  projectInteractionState,
  projectNavigationState,
  type PresentationProjectionInput,
  type PresentationProjectionState,
  type PreparedPresentationProjection,
} from './renderer.js';
import { AdaptationRequestQueue } from './adaptation-queue.js';
import type { AdaptationQueueRequest } from './adaptation-queue.js';
import { activeSnapshot, AdaptationPreparer } from './adaptation-prepare.js';
import type { CandidateStage } from './adaptation-prepare.js';
import {
  adaptationFailure,
  compositionForCommit,
  readTransitionBlocked,
  resultForPlan,
  sameSnapshot,
  validatePresentationAdaptationOptions,
} from './adaptation-context.js';
import type {
  PresentationAdaptationController,
  PresentationAdaptationOptions,
  PresentationAdaptationRequestOptions,
  PresentationAdaptationResult,
} from './adaptation-types.js';
import { resolverTarget } from './adaptation-resolver.js';

function clearScheduledTimeout(handle: unknown): void {
  if (handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
}

class PresentationAdaptationControllerImpl implements PresentationAdaptationController {
  private readonly options: PresentationAdaptationOptions;
  private readonly now: () => number;
  private readonly hysteresisPx: number;
  private readonly requestQueue: AdaptationRequestQueue;
  private readonly observer: ReturnType<PresentationAdaptationOptions['region']['observe']>;
  private disposed = false;
  private activeController: AbortController | undefined;
  private lastEnvironment: PresentationEnvironment | undefined;
  private readonly preparation: AdaptationPreparer;
  private lastCommitAt: number | undefined;
  private closedByRegion = false;

  constructor(options: PresentationAdaptationOptions) {
    validatePresentationAdaptationOptions(options);
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.hysteresisPx = options.hysteresisPx ?? 8;
    this.preparation = new AdaptationPreparer(options, this.hysteresisPx, () => this.lastEnvironment);
    this.requestQueue = new AdaptationRequestQueue({
      now: () => this.safeNow(),
      lastCommitAt: () => this.lastCommitAt,
      schedule: options.schedule ?? ((callback, delay) => setTimeout(callback, delay)),
      cancelSchedule: options.cancelSchedule ?? clearScheduledTimeout,
      dwellMs: options.dwellMs ?? 120,
      maxPending: options.maxPendingRequests ?? 64,
      unavailable: () => this.disposed || this.closedByRegion,
      abortActive: () => this.activeController?.abort(),
      run: (request) => this.run(request),
    });
    this.observer = options.region.observe((update) => this.observe(update));
    if (this.observer.closed) this.closeAlreadyDisposedRegion();
  }

  private safeNow(): number {
    try {
      const value = this.now();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  private observe(update: RegionUpdate): void {
    if (update.kind !== 'revoke' && update.kind !== 'dispose') return;
    try {
      this.options.renderer.clear(update.reason);
    } catch {
      // The region has already revoked the authority used by this projection.
    }
    this.closedByRegion = true;
    const revoked = update.kind === 'revoke';
    const outcome = adaptationFailure<PresentationAdaptationResult>(
      revoked ? 'runtime.presentation-revoked' : 'runtime.presentation-disposed',
      revoked ? 'The region authorization was revoked.' : 'The region was disposed.',
    );
    this.requestQueue.close(outcome);
    this.activeController?.abort();
  }

  private closeAlreadyDisposedRegion(): void {
    this.closedByRegion = true;
    try {
      this.options.renderer.clear('The region was already closed.');
    } catch {
      // Clearing remains the renderer owner's responsibility.
    }
  }

  private async run(request: AdaptationQueueRequest): Promise<RegionOutcome<PresentationAdaptationResult>> {
    const controller = new AbortController();
    this.activeController = controller;
    const signal = controller.signal;
    const before = this.options.region.snapshot();
    if (this.disposed)
      return adaptationFailure('runtime.presentation-disposed', 'The adaptation controller is disposed.');
    const active = activeSnapshot(before);
    if (!active.ok) return adaptationFailure('runtime.presentation-disposed', 'The region is no longer active.');
    const contextStage = await this.preparation.loadContext(request, before, signal);
    if (contextStage.kind === 'done') return contextStage.outcome;
    const candidateStage = this.preparation.compose(before, contextStage.value, signal);
    if (candidateStage.kind === 'done') return candidateStage.outcome;
    return this.publish(request, before, signal, candidateStage.value);
  }

  private async projectionInput(
    before: RegionSnapshot,
    signal: AbortSignal,
    candidate: CandidateStage,
  ): Promise<RegionOutcome<PresentationProjectionInput>> {
    const interaction = projectInteractionState(candidate.previous, candidate.candidate, before.state?.interaction);
    if (!interaction.ok) return interaction;
    const currentNavigation = this.readNavigation();
    if (!currentNavigation.ok) return currentNavigation;
    const navigation = projectNavigationState(candidate.previous, candidate.candidate, currentNavigation.value);
    if (!navigation.ok) return navigation;
    const next: PresentationProjectionState = Object.freeze({
      presentation: candidate.candidate,
      ...(interaction.value === undefined ? {} : { interaction: interaction.value }),
      ...(navigation.value === undefined ? {} : { navigation: navigation.value }),
    });
    const previous = this.previousProjection(before, candidate.previous, currentNavigation.value);
    return {
      ok: true,
      value: {
        next,
        signal,
        ...(previous === undefined ? {} : { previous }),
      },
    };
  }

  private readNavigation(): RegionOutcome<PresentationNavigationState | undefined> {
    try {
      return { ok: true, value: this.options.readNavigation?.() };
    } catch {
      return adaptationFailure('runtime.presentation-navigation', 'The host navigation state could not be read.');
    }
  }

  private previousProjection(
    before: RegionSnapshot,
    previous: ValidatedPresentation | undefined,
    navigation: PresentationNavigationState | undefined,
  ): PresentationProjectionState | undefined {
    if (previous === undefined) return undefined;
    return {
      presentation: previous,
      ...(before.state?.interaction === undefined ? {} : { interaction: before.state.interaction }),
      ...(navigation === undefined ? {} : { navigation }),
    };
  }

  private async stageRegion(
    before: RegionSnapshot,
    candidate: CandidateStage,
    interaction: PresentationProjectionState['interaction'],
  ) {
    return this.options.region.stage({
      requestId: candidate.requestId,
      expected: candidate.readSet,
      state: {
        task: before.state!.task,
        presentation: candidate.candidate.plan,
        ...(interaction === undefined ? {} : { interaction }),
      },
    });
  }

  private discard(token: RegionCommitToken): void {
    try {
      this.options.region.discard(token);
    } catch {
      // A consumed stage token needs no additional cleanup.
    }
  }

  private async prepareRenderer(
    token: RegionCommitToken,
    projection: PresentationProjectionInput,
  ): Promise<RegionOutcome<PreparedPresentationProjection>> {
    let prepared: RegionOutcome<PreparedPresentationProjection>;
    try {
      prepared = this.options.renderer.prepare(projection);
    } catch {
      this.discard(token);
      return adaptationFailure(
        'runtime.presentation-renderer',
        'The renderer could not prepare the presentation projection.',
      );
    }
    if (!prepared.ok) this.discard(token);
    return prepared;
  }

  private rollback(prepared: PreparedPresentationProjection): void {
    try {
      prepared.rollback();
    } catch {
      // Region revoke and renderer clear remain the final recovery boundary.
    }
  }

  private validatePublication(
    before: RegionSnapshot,
    prospective: RegionSnapshot | undefined,
    signal: AbortSignal,
  ): RegionOutcome<PresentationPlan> {
    if (signal.aborted)
      return adaptationFailure('runtime.presentation-cancelled', 'The adaptation was cancelled before publication.');
    if (readTransitionBlocked(this.options.transitionBlocked))
      return adaptationFailure(
        'runtime.presentation-transition-blocked',
        'The presentation transition is blocked by an active interaction.',
      );
    if (resolverTarget(before, this.options.target).state !== 'active')
      return adaptationFailure('presentation.target-inactive', 'The presentation target is inactive.');
    if (!sameSnapshot(before, this.options.region.snapshot()))
      return adaptationFailure(
        'runtime.presentation-stale',
        'The region changed before the presentation could be committed.',
      );
    const plan = prospective?.state?.presentation;
    if (plan === undefined)
      return adaptationFailure(
        'runtime.presentation-stale',
        'The region did not provide the prospective presentation revisions.',
      );
    return { ok: true, value: plan };
  }

  private recheck(
    before: RegionSnapshot,
    candidate: CandidateStage,
    next: PresentationProjectionState,
    prepared: PreparedPresentationProjection,
    signal: AbortSignal,
  ) {
    return (prospective?: RegionSnapshot): RegionOutcome<void> => {
      const valid = this.validatePublication(before, prospective, signal);
      if (!valid.ok) return valid;
      const projection = Object.freeze({ ...next, presentation: resultForPlan(candidate.candidate, valid.value) });
      try {
        const applied = prepared.apply(projection);
        if (!applied.ok) this.rollback(prepared);
        return applied;
      } catch {
        this.rollback(prepared);
        return adaptationFailure(
          'runtime.presentation-renderer',
          'The renderer could not apply the prepared projection.',
        );
      }
    };
  }

  private async publish(
    request: AdaptationQueueRequest,
    before: RegionSnapshot,
    signal: AbortSignal,
    candidate: CandidateStage,
  ): Promise<RegionOutcome<PresentationAdaptationResult>> {
    const projection = await this.projectionInput(before, signal, candidate);
    if (!projection.ok) return projection;
    const staged = await this.stageRegion(before, candidate, projection.value.next.interaction);
    if (!staged.ok) return staged;
    if (signal.aborted) {
      this.discard(staged.value);
      return adaptationFailure('runtime.presentation-cancelled', 'The adaptation was cancelled.');
    }
    const prepared = await this.prepareRenderer(staged.value, projection.value);
    if (!prepared.ok) return prepared;
    const committed = await this.options.region.commit(staged.value, {
      signal,
      recheck: this.recheck(before, candidate, projection.value.next, prepared.value, signal),
    });
    if (!committed.ok) {
      this.rollback(prepared.value);
      return committed;
    }
    return this.committedResult(request, candidate, committed.value);
  }

  private committedResult(
    request: AdaptationQueueRequest,
    candidate: CandidateStage,
    snapshot: RegionSnapshot,
  ): RegionOutcome<PresentationAdaptationResult> {
    this.lastEnvironment = request.environment;
    this.lastCommitAt = this.safeNow();
    const composition = compositionForCommit(candidate.composition, candidate.candidate, snapshot.state?.presentation);
    return { ok: true, value: { status: 'committed', snapshot, composition } };
  }

  request(
    environment: PresentationEnvironment,
    options?: PresentationAdaptationRequestOptions,
  ): Promise<RegionOutcome<PresentationAdaptationResult>> {
    return this.requestQueue.request(environment, options);
  }

  flush(): Promise<RegionOutcome<PresentationAdaptationResult>> {
    return this.requestQueue.flush();
  }

  get pending(): boolean {
    return this.requestQueue.pending;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeController?.abort();
    this.requestQueue.close(
      adaptationFailure('runtime.presentation-disposed', 'The adaptation controller is disposed.'),
    );
    this.observer.unsubscribe();
  }
}

export function createPresentationAdaptationController(
  options: PresentationAdaptationOptions,
): PresentationAdaptationController {
  return new PresentationAdaptationControllerImpl(options);
}
