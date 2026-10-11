import type { InteractionState as CoreInteractionState } from '@varendo/core';
import type { RegionSnapshot } from '../regions/types.js';
import { callInteractionHost } from './controller-callbacks.js';
import { failure, freeze, routeKey, validText } from './controller-common.js';
import type { AppliedPayload, EventDeadline, ResolvedResult } from './controller-common.js';
import { currentInteractionHost } from './controller-host.js';
import { createResolutionContext, resolveInteractionResult } from './controller-results.js';
import type {
  InteractionControllerOptions,
  InteractionEffectReceipt,
  InteractionEvent,
  InteractionHostContext,
  InteractionOutcome,
  InteractionPayload,
  InteractionQueryPayload,
  InteractionRoute,
} from './types.js';

type DeadlineCheck = (deadline: EventDeadline, controller: AbortController) => boolean;

interface PayloadContext {
  readonly options: InteractionControllerOptions;
  readonly event: InteractionEvent;
  readonly host: InteractionHostContext;
  readonly snapshot: RegionSnapshot;
  readonly controller: AbortController;
  readonly deadline: EventDeadline;
  readonly maxMilliseconds: number;
  readonly deadlineExpired: DeadlineCheck;
  readonly effects: InteractionEffectReceipt[];
  readonly navigations: Extract<InteractionPayload, { readonly kind: 'navigate' }>[];
}

function upsertValue(
  state: CoreInteractionState,
  route: InteractionRoute,
  payload: Extract<InteractionPayload, { readonly kind: 'selection' | 'filter' | 'range' | 'group' | 'page' }>,
): CoreInteractionState {
  const key = routeKey(route);
  const values = state.values.filter((entry) => routeKey(entry) !== key);
  return freeze({
    ...state,
    values: freeze([...values, freeze({ nodeId: route.nodeId, portId: route.portId, payload })]),
  });
}

function clearValue(state: CoreInteractionState, route: InteractionRoute): CoreInteractionState {
  const key = routeKey(route);
  const values = state.values.filter((entry) => routeKey(entry) !== key);
  return values.length === state.values.length ? state : freeze({ ...state, values: freeze(values) });
}

function stateOnly(state: CoreInteractionState): InteractionOutcome<AppliedPayload> {
  return { ok: true, value: { state } };
}

function withResult(state: CoreInteractionState, result: ResolvedResult): InteractionOutcome<AppliedPayload> {
  return { ok: true, value: { state, result } };
}

async function applySelection(
  payload: Extract<InteractionPayload, { readonly kind: 'selection' }>,
  route: InteractionRoute,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  const { host } = context;
  if (!host.grants.includes('experience.commit'))
    return failure('runtime.interaction-denied', 'The host did not grant interaction state updates.');
  if (payload.selection.mode === 'clear') return stateOnly(clearValue(state, route));
  const result = resolveSelectionResult(payload, context);
  if (!result.ok) return result;
  const callback = await callInteractionHost(
    context.options.validateSelection,
    payload.selection,
    createResolutionContext(context.event, host, context.snapshot, context.controller.signal),
    context.controller,
    context.deadline,
    context.maxMilliseconds,
    context.deadlineExpired,
  );
  if (!callback.ok) return callback;
  const next = upsertValue(state, route, payload);
  return result.value === undefined ? stateOnly(next) : withResult(next, result.value);
}

function resolveSelectionResult(
  payload: Extract<InteractionPayload, { readonly kind: 'selection' }>,
  context: PayloadContext,
): InteractionOutcome<ResolvedResult | undefined> {
  if (payload.selection.mode !== 'ids') return { ok: true, value: undefined };
  if (!context.host.grants.includes('result.inspect'))
    return failure('runtime.interaction-denied', 'The host did not grant result inspection.');
  const keys = new Set(payload.selection.keys);
  if (keys.size !== payload.selection.keys.length)
    return failure('runtime.interaction-invalid', 'Entity selection keys must be unique.');
  const resolution = createResolutionContext(context.event, context.host, context.snapshot, context.controller.signal);
  const checked = resolveInteractionResult(payload.selection.result.outputId, resolution, context.options);
  if (!checked.ok) return checked;
  if (!sameResultRef(checked.value.ref, payload.selection.result))
    return failure('runtime.interaction-stale', 'The selected result is not the current authorized result.');
  return { ok: true, value: checked.value };
}

function sameResultRef(left: ResolvedResult['ref'], right: ResolvedResult['ref']): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.sourceLineage === right.sourceLineage &&
    left.outputId === right.outputId &&
    left.queryDigest === right.queryDigest &&
    left.scopeDigest === right.scopeDigest
  );
}

async function applyQuery(
  payload: InteractionQueryPayload,
  route: InteractionRoute,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  if (!context.host.grants.includes('experience.commit'))
    return failure('runtime.interaction-denied', 'The host did not grant interaction state updates.');
  if (!context.host.grants.includes('result.inspect'))
    return failure('runtime.interaction-denied', 'The host did not grant result inspection.');
  const resolution = createResolutionContext(context.event, context.host, context.snapshot, context.controller.signal);
  const result = resolveInteractionResult(payload.outputId, resolution, context.options);
  if (!result.ok) return result;
  if (payload.kind === 'page' && payload.queryDigest !== result.value.ref.queryDigest)
    return failure('runtime.interaction-stale', 'The page cursor belongs to a different query generation.');
  const checked = await callInteractionHost(
    context.options.validateScope,
    payload,
    resolution,
    context.controller,
    context.deadline,
    context.maxMilliseconds,
    context.deadlineExpired,
  );
  if (!checked.ok) return checked;
  return withResult(upsertValue(state, route, payload), result.value);
}

async function applyDraft(
  payload: Extract<InteractionPayload, { readonly kind: 'draft' }>,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  if (!context.host.grants.includes('draft.edit') || !context.host.grants.includes('experience.commit'))
    return failure('runtime.interaction-denied', 'The host did not grant draft editing.');
  if (!validText(payload.key))
    return failure('runtime.interaction-invalid', 'Draft edits require a stable entity key.');
  const current = state.drafts.find((draft) => matchesDraft(draft, payload, context.host));
  if (current !== undefined && current.entityRevision !== payload.entityRevision)
    return failure(
      'runtime.interaction-stale',
      'The draft entity revision changed; resolve the draft conflict explicitly.',
    );
  const checked = await callInteractionHost(
    context.options.validateDraft,
    payload,
    createResolutionContext(context.event, context.host, context.snapshot, context.controller.signal),
    context.controller,
    context.deadline,
    context.maxMilliseconds,
    context.deadlineExpired,
  );
  if (!checked.ok) return checked;
  return stateOnly(upsertDraft(state, payload, context.host.draftDomain));
}

function matchesDraft(
  draft: CoreInteractionState['drafts'][number],
  payload: Extract<InteractionPayload, { readonly kind: 'draft' }>,
  host: InteractionHostContext,
): boolean {
  return (
    draft.domain === host.draftDomain &&
    draft.entity === payload.entity &&
    draft.key === payload.key &&
    draft.field === payload.field
  );
}

function upsertDraft(
  state: CoreInteractionState,
  payload: Extract<InteractionPayload, { readonly kind: 'draft' }>,
  domain: string,
): CoreInteractionState {
  const draft = freeze({
    domain,
    entity: payload.entity,
    key: payload.key,
    field: payload.field,
    value: payload.value,
    entityRevision: payload.entityRevision,
  });
  const drafts = state.drafts.filter(
    (candidate) =>
      candidate.domain !== domain ||
      candidate.entity !== payload.entity ||
      candidate.key !== payload.key ||
      candidate.field !== payload.field,
  );
  return freeze({ ...state, drafts: freeze([...drafts, draft]) });
}

async function applyNavigate(
  payload: Extract<InteractionPayload, { readonly kind: 'navigate' }>,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  if (!context.host.grants.includes('navigation.propose'))
    return failure('runtime.interaction-denied', 'The host did not grant application navigation proposals.');
  const current = currentInteractionHost(
    context.snapshot,
    context.host,
    ['navigation.propose'],
    context.options.readContext,
  );
  if (!current.ok) return current;
  const checked = await callInteractionHost(
    context.options.validateNavigation,
    payload,
    createResolutionContext(context.event, current.value, context.snapshot, context.controller.signal),
    context.controller,
    context.deadline,
    context.maxMilliseconds,
    context.deadlineExpired,
  );
  if (!checked.ok) return checked;
  context.effects.push(freeze({ kind: 'navigate', eventId: context.event.eventId, actorId: context.host.actor.id }));
  context.navigations.push(payload);
  return stateOnly(state);
}

async function applyAction(
  payload: Extract<InteractionPayload, { readonly kind: 'action-request' }>,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  if (!context.host.grants.includes('action.propose'))
    return failure('runtime.interaction-denied', 'The host did not grant action proposals.');
  const current = currentInteractionHost(
    context.snapshot,
    context.host,
    ['action.propose'],
    context.options.readContext,
  );
  if (!current.ok) return current;
  const checked = await callInteractionHost(
    context.options.onActionProposal,
    payload,
    createResolutionContext(context.event, current.value, context.snapshot, context.controller.signal),
    context.controller,
    context.deadline,
    context.maxMilliseconds,
    context.deadlineExpired,
  );
  if (!checked.ok) return checked;
  context.effects.push(
    freeze({ kind: 'action-proposal', eventId: context.event.eventId, actorId: context.host.actor.id }),
  );
  return stateOnly(state);
}

export async function applyInteractionPayload(
  payload: InteractionPayload,
  route: InteractionRoute,
  state: CoreInteractionState,
  context: PayloadContext,
): Promise<InteractionOutcome<AppliedPayload>> {
  if (context.controller.signal.aborted)
    return failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
  switch (payload.kind) {
    case 'selection':
      return applySelection(payload, route, state, context);
    case 'filter':
    case 'range':
    case 'group':
    case 'page':
      return applyQuery(payload, route, state, context);
    case 'draft':
      return applyDraft(payload, state, context);
    case 'navigate':
      return applyNavigate(payload, state, context);
    case 'action-request':
      return applyAction(payload, state, context);
    default:
      return failure(
        'runtime.interaction-unsupported',
        'The interaction payload kind is not supported by this controller.',
      );
  }
}

export type { PayloadContext };
