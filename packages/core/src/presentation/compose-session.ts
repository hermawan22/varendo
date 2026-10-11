import * as z from 'zod/mini';
import { inspectWire } from '../contracts/ingress.js';
import { validateCommitReadSet } from '../contracts/commit.js';
import { idSchema, revisionSchema } from '../contracts/schemas.js';
import type { CommitPreconditions, Diagnostic, Outcome } from '../contracts/types.js';
import {
  preparePresentationContext,
  preparePresentationRegistry,
  preparePresentationValidationCache,
  type PreparedPresentationContext,
} from './validate.js';
import type { PresentationValidationCache } from './validation/types.js';
import type {
  PresentationCompositionRequest,
  PresentationManifest,
  PresentationRegistry,
  ResolvedPresentationNode,
  ValidatedPresentation,
} from './types.js';
import { createPresentationParseCache } from './compose-parse.js';
import type { PresentationParseCache } from './compose-parse.js';
import { betterCandidate, candidateScore } from './compose-ranking.js';
import type { CanonicalCache } from './compose-ranking.js';
import { presentationFailure as fail } from './registry.js';

const identitySchema = z.strictObject({ id: idSchema, revision: revisionSchema });

export type CompositionCandidate = NonNullable<PresentationCompositionRequest['candidates']>[number];

interface RankedCandidate {
  readonly presentation: ValidatedPresentation;
  readonly score: number;
  readonly incumbent: boolean;
  readonly label: string;
}

export interface CompositionState {
  readonly id: string;
  readonly revision: string;
  readonly requestPins: CommitPreconditions;
  readonly prepared: PreparedPresentationContext;
  readonly manifests: ReadonlyMap<string, PresentationManifest>;
  readonly validationCache: PresentationValidationCache;
  readonly request: PresentationCompositionRequest;
  readonly registry: PresentationRegistry;
  readonly nodeMemo: Map<string, ResolvedPresentationNode>;
  readonly nodeIdentityMemo: WeakMap<object, ResolvedPresentationNode>;
  readonly canonicalCache: CanonicalCache;
  readonly parseCache: PresentationParseCache;
  readonly rejected: { candidate: string; diagnostics: readonly Diagnostic[] }[];
  expansions: number;
  budgetBlocked: boolean;
  best: RankedCandidate | undefined;
}

function validateRequestPins(
  request: PresentationCompositionRequest,
): Outcome<{ id: string; revision: string; pins: CommitPreconditions }> {
  const identity = z.safeParse(identitySchema, { id: request.id, revision: request.revision });
  if (!identity.success) return fail('request', 'The composition identity is invalid.');
  const pins = validateCommitReadSet(request.preconditions, request.context.current);
  if (!pins.ok) return pins;
  return { ok: true, value: { id: identity.data.id, revision: identity.data.revision, pins: pins.value } };
}

function validateCurrentPins(prepared: PreparedPresentationContext, pins: CommitPreconditions): Outcome<void> {
  const constraints = prepared.constraints;
  if (
    constraints.task.revision !== pins.taskRevision ||
    constraints.task.catalogRevision !== pins.catalogRevision ||
    constraints.task.functionRegistryDigest !== pins.functionRegistryDigest ||
    constraints.experience.revision !== pins.experienceRevision
  )
    return fail('stale', 'The task or experience differs from the current version pins.');
  return { ok: true, value: undefined };
}

function validateCandidateList(request: PresentationCompositionRequest): Outcome<void> {
  if (request.candidates === undefined) return { ok: true, value: undefined };
  const wire = inspectWire(request.candidates);
  if (!wire.ok) return wire;
  if (!Array.isArray(wire.value) || wire.value.length > 64)
    return fail('candidate-budget', 'The proposed complete candidate list exceeds the input budget.');
  return { ok: true, value: undefined };
}

/** Parse the request and allocate state local to this synchronous search. */
export function prepareComposition(
  request: PresentationCompositionRequest,
  registry: PresentationRegistry,
): Outcome<CompositionState> {
  const identity = validateRequestPins(request);
  if (!identity.ok) return identity;
  const prepared = preparePresentationContext(request.context);
  if (!prepared.ok) return prepared;
  const manifests = preparePresentationRegistry(registry);
  if (!manifests.ok) return manifests;
  const validationCache = preparePresentationValidationCache(prepared.value, registry, manifests.value);
  if (!validationCache.ok) return validationCache;
  const pins = validateCurrentPins(prepared.value, identity.value.pins);
  if (!pins.ok) return pins;
  const candidates = validateCandidateList(request);
  if (!candidates.ok) return candidates;
  return {
    ok: true,
    value: {
      id: identity.value.id,
      revision: identity.value.revision,
      requestPins: identity.value.pins,
      prepared: prepared.value,
      manifests: manifests.value,
      validationCache: validationCache.value,
      request: {
        ...request,
        context: {
          ...request.context,
          ...(prepared.value.patternContext.incumbent === undefined
            ? {}
            : { incumbent: prepared.value.patternContext.incumbent }),
        },
      },
      registry,
      nodeMemo: new Map(),
      nodeIdentityMemo: new WeakMap(),
      canonicalCache: new WeakMap(),
      parseCache: createPresentationParseCache(),
      rejected: [],
      expansions: 0,
      budgetBlocked: false,
      best: undefined,
    },
  };
}

export function spend(state: CompositionState): boolean {
  if (state.expansions >= state.prepared.constraints.maxExpansions) {
    state.budgetBlocked = true;
    return false;
  }
  state.expansions += 1;
  return true;
}

export function reject(state: CompositionState, candidate: string, diagnostics: readonly Diagnostic[]): void {
  state.rejected.push({ candidate, diagnostics });
}

export function consider(
  state: CompositionState,
  presentation: ValidatedPresentation,
  incumbent: boolean,
  label: string,
): void {
  const next: RankedCandidate = {
    presentation,
    score: candidateScore(presentation, state.prepared, state.request.context.incumbent),
    incumbent,
    label,
  };
  if (betterCandidate(next, state.best, state.canonicalCache)) state.best = next;
}
