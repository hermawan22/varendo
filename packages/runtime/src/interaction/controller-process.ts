import type { InteractionState as CoreInteractionState } from '@varendo/core';
import type { RegionHandle, RegionSnapshot } from '../regions/types.js';
import type { ResultHandle } from '../results/types.js';
import { applyInteractionPayload, type PayloadContext } from './controller-payload.js';
import { commitInteractionState } from './controller-commit.js';
import {
  canonical,
  eventIdentity,
  failure,
  freeze,
  grantsForPayload,
  persistedState,
  publicState,
  routeKey,
} from './controller-common.js';
import type { EventDeadline } from './controller-common.js';
import { currentInteractionHost, readInteractionHost } from './controller-host.js';
import { resolveSourceRoute } from './controller-routing.js';
import {
  addResultHandle,
  createResolutionContext,
  interactionReadSet,
  isQueryPayload,
  materializeInteraction,
} from './controller-results.js';
import { callInteractionHost } from './controller-callbacks.js';
import type {
  InteractionControllerOptions,
  InteractionEffectReceipt,
  InteractionEvent,
  InteractionGraph,
  InteractionHostContext,
  InteractionOutcome,
  InteractionPayload,
  InteractionQueryPayload,
  InteractionReceipt,
  InteractionRoutedPayload,
} from './types.js';

interface EventDependencies {
  readonly options: InteractionControllerOptions;
  readonly region: RegionHandle;
  readonly graph: InteractionGraph;
  readonly maxHops: number;
  readonly maxEventMilliseconds: number;
  readonly isDisposed: () => boolean;
  readonly isRevoked: () => boolean;
  readonly abortPending: () => void;
  readonly remember: (eventId: string, identity: string) => void;
  readonly seen: (eventId: string) => { readonly identity: string } | undefined;
  readonly deadlineExpired: (deadline: EventDeadline, controller: AbortController) => boolean;
  readonly markRevoked: () => void;
}

interface AppliedEvents {
  state: CoreInteractionState;
  readonly effects: InteractionEffectReceipt[];
  readonly navigations: Extract<InteractionPayload, { readonly kind: 'navigate' }>[];
  readonly queryPayloads: InteractionQueryPayload[];
  readonly resultHandles: ResultHandle[];
  readonly requiredGrants: Set<string>;
}

function regionUnavailable(snapshot: RegionSnapshot): InteractionOutcome<InteractionReceipt> {
  const code = snapshot.status === 'revoked' ? 'runtime.interaction-revoked' : 'runtime.interaction-disposed';
  return failure(code, 'The region is no longer active.');
}

function idempotentReceipt(event: InteractionEvent, before: RegionSnapshot): InteractionOutcome<InteractionReceipt> {
  return {
    ok: true,
    value: freeze({
      eventId: event.eventId,
      state: publicState(before),
      region: before,
      routed: [],
      effects: [],
      noop: true,
    }),
  };
}

function checkRemembered(
  event: InteractionEvent,
  identity: string,
  seen: { readonly identity: string } | undefined,
  before: RegionSnapshot,
): InteractionOutcome<InteractionReceipt> | undefined {
  if (seen === undefined) return undefined;
  if (seen.identity !== identity)
    return failure(
      'runtime.interaction-invalid',
      'The interaction event ID was already completed with different canonical input.',
    );
  return idempotentReceipt(event, before);
}

function routeEvent(
  event: InteractionEvent,
  sourcePortId: string | undefined,
  before: RegionSnapshot,
  controller: AbortController,
  dependencies: EventDependencies,
): InteractionOutcome<readonly InteractionRoutedPayload[]> {
  if (event.regionId !== before.id || event.regionRevision !== before.regionRevision)
    return failure('runtime.interaction-stale', 'The interaction event is stale against the current region revision.');
  const source = resolveSourceRoute(dependencies.graph, event, sourcePortId);
  if (!source.ok) return source;
  const routed = dependencies.graph.route(event, source.value, controller.signal, dependencies.maxHops);
  if (!routed.ok) return routed;
  return {
    ok: true,
    value: [{ route: source.value, payload: event.payload, causationId: event.causationId }, ...routed.value],
  };
}

function createAppliedEvents(before: RegionSnapshot): AppliedEvents {
  return {
    state: persistedState(before),
    effects: [],
    navigations: [],
    queryPayloads: [],
    resultHandles: [],
    requiredGrants: new Set(),
  };
}

function payloadContext(
  event: InteractionEvent,
  host: InteractionHostContext,
  before: RegionSnapshot,
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
  applied: AppliedEvents,
): PayloadContext {
  return {
    options: dependencies.options,
    event,
    host,
    snapshot: before,
    controller,
    deadline,
    maxMilliseconds: dependencies.maxEventMilliseconds,
    deadlineExpired: dependencies.deadlineExpired,
    effects: applied.effects,
    navigations: applied.navigations,
  };
}

async function applyRoutedEvents(
  items: readonly InteractionRoutedPayload[],
  event: InteractionEvent,
  host: InteractionHostContext,
  before: RegionSnapshot,
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
  applied: AppliedEvents,
): Promise<InteractionOutcome<void>> {
  const handled = new Set<string>();
  const context = payloadContext(event, host, before, controller, deadline, dependencies, applied);
  for (const item of items) {
    if (dependencies.deadlineExpired(deadline, controller))
      return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
    const key = routeKey(item.route) + '\u0000' + canonical(item.payload);
    if (handled.has(key)) continue;
    handled.add(key);
    const result = await applyInteractionPayload(item.payload, item.route, applied.state, context);
    if (!result.ok) return result;
    applied.state = result.value.state;
    collectEffects(item.payload, result.value.result, applied);
  }
  return { ok: true, value: undefined };
}

function collectEffects(
  payload: InteractionPayload,
  result: { readonly handle: ResultHandle } | undefined,
  applied: AppliedEvents,
): void {
  for (const grant of grantsForPayload(payload)) applied.requiredGrants.add(grant);
  if (result !== undefined) addResultHandle(applied.resultHandles, result.handle);
  if (isQueryPayload(payload)) applied.queryPayloads.push(payload);
}

async function materializeAndCommit(
  event: InteractionEvent,
  host: InteractionHostContext,
  before: RegionSnapshot,
  changedState: CoreInteractionState,
  applied: AppliedEvents,
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
): Promise<InteractionOutcome<RegionSnapshot>> {
  const materialized = await materializeInteraction(
    applied.queryPayloads,
    event,
    host,
    before,
    changedState,
    controller,
    deadline,
    dependencies.maxEventMilliseconds,
    dependencies.deadlineExpired,
    dependencies.options,
    applied.resultHandles,
  );
  if (!materialized.ok) return materialized;
  const current = currentInteractionHost(
    before,
    host,
    Array.from(applied.requiredGrants),
    dependencies.options.readContext,
  );
  if (!current.ok) return current;
  if (dependencies.deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  const expected = interactionReadSet(before, applied.resultHandles);
  if (!expected.ok) return expected;
  return commitInteractionState({
    region: dependencies.region,
    event,
    before,
    expected: expected.value,
    next: changedState,
    candidate: materialized.value,
    resultHandles: applied.resultHandles,
    controller,
    deadline,
    deadlineExpired: dependencies.deadlineExpired,
    recheck: () => {
      const checked = currentInteractionHost(
        before,
        host,
        Array.from(applied.requiredGrants),
        dependencies.options.readContext,
      );
      return checked.ok ? { ok: true, value: undefined } : checked;
    },
    revoke: () => {
      dependencies.markRevoked();
      dependencies.abortPending();
    },
  });
}

async function dispatchNavigations(
  event: InteractionEvent,
  host: InteractionHostContext,
  region: RegionSnapshot,
  navigations: readonly Extract<InteractionPayload, { readonly kind: 'navigate' }>[],
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
): Promise<InteractionOutcome<void>> {
  for (const navigate of navigations) {
    const current = currentInteractionHost(region, host, ['navigation.propose'], dependencies.options.readContext);
    if (!current.ok) return current;
    const callback = await callInteractionHost(
      dependencies.options.onNavigate,
      navigate,
      createResolutionContext(event, current.value, region, controller.signal),
      controller,
      deadline,
      dependencies.maxEventMilliseconds,
      dependencies.deadlineExpired,
    );
    if (!callback.ok) return callback;
  }
  return { ok: true, value: undefined };
}

function checkEventStart(
  controller: AbortController,
  dependencies: EventDependencies,
): InteractionOutcome<never> | undefined {
  if (dependencies.isDisposed())
    return failure('runtime.interaction-disposed', 'The interaction controller has been disposed.');
  if (dependencies.isRevoked())
    return failure('runtime.interaction-revoked', 'The interaction controller has been revoked.');
  if (controller.signal.aborted) return failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
  return undefined;
}

export async function processInteractionEvent(
  event: InteractionEvent,
  sourcePortId: string | undefined,
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
): Promise<InteractionOutcome<InteractionReceipt>> {
  const start = checkEventStart(controller, dependencies);
  if (start !== undefined) return start;
  const before = dependencies.region.snapshot();
  if (before.status !== 'active') return regionUnavailable(before);
  const host = readInteractionHost(before, dependencies.options.readContext);
  if (!host.ok) return host;
  if (dependencies.deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  const identity = eventIdentity(event, sourcePortId);
  const remembered = checkRemembered(event, identity, dependencies.seen(event.eventId), before);
  if (remembered !== undefined) return remembered;
  const routes = routeEvent(event, sourcePortId, before, controller, dependencies);
  if (!routes.ok) return routes;
  if (dependencies.deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  const applied = createAppliedEvents(before);
  const results = await applyRoutedEvents(
    routes.value,
    event,
    host.value,
    before,
    controller,
    deadline,
    dependencies,
    applied,
  );
  if (!results.ok) return results;
  return finishEvent(event, identity, host.value, before, routes.value, applied, controller, deadline, dependencies);
}

async function finishEvent(
  event: InteractionEvent,
  identity: string,
  host: InteractionHostContext,
  before: RegionSnapshot,
  routed: readonly InteractionRoutedPayload[],
  applied: AppliedEvents,
  controller: AbortController,
  deadline: EventDeadline,
  dependencies: EventDependencies,
): Promise<InteractionOutcome<InteractionReceipt>> {
  const changed = canonical(applied.state) !== canonical(persistedState(before));
  let region = before;
  if (changed) {
    const committed = await materializeAndCommit(
      event,
      host,
      before,
      applied.state,
      applied,
      controller,
      deadline,
      dependencies,
    );
    if (!committed.ok) return committed;
    region = committed.value;
    if (dependencies.isRevoked())
      return failure('runtime.interaction-revoked', 'The region was revoked during the interaction.');
  } else if (dependencies.deadlineExpired(deadline, controller)) {
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  } else if (controller.signal.aborted) {
    return failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
  }
  const navigated = await dispatchNavigations(
    event,
    host,
    region,
    applied.navigations,
    controller,
    deadline,
    dependencies,
  );
  if (!navigated.ok) return navigated;
  if (dependencies.deadlineExpired(deadline, controller))
    return failure('runtime.interaction-budget', 'The interaction exceeded its bounded event time budget.');
  const receipt = freeze({
    eventId: event.eventId,
    state: publicState(region),
    region,
    routed,
    effects: applied.effects,
    noop: !changed && applied.effects.length === 0,
  });
  dependencies.remember(event.eventId, identity);
  return { ok: true, value: receipt };
}
