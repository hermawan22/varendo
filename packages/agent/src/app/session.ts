import type { Outcome } from '@varendo/core';
import type { ActionReceipt } from '@varendo/runtime/actions';
import { closeActionState, confirmAction, createActionCapabilityState } from './action-capability.js';
import { createSharedAppToolEndpoint } from './endpoint.js';
import type {
  VarendoAppToolEndpoint,
  VarendoAppToolSession,
  AppToolEndpointOptions,
  AppToolSessionIdentity,
} from './types.js';
import { failure } from './values.js';

interface SessionState {
  readonly options: AppToolEndpointOptions;
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly started: number;
  readonly milliseconds: number;
  readonly now: () => number;
  readonly actions: ReturnType<typeof createActionCapabilityState>;
  readonly endpoints: Set<VarendoAppToolEndpoint>;
  readonly lifetime: AbortController;
}

function close(state: SessionState): void {
  if (state.lifetime.signal.aborted) return;
  state.lifetime.abort();
  closeActionState(state.actions);
  for (const endpoint of state.endpoints) endpoint.close();
  state.endpoints.clear();
}

function active(state: SessionState): Outcome<void> {
  if (state.lifetime.signal.aborted) return failure('agent.app.stale', 'The application tool session is closed.');
  try {
    const now = state.now();
    const current = state.options.runtime.context(state.options.regionId);
    if (
      Number.isFinite(now) &&
      now < state.options.expiresAt &&
      performance.now() - state.started < state.milliseconds &&
      current.ok &&
      current.value.authority.principalKey === state.principalKey &&
      current.value.authority.scopeDigest === state.scopeDigest
    )
      return { ok: true, value: undefined };
  } catch {
    /* Unavailable authority or clock permanently fences the pairing. */
  }
  close(state);
  return failure('agent.app.stale', 'The application tool session expired or its authenticated scope changed.');
}

function createEndpoint(state: SessionState, identity: AppToolSessionIdentity): Outcome<VarendoAppToolEndpoint> {
  if (
    identity === null ||
    typeof identity !== 'object' ||
    identity.principalKey !== state.principalKey ||
    identity.scopeDigest !== state.scopeDigest
  )
    return failure('agent.app.denied', 'The authenticated request does not match this tool session.');
  const checked = active(state);
  if (!checked.ok) return checked;
  let borrowed: VarendoAppToolEndpoint | undefined;
  const endpoint = createSharedAppToolEndpoint(
    state.options,
    state.actions,
    () => active(state),
    () => {
      if (borrowed !== undefined) state.endpoints.delete(borrowed);
    },
  );
  if (endpoint.ok) {
    borrowed = endpoint.value;
    state.endpoints.add(borrowed);
  }
  return endpoint;
}

async function confirm(
  state: SessionState,
  previewId: string,
  options: { readonly signal?: AbortSignal },
): Promise<Outcome<ActionReceipt>> {
  const checked = active(state);
  if (!checked.ok) return checked;
  const signal =
    options.signal === undefined ? state.lifetime.signal : AbortSignal.any([state.lifetime.signal, options.signal]);
  const result = await confirmAction(state.actions, previewId, { signal });
  const fresh = active(state);
  return fresh.ok ? result : fresh;
}

/** Owns action continuity for fresh MCP endpoints within one immutable, expiring host pairing. */
export function createAppToolSession(input: AppToolEndpointOptions): Outcome<VarendoAppToolSession> {
  if (
    input === null ||
    typeof input !== 'object' ||
    input.runtime === null ||
    typeof input.runtime !== 'object' ||
    typeof input.runtime.context !== 'function'
  )
    return failure('agent.app.invalid', 'Tool session options require a trusted runtime.');
  const options = Object.freeze({ ...input });
  let initial: ReturnType<AppToolEndpointOptions['runtime']['context']>;
  try {
    initial = options.runtime.context(options.regionId);
  } catch {
    return failure('agent.app.stale', 'The tool session authority is unavailable.');
  }
  if (!initial.ok) return initial;
  const now = options.now ?? Date.now;
  let created: number;
  try {
    created = now();
  } catch {
    return failure('agent.app.stale', 'The tool session clock is unavailable.');
  }
  const state: SessionState = {
    options,
    principalKey: initial.value.authority.principalKey,
    scopeDigest: initial.value.authority.scopeDigest,
    started: performance.now(),
    milliseconds: options.expiresAt - created,
    now,
    actions: createActionCapabilityState(options),
    endpoints: new Set(),
    lifetime: new AbortController(),
  };
  const validated = createEndpoint(state, { principalKey: state.principalKey, scopeDigest: state.scopeDigest });
  if (!validated.ok) {
    close(state);
    return validated;
  }
  validated.value.close();
  return {
    ok: true,
    value: Object.freeze({
      regionId: options.regionId,
      goalEpoch: options.goalEpoch,
      expiresAt: options.expiresAt,
      createEndpoint: (authenticated: AppToolSessionIdentity) => createEndpoint(state, authenticated),
      confirmAction: (previewId: string, confirmOptions: { readonly signal?: AbortSignal } = {}) =>
        confirm(state, previewId, confirmOptions),
      close: () => close(state),
    }),
  };
}
