import { WIRE_LIMITS } from '@varendo/core';
import { parseInteractionState } from '@varendo/core/interaction';
import type { InteractionState as CoreInteractionState } from '@varendo/core';
import { resultRefForHandle } from '../regions/index.js';
import type { RegionReadSet, RegionSnapshot } from '../regions/types.js';
import type { RegionContent } from '../tasks/types.js';
import type { ResultHandle } from '../results/types.js';
import { callInteractionMaterializer } from './controller-callbacks.js';
import { canonical, failure, refKey } from './controller-common.js';
import type { EventDeadline, ResolvedResult } from './controller-common.js';
import type {
  InteractionControllerOptions,
  InteractionEvent,
  InteractionHostContext,
  InteractionOutcome,
  InteractionPayload,
  InteractionQueryPayload,
  InteractionResolutionContext,
} from './types.js';

type DeadlineCheck = (deadline: EventDeadline, controller: AbortController) => boolean;

const READABLE_STATUSES: ReadonlySet<string> = new Set(['ready', 'partial', 'refreshing']);
const QUERY_PAYLOAD_KINDS: ReadonlySet<InteractionPayload['kind']> = new Set(['filter', 'range', 'group', 'page']);

export function createResolutionContext(
  event: InteractionEvent,
  host: InteractionHostContext,
  snapshot: RegionSnapshot,
  signal: AbortSignal,
): InteractionResolutionContext {
  return { event, host, region: snapshot, signal };
}

function resultKey(handle: ResultHandle): string | undefined {
  try {
    const resolved = resultRefForHandle(handle);
    return resolved.ok ? refKey(resolved.value) : undefined;
  } catch {
    return undefined;
  }
}

function sameHandle(candidate: ResultHandle, handle: ResultHandle, key: string | undefined): boolean {
  if (candidate === handle) return true;
  return key !== undefined && resultKey(candidate) === key;
}

export function addResultHandle(handles: ResultHandle[], handle: ResultHandle): void {
  const key = resultKey(handle);
  if (!handles.some((candidate) => sameHandle(candidate, handle, key))) handles.push(handle);
}

function readableResult(handle: ResultHandle): InteractionOutcome<void> {
  let status: string;
  try {
    status = handle.snapshot().status;
  } catch {
    return failure('runtime.interaction-stale', 'The interaction result could not be inspected.');
  }
  if (!READABLE_STATUSES.has(status))
    return failure('runtime.interaction-stale', 'The interaction result is not currently readable.');
  return { ok: true, value: undefined };
}

export function resolveInteractionResult(
  outputId: string,
  context: InteractionResolutionContext,
  options: InteractionControllerOptions,
): InteractionOutcome<ResolvedResult> {
  const refs = context.host.results.filter((ref) => ref.outputId === outputId);
  if (refs.length !== 1)
    return failure(
      'runtime.interaction-stale',
      'The interaction output is not uniquely bound to the current result scope.',
    );
  const ref = refs[0]!;
  if (options.resolveResult === undefined)
    return failure('runtime.interaction-denied', 'The host has not registered a result resolver.');
  let handle: ResultHandle | undefined;
  try {
    handle = options.resolveResult(ref, context);
  } catch {
    return failure('runtime.interaction-denied', 'The host result resolver failed.');
  }
  if (handle === undefined)
    return failure('runtime.interaction-stale', 'The interaction result is no longer available.');
  if (handle.key.principalKey !== context.host.principalKey)
    return failure('runtime.interaction-denied', 'The interaction result belongs to a different host principal.');
  const resolved = resultRefForHandle(handle);
  if (!resolved.ok || refKey(resolved.value) !== refKey(ref))
    return failure('runtime.interaction-stale', 'The interaction result generation changed.');
  const readable = readableResult(handle);
  return readable.ok ? { ok: true, value: { ref, handle } } : readable;
}

export async function materializeInteraction(
  payloads: readonly InteractionQueryPayload[],
  event: InteractionEvent,
  host: InteractionHostContext,
  snapshot: RegionSnapshot,
  next: CoreInteractionState,
  controller: AbortController,
  deadline: EventDeadline,
  maxMilliseconds: number,
  deadlineExpired: DeadlineCheck,
  options: InteractionControllerOptions,
  handles: ResultHandle[],
): Promise<InteractionOutcome<RegionContent | undefined>> {
  if (payloads.length === 0) return { ok: true, value: undefined };
  const context = createResolutionContext(event, host, snapshot, controller.signal);
  const result = await callInteractionMaterializer(
    options,
    payloads,
    context,
    next,
    controller,
    deadline,
    maxMilliseconds,
    deadlineExpired,
  );
  if (!result.ok) return result;
  const value = result.value.state.interaction;
  const checked = value === undefined ? undefined : parseInteractionState(value);
  if (checked === undefined || !checked.ok || canonical(checked.value) !== canonical(next))
    return failure(
      'runtime.interaction-invalid',
      'The host materializer must return the canonical next interaction state.',
    );
  for (const handle of result.value.resultHandles ?? []) addResultHandle(handles, handle);
  return { ok: true, value: result.value.state };
}

export function interactionReadSet(
  before: RegionSnapshot,
  handles: readonly ResultHandle[],
): InteractionOutcome<RegionReadSet> {
  if (before.readSet === undefined)
    return failure('runtime.interaction-disposed', 'The region has no active read set.');
  const refs = [...before.readSet.results];
  const seen = new Set(refs.map((ref) => refKey(ref)));
  for (const handle of handles) {
    const resolved = resolveHandleRef(handle);
    if (!resolved.ok) return resolved;
    if (resolved.value.scopeDigest !== before.readSet.scopeDigest)
      return failure('runtime.interaction-stale', 'A result handle belongs to a different authorization scope.');
    const key = refKey(resolved.value);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(resolved.value);
  }
  if (refs.length > WIRE_LIMITS.array)
    return failure('runtime.interaction-budget', 'The interaction read set exceeds its result dependency budget.');
  return { ok: true, value: { ...before.readSet, results: refs } };
}

function resolveHandleRef(handle: ResultHandle): InteractionOutcome<import('@varendo/core').ResultRef> {
  let resolved: ReturnType<typeof resultRefForHandle>;
  try {
    resolved = resultRefForHandle(handle);
  } catch {
    return failure('runtime.interaction-stale', 'A result handle could not be bound to the interaction read set.');
  }
  if (!resolved.ok) return failure('runtime.interaction-stale', resolved.diagnostics[0]!.message);
  return resolved;
}

export function isQueryPayload(payload: InteractionPayload): payload is InteractionQueryPayload {
  return QUERY_PAYLOAD_KINDS.has(payload.kind);
}
