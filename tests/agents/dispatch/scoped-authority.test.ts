import { describe, expect, it } from 'vitest';
import type { OperationGrant } from '../../../packages/core/src/contracts/agent/index.js';
import { createScopedSurfaceEndpoint } from '../../../packages/agent/src/browser/endpoint.js';
import type { AgentSurfaceTarget, ScopedSurfaceEndpointOptions } from '../../../packages/agent/src/browser/types.js';
import type { ScopeController, ScopeSnapshot } from '../../../packages/runtime/src/scopes/types.js';
import type { SurfaceController, SurfaceSnapshot } from '../../../packages/runtime/src/surfaces/types.js';

const ALL_GRANTS: readonly OperationGrant[] = [
  'catalog.read',
  'result.inspect',
  'task.propose',
  'task.evaluate',
  'experience.propose',
  'experience.commit',
  'meaning.propose',
  'meaning.activate',
  'action.propose',
  'action.execute',
  'model.egress',
];

const SCOPE_SNAPSHOT: ScopeSnapshot = {
  runtimeId: 'runtime',
  scopeInstanceId: 'scope-1',
  activationEpoch: 7,
  active: true,
  permissionRevision: 1,
  status: 'active',
  selector: { kind: 'workspace', id: 'acme' },
  revision: 'rev-1',
};

function scope(): ScopeController {
  return {
    getSnapshot: () => SCOPE_SNAPSHOT,
    authorize: () => ({ ok: true, value: undefined }),
    subscribe: () => () => {},
    attach: () => () => {},
    requestChange: async () => ({ status: 'active', selector: SCOPE_SNAPSHOT.selector!, activationEpoch: 7 }),
    invalidate: () => {},
    dispose: () => {},
  };
}

const SURFACE_SNAPSHOT: SurfaceSnapshot<unknown, unknown> = {
  id: 'orders',
  address: {
    runtimeId: 'runtime',
    scopeInstanceId: 'scope-1',
    activationEpoch: 7,
    surfaceId: 'orders',
    surfaceGeneration: 1,
  },
  revision: 'rev-1',
  phase: 'ready',
  intent: {},
  state: {},
};

function target(): AgentSurfaceTarget {
  const surface: SurfaceController<unknown, unknown> = {
    id: 'orders',
    address: SURFACE_SNAPSHOT.address,
    getSnapshot: () => SURFACE_SNAPSHOT,
    subscribe: () => () => {},
    request: async () => ({ status: 'denied', diagnosticCode: 'unused' }),
    dispose: () => {},
  };
  return { id: 'orders', surface };
}

function endpoint(overrides: Partial<ScopedSurfaceEndpointOptions> = {}) {
  const outcome = createScopedSurfaceEndpoint({
    scope: scope(),
    sessionId: 'session-1',
    goalEpoch: 'goal-1',
    targets: [target()],
    transport: 'manual',
    expiresAt: 60_000,
    now: () => 0,
    ...overrides,
  });
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
}

describe('scoped surface endpoint authority', () => {
  it('clamps a superset grant request instead of unioning it', async () => {
    const broad = endpoint({ grants: ALL_GRANTS });
    // 'manual' pairings never mint model.egress, even when the host ceiling allows it.
    await expect(broad.authorizeModel()).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'agent.protocol.egress' }],
    });
    // Discovery stays bounded to the two registered tools.
    await expect(broad.discover()).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'aeliqo_surface_context' }, { name: 'aeliqo_surface_render' }],
    });
  });

  it('drops tools the host ceiling does not cover', async () => {
    // 'manual' discovery is local: a ceiling without experience.commit filters the render tool out.
    const readOnly = endpoint({ grants: ['catalog.read'] });
    await expect(readOnly.discover()).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'aeliqo_surface_context' }],
    });
    // Exactly one tool survives; the render tool is filtered by the ceiling.
    const discovered = await readOnly.discover();
    expect(discovered.ok && discovered.value.length).toBe(1);
    await expect(readOnly.authorizeModel()).resolves.toMatchObject({ ok: false });
  });

  it('treats external tool discovery as egress', async () => {
    // On 'mcp' the tool list itself is external metadata: without model.egress in the ceiling it is denied.
    const external = endpoint({ transport: 'mcp', grants: ['catalog.read', 'experience.commit'] });
    await expect(external.discover()).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'agent.protocol.egress' }],
    });
  });

  it('mints model.egress only on external transports within the ceiling', async () => {
    const external = endpoint({ transport: 'webmcp', grants: ALL_GRANTS });
    await expect(external.authorizeModel()).resolves.toMatchObject({ ok: true });
  });
});
