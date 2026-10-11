import { parseWireValue, type Diagnostic, type Outcome } from '@varendo/core';
import type { AgentCapabilityHandlerResult, AgentCapabilityManifest, AgentJsonValue } from '../capabilities/types.js';
import { createAgentCapabilityRegistry } from '../capabilities/registry.js';
import { createAgentToolEndpoint } from '../protocol/endpoint.js';
import type { AgentModelToolEndpoint, AgentToolDefinition } from '../protocol/types.js';
import type {
  ScopeSnapshot,
  SurfaceAddress,
  SurfaceController,
  SurfaceRequest,
  SurfaceSnapshot,
} from '@varendo/runtime';
import type { OperationGrant } from '@varendo/core/agent';
import { isRecord, strictId as validId } from '../guards.js';
import type {
  AgentSurfaceRenderResult,
  AgentSurfaceTarget,
  AgentTargetMetadata,
  ScopedSurfaceEndpointOptions,
} from './types.js';

export const MAX_TARGETS = 32;

export function failure<T>(code: string, message: string): Outcome<T> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

export function diagnostic(code: string, message: string): Diagnostic {
  return { code, message, retryable: false };
}

export { validId };

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)]))) as T;
}

function sameAddress(left: SurfaceAddress, right: SurfaceAddress): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.scopeInstanceId === right.scopeInstanceId &&
    left.activationEpoch === right.activationEpoch &&
    left.surfaceId === right.surfaceId &&
    left.surfaceGeneration === right.surfaceGeneration
  );
}

function surfaceOf(target: AgentSurfaceTarget): SurfaceController<unknown, unknown> | undefined {
  if (
    target === null ||
    typeof target !== 'object' ||
    !validId(target.id) ||
    target.surface === null ||
    typeof target.surface !== 'object' ||
    typeof target.surface.getSnapshot !== 'function' ||
    typeof target.surface.request !== 'function'
  )
    return undefined;
  return target.surface;
}

function currentTarget(target: AgentSurfaceTarget, scope: ScopeSnapshot): boolean {
  const surface = surfaceOf(target);
  if (surface === undefined) return false;
  const address = surface.address;
  return (
    scope.active &&
    address.runtimeId === scope.runtimeId &&
    address.scopeInstanceId === scope.scopeInstanceId &&
    address.activationEpoch === scope.activationEpoch
  );
}

function intentMetadata(snapshot: SurfaceSnapshot<unknown, unknown>): Readonly<Record<string, string>> {
  const intent = isRecord(snapshot.intent) ? snapshot.intent : {};
  const fields = ['kind', 'id', 'resource'] as const;
  const output: Record<string, string> = {};
  for (const field of fields) {
    const value = intent[field];
    if (typeof value === 'string' && validId(value)) output[field] = value;
  }
  return Object.freeze(output);
}

function targetMetadata(target: AgentSurfaceTarget, scope: ScopeSnapshot): Outcome<AgentTargetMetadata> {
  const surface = surfaceOf(target);
  if (surface === undefined) return failure('agent.bridge.target-invalid', 'The registered surface target is invalid.');
  if (!currentTarget(target, scope))
    return failure('agent.bridge.stale', 'The surface target no longer belongs to the active scope activation.');
  let snapshot: SurfaceSnapshot<unknown, unknown>;
  try {
    snapshot = surface.getSnapshot();
  } catch {
    return failure('agent.bridge.target-read', 'The surface target could not be inspected safely.');
  }
  return {
    ok: true,
    value: freeze({
      id: target.id,
      address: { ...snapshot.address },
      revision: snapshot.revision,
      phase: snapshot.phase,
      intent: intentMetadata(snapshot),
    }),
  };
}

function targetContext(
  targets: ReadonlyMap<string, AgentSurfaceTarget>,
  scope: ScopeSnapshot,
): Outcome<AgentJsonValue> {
  const values: AgentJsonValue[] = [];
  for (const target of targets.values()) {
    const metadata = targetMetadata(target, scope);
    if (!metadata.ok) return metadata;
    values.push(
      freeze({
        id: metadata.value.id,
        address: metadata.value.address,
        revision: metadata.value.revision,
        phase: metadata.value.phase,
        intent: metadata.value.intent,
      }) as unknown as AgentJsonValue,
    );
  }
  return { ok: true, value: freeze({ targets: values }) as unknown as AgentJsonValue };
}

interface ContextInput {
  readonly kind: 'context';
}

interface RenderInput {
  readonly targetId: string;
  readonly intent: AgentJsonValue;
}

function parseContext(input: unknown): Outcome<ContextInput> {
  if (isRecord(input) && Object.keys(input).length === 0) return { ok: true, value: { kind: 'context' } };
  return failure('agent.bridge.context-input', 'Surface context accepts an empty object.');
}

function parseRender(input: unknown): Outcome<RenderInput> {
  const parsed = parseWireValue(input);
  if (!parsed.ok || !isRecord(parsed.value))
    return failure('agent.bridge.render-input', 'A surface render request must be a JSON object.');
  const keys = Object.keys(parsed.value);
  if (keys.some((key) => key !== 'targetId' && key !== 'intent'))
    return failure('agent.bridge.render-input', 'A surface render request contains unsupported fields.');
  const targetId = parsed.value.targetId;
  if (!validId(targetId)) return failure('agent.bridge.target-denied', 'The requested surface ID is malformed.');
  if (!Object.hasOwn(parsed.value, 'intent'))
    return failure('agent.bridge.render-input', 'A surface render request requires an intent.');
  const intent = parsed.value.intent;
  const checked = parseWireValue(intent);
  if (!checked.ok) return failure('agent.bridge.render-input', 'The surface intent is not bounded wire data.');
  return { ok: true, value: { targetId, intent: checked.value as AgentJsonValue } };
}

/** Operations this endpoint's registered tools and transport can ever exercise. */
const SCOPED_OPERATIONS: readonly OperationGrant[] = Object.freeze(['catalog.read', 'experience.commit']);

/**
 * The grant set the pairing can legitimately request: the two operations its
 * registered tools use, plus `model.egress` on transports that expose tool
 * metadata or run a model loop. Manual pairings never carry model egress.
 */
function requestedGrants(transport: ScopedSurfaceEndpointOptions['transport']): readonly OperationGrant[] {
  return transport === 'manual' ? SCOPED_OPERATIONS : Object.freeze([...SCOPED_OPERATIONS, 'model.egress']);
}

/**
 * Effective authority is always the intersection of the caller's delegated
 * grant ceiling (`options.grants`) and the operations this endpoint can
 * request. A broader request is clamped, never unioned; without a declared
 * ceiling the pairing is limited to the endpoint's own least-privilege set.
 */
function scopedGrants(options: ScopedSurfaceEndpointOptions): readonly OperationGrant[] {
  const requested = requestedGrants(options.transport);
  if (options.grants === undefined) return requested;
  const delegated = new Set<OperationGrant>(options.grants);
  return Object.freeze(requested.filter((grant) => delegated.has(grant)));
}

function scopeAuthority(
  options: ScopedSurfaceEndpointOptions,
  targets: ReadonlyMap<string, AgentSurfaceTarget>,
): Outcome<{
  readonly principalKey: string;
  readonly regionId: string;
  readonly goalEpoch: string;
  readonly grants: readonly OperationGrant[];
}> {
  const snapshot = options.scope.getSnapshot();
  if (!snapshot.active || snapshot.status === 'denied' || snapshot.status === 'disposed')
    return failure('agent.bridge.stale', 'The scoped agent pairing is no longer active.');
  for (const target of targets.values()) {
    if (!currentTarget(target, snapshot))
      return failure('agent.bridge.stale', 'The scoped agent target changed activation.');
  }
  const principalKey = `bridge-${snapshot.scopeInstanceId}-${snapshot.activationEpoch}`;
  return {
    ok: true,
    value: {
      principalKey,
      regionId: options.sessionId,
      goalEpoch: options.goalEpoch,
      grants: scopedGrants(options),
    },
  };
}

function resultDiagnostic(status: AgentSurfaceRenderResult['status']): Diagnostic {
  return diagnostic(`agent.bridge.${status}`, `The surface request ended as ${status}.`);
}

/** Revision-bearing render outcomes share one freshness check and differ only in their receipt shape. */
const REVISIONED_RESULTS: Readonly<
  Record<
    'renderer-ready' | 'committed',
    { readonly state: 'renderer-ready' | 'plan-committed'; readonly code: string; readonly message: string }
  >
> = {
  'renderer-ready': {
    state: 'renderer-ready',
    code: 'agent.bridge.renderer-ack',
    message: 'The renderer acknowledgement did not match a new surface revision.',
  },
  committed: {
    state: 'plan-committed',
    code: 'agent.bridge.commit-receipt',
    message: 'The runtime commit receipt did not match a new surface revision.',
  },
};

function surfaceResult(
  result: AgentSurfaceRenderResult,
  targetId: string,
  before: SurfaceSnapshot<unknown, unknown>,
  target: AgentSurfaceTarget,
  scope: ScopeSnapshot,
): AgentCapabilityHandlerResult<AgentJsonValue> {
  const surface = surfaceOf(target);
  if (surface === undefined || !currentTarget(target, scope))
    return {
      state: 'stale',
      diagnostics: [diagnostic('agent.bridge.stale', 'The surface target changed activation.')],
    };
  let after: SurfaceSnapshot<unknown, unknown>;
  try {
    after = surface.getSnapshot();
  } catch {
    return {
      state: 'failed',
      diagnostics: [diagnostic('agent.bridge.target-read', 'The surface target could not be read.')],
    };
  }
  if (!sameAddress(after.address, before.address))
    return {
      state: 'stale',
      diagnostics: [diagnostic('agent.bridge.stale', 'The surface address changed during rendering.')],
    };
  if (result.status === 'renderer-ready' || result.status === 'committed') {
    const mapped = REVISIONED_RESULTS[result.status];
    if (result.revision !== after.revision || result.revision === before.revision)
      return {
        state: 'failed',
        diagnostics: [diagnostic(mapped.code, mapped.message)],
      };
    return {
      state: mapped.state,
      regionRevision: result.revision,
      value: { targetId, status: result.status, revision: result.revision },
    };
  }
  const state = result.status === 'needs-input' ? 'needs-choice' : result.status;
  return { state, diagnostics: [resultDiagnostic(result.status)] };
}

async function renderTarget(
  input: RenderInput,
  context: { readonly signal: AbortSignal },
  target: AgentSurfaceTarget,
  scope: { readonly getSnapshot: () => ScopeSnapshot },
): Promise<AgentCapabilityHandlerResult<AgentJsonValue>> {
  const initialScope = scope.getSnapshot();
  const surface = surfaceOf(target);
  if (surface === undefined || !currentTarget(target, initialScope))
    return { state: 'stale', diagnostics: [diagnostic('agent.bridge.stale', 'The surface target is stale.')] };
  let before: SurfaceSnapshot<unknown, unknown>;
  try {
    before = surface.getSnapshot();
  } catch {
    return {
      state: 'failed',
      diagnostics: [diagnostic('agent.bridge.target-read', 'The surface target could not be read.')],
    };
  }
  let result: AgentSurfaceRenderResult;
  try {
    result =
      target.render === undefined
        ? await defaultRender(target, input.intent, before.address, context.signal)
        : await target.render({ targetId: input.targetId, intent: input.intent, signal: context.signal });
  } catch {
    return { state: 'failed', diagnostics: [diagnostic('agent.bridge.render', 'The surface renderer failed safely.')] };
  }
  return surfaceResult(result, input.targetId, before, target, scope.getSnapshot());
}

async function defaultRender(
  target: AgentSurfaceTarget,
  intent: AgentJsonValue,
  address: SurfaceAddress,
  signal: AbortSignal,
): Promise<AgentSurfaceRenderResult> {
  const surface = surfaceOf(target);
  if (surface === undefined) return { status: 'failed', diagnosticCode: 'agent.bridge.target-invalid' };
  const result = await surface.request(intent as SurfaceRequest<unknown>, { signal, expectedAddress: address });
  switch (result.status) {
    case 'committed':
      return { status: 'committed', revision: result.revision };
    case 'proposed':
    case 'needs-input':
      return { status: 'needs-input', diagnosticCode: result.status };
    case 'disposed':
      return { status: 'failed', diagnosticCode: result.diagnosticCode };
    default:
      return { status: result.status, diagnosticCode: result.diagnosticCode };
  }
}

function contextManifest(
  options: ScopedSurfaceEndpointOptions,
  targets: ReadonlyMap<string, AgentSurfaceTarget>,
): AgentCapabilityManifest<ContextInput, AgentJsonValue> {
  return {
    ref: { id: 'aeliqo.browser.context', revision: '1' },
    operation: 'catalog.read',
    label: 'Inspect explicitly allowed Varendo surfaces',
    description: 'Returns bounded target metadata for the current scope. It never returns rows or credentials.',
    parse: parseContext,
    invoke: () => {
      const current = scopeAuthority(options, targets);
      if (!current.ok) return { state: 'stale', diagnostics: current.diagnostics };
      const snapshot = options.scope.getSnapshot();
      const context = targetContext(targets, snapshot);
      if (!context.ok) return { state: 'stale', diagnostics: context.diagnostics };
      return { state: 'data-ready', value: context.value };
    },
  };
}

function renderManifest(
  options: ScopedSurfaceEndpointOptions,
  targets: ReadonlyMap<string, AgentSurfaceTarget>,
): AgentCapabilityManifest<RenderInput, AgentJsonValue> {
  return {
    ref: { id: 'aeliqo.browser.render', revision: '1' },
    operation: 'experience.commit',
    label: 'Render a validated intent on an allowed surface',
    description: 'Routes a typed intent through the selected surface and reports its actual commit stage.',
    parse: parseRender,
    async invoke(input, context) {
      const current = scopeAuthority(options, targets);
      if (!current.ok) return { state: 'stale', diagnostics: current.diagnostics };
      const target = targets.get(input.targetId);
      if (target === undefined)
        return {
          state: 'denied',
          diagnostics: [diagnostic('agent.bridge.target-denied', 'The target is not allowed.')],
        };
      return renderTarget(input, context, target, options.scope);
    },
  };
}

function endpointTools(): readonly AgentToolDefinition[] {
  return Object.freeze([
    {
      name: 'aeliqo_surface_context',
      capability: { id: 'aeliqo.browser.context', revision: '1' },
      operation: 'catalog.read' as const,
      description: 'Inspect explicitly allowed Varendo surfaces.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'aeliqo_surface_render',
      capability: { id: 'aeliqo.browser.render', revision: '1' },
      operation: 'experience.commit' as const,
      description: 'Render a registered intent on one explicitly allowed surface.',
      inputSchema: {
        type: 'object',
        properties: { targetId: { type: 'string' }, intent: { type: 'object' } },
        required: ['targetId', 'intent'],
        additionalProperties: false,
      },
    },
  ]);
}

function targetMap(targets: readonly AgentSurfaceTarget[]): Outcome<ReadonlyMap<string, AgentSurfaceTarget>> {
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS)
    return failure('agent.bridge.targets', 'The target allowlist is outside its bounded limit.');
  const output = new Map<string, AgentSurfaceTarget>();
  for (const target of targets) {
    if (!validId(target?.id) || output.has(target.id) || surfaceOf(target) === undefined)
      return failure('agent.bridge.targets', 'Target IDs must resolve to unique trusted surfaces.');
    output.set(target.id, target);
  }
  return { ok: true, value: output };
}

function validEndpointOptions(options: ScopedSurfaceEndpointOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    (options.grants === undefined || Array.isArray(options.grants)) &&
    validId(options.sessionId) &&
    validId(options.goalEpoch) &&
    Number.isFinite(options.expiresAt) &&
    options.expiresAt > (options.now?.() ?? Date.now())
  );
}

/** Builds one scope/session-bound endpoint around the existing capability dispatcher. */
export function createScopedSurfaceEndpoint(options: ScopedSurfaceEndpointOptions): Outcome<AgentModelToolEndpoint> {
  if (!validEndpointOptions(options))
    return failure('agent.bridge.invalid', 'A scoped agent endpoint requires a bounded expiring pairing.');
  const mapped = targetMap(options.targets);
  if (!mapped.ok) return mapped;
  const registry = createAgentCapabilityRegistry([
    contextManifest(options, mapped.value) as unknown as AgentCapabilityManifest,
    renderManifest(options, mapped.value) as unknown as AgentCapabilityManifest,
  ]);
  if (!registry.ok) return registry;
  const snapshot = options.scope.getSnapshot();
  const principalKey = `bridge-${snapshot.scopeInstanceId}-${snapshot.activationEpoch}`;
  const endpoint = createAgentToolEndpoint({
    transport: options.transport,
    targetRegionId: options.sessionId,
    goalEpoch: options.goalEpoch,
    principalKey,
    expiresAt: options.expiresAt,
    registry: registry.value,
    tools: endpointTools(),
    host: {
      readContext: () => {
        const authority = scopeAuthority(options, mapped.value);
        if (!authority.ok) return authority;
        return { ok: true, value: authority.value };
      },
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    ...(options.maxMilliseconds === undefined ? {} : { maxMilliseconds: options.maxMilliseconds }),
    ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
  });
  return endpoint;
}
