import { WIRE_LIMITS } from '@varendo/core';
import { parseInteractionState } from '@varendo/core/interaction';
import { canonicalJson } from '../canonical.js';
import type { InteractionState as CoreInteractionState, ResultRef } from '@varendo/core';
import type { RegionSnapshot } from '../regions/types.js';
import type {
  InteractionEvent,
  InteractionFailure,
  InteractionOutcome,
  InteractionPayload,
  InteractionRoute,
  InteractionState,
} from './types.js';

export const DEFAULT_MAX_QUEUED_EVENTS = 64;
export const DEFAULT_MAX_EVENT_MILLISECONDS = 30_000;
export const DEFAULT_MAX_HOPS = 32;

export interface EventDeadline {
  readonly expiresAt: number;
  expired: boolean;
}

export interface SeenEvent {
  readonly identity: string;
  readonly bytes: number;
}

export interface ResolvedResult {
  readonly ref: ResultRef;
  readonly handle: import('../results/types.js').ResultHandle;
}

export interface AppliedPayload {
  readonly state: CoreInteractionState;
  readonly result?: ResolvedResult;
}

export const failure = <T>(code: InteractionFailure['code'], message: string): InteractionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

export function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) freeze(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

export { canonicalJson as canonical };

export function eventIdentity(event: InteractionEvent, sourcePortId: string | undefined): string {
  return `${canonicalJson(event)}\u0000${sourcePortId === undefined ? '' : sourcePortId}`;
}

export function refKey(ref: ResultRef): string {
  return JSON.stringify([ref.id, ref.revision, ref.sourceLineage, ref.outputId, ref.queryDigest, ref.scopeDigest]);
}

export function routeKey(route: InteractionRoute): string {
  return JSON.stringify([route.nodeId, route.portId]);
}

export function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.text &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function monotonicNow(): number {
  const clock = globalThis.performance;
  if (clock !== undefined && typeof clock.now === 'function') return clock.now();
  return Date.now();
}

export function grantsForPayload(payload: InteractionPayload): readonly string[] {
  switch (payload.kind) {
    case 'selection':
      return payload.selection.mode === 'ids' ? ['experience.commit', 'result.inspect'] : ['experience.commit'];
    case 'filter':
    case 'range':
    case 'group':
    case 'page':
      return ['experience.commit', 'result.inspect'];
    case 'draft':
      return ['experience.commit', 'draft.edit'];
    case 'navigate':
      return ['navigation.propose'];
    case 'action-request':
      return ['action.propose'];
    default:
      return [];
  }
}

function emptyPersistedState(): CoreInteractionState {
  return freeze({ version: '1', values: [], drafts: [] });
}

export function persistedState(snapshot: RegionSnapshot): CoreInteractionState {
  if (snapshot.state?.interaction === undefined) return emptyPersistedState();
  const checked = parseInteractionState(snapshot.state.interaction);
  return checked.ok ? checked.value : emptyPersistedState();
}

export function publicState(snapshot: RegionSnapshot): InteractionState {
  const persisted = snapshot.status === 'active' ? persistedState(snapshot) : emptyPersistedState();
  return freeze({ ...persisted, regionRevision: snapshot.regionRevision, taskRevision: snapshot.taskRevision });
}
