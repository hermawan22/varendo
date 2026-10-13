import type { Outcome } from '@varendo/core';
import type { ActionReceipt } from '@varendo/runtime/actions';
import type {
  AgentCapabilityHost,
  AgentCapabilityHostContext,
  AgentCapabilityManifest,
  AgentCapabilityRegistry,
} from '../capabilities/types.js';
import { createAgentCapabilityRegistry } from '../capabilities/registry.js';
import { createAgentToolEndpoint } from '../protocol/endpoint.js';
import type { AgentModelToolEndpoint, AgentToolBinding } from '../protocol/types.js';
import {
  createActionCapability,
  closeActionState,
  confirmAction,
  createActionCapabilityState,
} from './action-capability.js';
import { createContextCapability } from './context-capability.js';
import { agentIntentSchema } from './intent-schema.js';
import { createRenderCapability } from './render-capability.js';
import type { VarendoAppToolEndpoint, AppToolEndpointOptions } from './types.js';
import { bounded, failure, grants, toolSchema } from './values.js';

const refs = Object.freeze({
  context: { id: 'varendo.app.context', revision: '1' },
  render: { id: 'varendo.app.render', revision: '1' },
  action: { id: 'varendo.app.action', revision: '1' },
});

const contextSchema = toolSchema({ type: 'object', properties: {}, additionalProperties: false });
const actionSchema = toolSchema({
  type: 'object',
  oneOf: [
    {
      required: ['mode', 'action', 'input'],
      properties: {
        mode: { const: 'preview' },
        action: { type: 'object', required: ['id', 'revision'] },
        input: { type: 'object' },
        entity: { type: 'object' },
        idempotencyKey: { type: 'string' },
      },
    },
    { required: ['mode', 'previewId'], properties: { mode: { const: 'execute' }, previewId: { type: 'string' } } },
  ],
});

function createRegistry(): Outcome<AgentCapabilityRegistry> {
  return createAgentCapabilityRegistry();
}

function registerCapabilities(
  registry: AgentCapabilityRegistry,
  options: AppToolEndpointOptions,
  actionState: ReturnType<typeof createActionCapabilityState>,
): Outcome<void> {
  const context = registerOne(registry, createContextCapability(options));
  if (!context.ok) return context;
  const render = registerOne(registry, createRenderCapability(options, options.render ?? options.runtime));
  if (!render.ok) return render;
  return registerOne(registry, createActionCapability(actionState));
}

function registerOne<TInput, TOutput>(
  registry: AgentCapabilityRegistry,
  capability: AgentCapabilityManifest<TInput, TOutput>,
): Outcome<void> {
  return registry.register(capability);
}

function standardTools(): readonly AgentToolBinding[] {
  return [
    { name: 'varendo_context', capability: refs.context, operation: 'catalog.read', inputSchema: contextSchema },
    {
      name: 'varendo_render',
      capability: refs.render,
      operation: 'task.evaluate',
      inputSchema: toolSchema(agentIntentSchema()),
    },
    { name: 'varendo_act', capability: refs.action, operation: 'action.propose', inputSchema: actionSchema },
  ];
}

function pairedHost(
  options: AppToolEndpointOptions,
  initialScopeDigest: string,
  guard?: () => Outcome<void>,
): AgentCapabilityHost {
  return {
    readContext: (): Outcome<AgentCapabilityHostContext> => {
      const active = guard?.();
      if (active !== undefined && !active.ok) return active;
      const current = options.runtime.context(options.regionId);
      if (!current.ok) return current;
      if (current.value.authority.scopeDigest !== initialScopeDigest)
        return failure('agent.app.stale', 'The paired Region scope changed. Create a new tool pairing.');
      return {
        ok: true as const,
        value: {
          principalKey: current.value.authority.principalKey,
          regionId: options.regionId,
          goalEpoch: options.goalEpoch,
          grants: grants(current.value.authority.grants),
        },
      };
    },
  };
}

type OptionalEndpointLimits = Pick<
  AppToolEndpointOptions,
  'now' | 'maxPending' | 'maxMilliseconds' | 'maxInputBytes' | 'maxOutputBytes'
>;

function endpointLimits(options: AppToolEndpointOptions): OptionalEndpointLimits {
  return {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    ...(options.maxMilliseconds === undefined ? {} : { maxMilliseconds: options.maxMilliseconds }),
    ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
  };
}

function validateOptions(options: AppToolEndpointOptions): Outcome<VarendoAppToolEndpoint> | undefined {
  if (options === null || typeof options !== 'object' || !bounded(options.regionId) || !bounded(options.goalEpoch))
    return failure<VarendoAppToolEndpoint>(
      'agent.app.invalid',
      'A standard tool endpoint requires one mounted Region and goal epoch.',
    );
  if (options.context !== undefined && (options.context === null || typeof options.context.read !== 'function'))
    return failure<VarendoAppToolEndpoint>(
      'agent.app.invalid-context',
      'A custom discovery port requires a trusted read function.',
    );
  return undefined;
}

function wrapEndpoint(
  inner: AgentModelToolEndpoint,
  actionState: ReturnType<typeof createActionCapabilityState>,
  closeActions: boolean,
  guard?: () => Outcome<void>,
  onClose?: () => void,
): VarendoAppToolEndpoint {
  let closed = false;
  const lifetime = new AbortController();
  return Object.freeze({
    ...inner,
    confirmAction: async (
      previewId: string,
      input: { readonly signal?: AbortSignal } = {},
    ): Promise<Outcome<ActionReceipt>> => {
      if (closed) return failure('agent.app.stale', 'The tool endpoint is closed.');
      const active = guard?.();
      if (active !== undefined && !active.ok) return active;
      const signal = input.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, input.signal]);
      const result = await confirmAction(actionState, previewId, { signal });
      if (closed) return failure('agent.app.stale', 'The tool endpoint closed during confirmation.');
      const fresh = guard?.();
      return fresh !== undefined && !fresh.ok ? fresh : result;
    },
    close: () => {
      if (closed) return;
      closed = true;
      lifetime.abort();
      if (closeActions) closeActionState(actionState);
      inner.close();
      onClose?.();
    },
  });
}

/** Creates the three standard tools around one expiring, freshly-authorized Region pairing. */
export function createAppToolEndpoint(options: AppToolEndpointOptions): Outcome<VarendoAppToolEndpoint> {
  const invalid = validateOptions(options);
  if (invalid !== undefined) return invalid;
  return buildEndpoint(Object.freeze({ ...options }), createActionCapabilityState(options), true);
}

/** Internal borrowing path: the trusted session, rather than one transport request, owns action state. */
export function createSharedAppToolEndpoint(
  options: AppToolEndpointOptions,
  actionState: ReturnType<typeof createActionCapabilityState>,
  guard: () => Outcome<void>,
  onClose: () => void,
): Outcome<VarendoAppToolEndpoint> {
  return buildEndpoint(options, actionState, false, guard, onClose);
}

function buildEndpoint(
  options: AppToolEndpointOptions,
  actionState: ReturnType<typeof createActionCapabilityState>,
  closeActions: boolean,
  guard?: () => Outcome<void>,
  onClose?: () => void,
): Outcome<VarendoAppToolEndpoint> {
  const invalid = validateOptions(options);
  if (invalid !== undefined) return invalid;
  const initial = options.runtime.context(options.regionId);
  if (!initial.ok) return initial;
  const registry = createRegistry();
  if (!registry.ok) return registry;
  const registered = registerCapabilities(registry.value, options, actionState);
  if (!registered.ok) return registered;
  const endpoint = createAgentToolEndpoint({
    transport: options.transport,
    targetRegionId: options.regionId,
    goalEpoch: options.goalEpoch,
    principalKey: initial.value.authority.principalKey,
    expiresAt: options.expiresAt,
    registry: registry.value,
    tools: standardTools(),
    host: pairedHost(options, initial.value.authority.scopeDigest, guard),
    ...endpointLimits(options),
  });
  if (!endpoint.ok) return endpoint;
  return { ok: true, value: wrapEndpoint(endpoint.value, actionState, closeActions, guard, onClose) };
}
