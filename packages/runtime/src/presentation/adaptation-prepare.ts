import { resolvePresentation, validatePresentationPlan } from '@varendo/core/presentation';
import type {
  PresentationComposition,
  PresentationContext,
  PresentationEnvironment,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import type { RegionOutcome, RegionReadSet, RegionSnapshot } from '../regions/types.js';
import {
  adaptationFailure,
  contextFor,
  environmentRequiresRefresh,
  failureFromCore,
  makeRequestId,
  readSource,
  readTransitionBlocked,
  samePlan,
  sameSnapshot,
  semanticReadSet,
  snapshotReadSet,
} from './adaptation-context.js';
import type { AdaptationQueueRequest } from './adaptation-queue.js';
import { compositionForDecision, resolverCandidates, resolverTarget } from './adaptation-resolver.js';
import type {
  PresentationAdaptationContext,
  PresentationAdaptationContextSource,
  PresentationAdaptationOptions,
  PresentationAdaptationReadInput,
  PresentationAdaptationResult,
} from './adaptation-types.js';

export interface ReadyContext {
  readonly context: PresentationContext;
  readonly readSet: RegionReadSet;
  readonly refreshed: PresentationAdaptationContext;
}

export type ContextStage =
  | { readonly kind: 'ready'; readonly value: ReadyContext }
  | { readonly kind: 'done'; readonly outcome: RegionOutcome<PresentationAdaptationResult> };

export interface CandidateStage {
  readonly requestId: string;
  readonly readSet: RegionReadSet;
  readonly composition: PresentationComposition;
  readonly candidate: ValidatedPresentation;
  readonly previous?: ValidatedPresentation;
}

export type ComposeStage =
  | { readonly kind: 'ready'; readonly value: CandidateStage }
  | { readonly kind: 'done'; readonly outcome: RegionOutcome<PresentationAdaptationResult> };

function done(outcome: RegionOutcome<PresentationAdaptationResult>): ContextStage {
  return { kind: 'done', outcome };
}

function deferred(snapshot: RegionSnapshot, reason: string): ContextStage {
  return done({ ok: true, value: { status: 'deferred', snapshot, reason } });
}

function composeDone(outcome: RegionOutcome<PresentationAdaptationResult>): ComposeStage {
  return { kind: 'done', outcome };
}

export function activeSnapshot(
  snapshot: RegionSnapshot,
): RegionOutcome<{ readonly snapshot: RegionSnapshot; readonly readSet: RegionReadSet }> {
  const readSet = snapshotReadSet(snapshot);
  if (!readSet.ok) return readSet;
  if (snapshot.state === undefined)
    return adaptationFailure('runtime.presentation-disposed', 'The region is no longer active.');
  return { ok: true, value: { snapshot, readSet: readSet.value } };
}

/**
 * The evaluation half of an adaptation request: refresh the host context and
 * compose a candidate presentation. Everything before region publication is
 * pure policy evaluation; only the caller commits.
 */
export class AdaptationPreparer {
  private readonly options: PresentationAdaptationOptions;
  private readonly hysteresisPx: number;
  private readonly readLastEnvironment: () => PresentationEnvironment | undefined;
  private requestCounter = 0;

  constructor(
    options: PresentationAdaptationOptions,
    hysteresisPx: number,
    readLastEnvironment: () => PresentationEnvironment | undefined,
  ) {
    this.options = options;
    this.hysteresisPx = hysteresisPx;
    this.readLastEnvironment = readLastEnvironment;
  }

  async loadContext(
    request: AdaptationQueueRequest,
    before: RegionSnapshot,
    signal: AbortSignal,
  ): Promise<ContextStage> {
    if (
      !request.options.force &&
      !environmentRequiresRefresh(this.readLastEnvironment(), request.environment, this.hysteresisPx)
    )
      return deferred(before, 'hysteresis');
    const current = activeSnapshot(before);
    if (!current.ok) return done(current);
    const input: PresentationAdaptationReadInput = {
      region: this.options.region,
      snapshot: before,
      environment: request.environment,
      signal,
    };
    const source: PresentationAdaptationContextSource = this.options.readContext ?? this.options.baseContext;
    const refreshed = await readSource({ source, input });
    if (signal.aborted)
      return done(adaptationFailure('runtime.presentation-cancelled', 'The adaptation was cancelled.'));
    if (!refreshed.ok) return done(refreshed);
    if (!sameSnapshot(before, this.options.region.snapshot()))
      return done(
        adaptationFailure(
          'runtime.presentation-stale',
          'The region changed while its adaptation context was refreshed.',
        ),
      );
    return this.finishContextStage(request, before, current.value.readSet, refreshed.value);
  }

  private finishContextStage(
    request: AdaptationQueueRequest,
    before: RegionSnapshot,
    readSet: RegionReadSet,
    refreshed: PresentationAdaptationContext,
  ): ContextStage {
    const explicit = request.options.explicit ?? refreshed.explicitTransition === true;
    const context = contextFor(before, refreshed, request.environment, explicit);
    if (!context.ok) return done(context);
    if (readTransitionBlocked(this.options.transitionBlocked)) return deferred(before, 'transition-blocked');
    if (context.value.transitionBlocked === true) return deferred(before, 'transition-blocked');
    if (this.explicitTransitionRequired(before, refreshed, explicit)) return deferred(before, 'transition-blocked');
    return { kind: 'ready', value: { context: context.value, readSet, refreshed } };
  }

  private explicitTransitionRequired(
    before: RegionSnapshot,
    refreshed: PresentationAdaptationContext,
    explicit: boolean,
  ): boolean {
    return (
      before.state?.presentation !== undefined && refreshed.experience.transitionPolicy === 'explicit-only' && !explicit
    );
  }

  compose(before: RegionSnapshot, stage: ReadyContext, signal: AbortSignal): ComposeStage {
    const requestIdentity = makeRequestId(++this.requestCounter);
    const decision = resolvePresentation({
      id: requestIdentity.id,
      revision: requestIdentity.revision,
      preconditions: semanticReadSet(stage.readSet),
      context: stage.context,
      registry: this.options.registry,
      target: resolverTarget(before, this.options.target),
      candidates: resolverCandidates(stage.refreshed.candidates),
    });
    if (decision.status !== 'ready') return composeDone({ ok: false, diagnostics: [decision.diagnostic] });
    if (signal.aborted)
      return composeDone(adaptationFailure('runtime.presentation-cancelled', 'The adaptation was cancelled.'));
    return this.validateCandidate(
      before,
      stage,
      requestIdentity.id,
      compositionForDecision(decision.plan, decision.receipt.examinedCandidates),
    );
  }

  private validateCandidate(
    before: RegionSnapshot,
    stage: ReadyContext,
    requestId: string,
    composition: PresentationComposition,
  ): ComposeStage {
    const candidate = composition.presentation;
    if (candidate === undefined)
      return composeDone(
        adaptationFailure(
          'runtime.presentation-conflict',
          'No feasible presentation was found for the measured environment.',
        ),
      );
    if (samePlan(candidate.plan, before.state?.presentation))
      return composeDone({ ok: true, value: { status: 'unchanged', snapshot: before, composition } });
    const previous = this.validateIncumbent(before, stage.context);
    if (!previous.ok) return composeDone(previous);
    return {
      kind: 'ready',
      value: {
        requestId,
        readSet: stage.readSet,
        composition,
        candidate,
        ...(previous.value === undefined ? {} : { previous: previous.value }),
      },
    };
  }

  private validateIncumbent(
    before: RegionSnapshot,
    context: PresentationContext,
  ): RegionOutcome<ValidatedPresentation | undefined> {
    const incumbent = before.state?.presentation;
    if (incumbent === undefined) return { ok: true, value: undefined };
    const checked = validatePresentationPlan({ ...incumbent, stateTransfer: [] }, context, this.options.registry);
    if (!checked.ok) return failureFromCore(checked);
    return { ok: true, value: checked.value };
  }
}
