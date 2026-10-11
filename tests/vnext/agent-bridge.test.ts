import { expect, it } from 'vitest';
import type { AgentJsonValue } from '../../packages/agent/src/capabilities/types.js';
import type { AgentClient, AgentSurfaceTarget } from '../../packages/agent/src/browser/types.js';
import type { ToolModelRequest, ToolModelResponse } from '../../packages/agent/src/model/types.js';
import { connectAgent } from '../../packages/agent/src/browser/bridge.js';
import { createAgentFixture } from './fixtures/agent.js';
import { createScopeFixture } from './fixtures/scope.js';

const renderCall = (intent: AgentJsonValue = { kind: 'browse' }, targetId = 'people-main') => ({
  id: 'render-1',
  name: 'aeliqo_surface_render',
  input: { targetId, intent },
});

const committedResponse = (intent: AgentJsonValue = { kind: 'browse' }): ToolModelResponse => ({
  text: 'Done',
  calls: [renderCall(intent)],
  usage: { inputTokens: 10, outputTokens: 5 },
});

it('does not claim success for model prose without a renderer receipt', async () => {
  const f = createAgentFixture({
    modelResponse: { text: 'Done', calls: [], usage: { inputTokens: 10, outputTokens: 5 } },
  });
  const initial = f.initialSnapshot;
  const result = await f.runExperience('Show Engineering');
  expect(result).toMatchObject({ ok: true, value: { stop: 'no-commit', receipts: [] } });
  expect(f.surface.getSnapshot()).toEqual(initial);
  await f.dispose();
});

it('uses the same surface request and renderer receipt path as manual intent', async () => {
  const f = createAgentFixture({
    modelResponse: committedResponse({
      kind: 'browse',
      filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
    }),
  });
  const result = await f.runExperience('Show Engineering');
  expect(result).toMatchObject({
    ok: true,
    value: { stop: 'renderer-ready', receipts: [{ state: 'renderer-ready' }] },
  });
  expect(f.surface.getSnapshot().state.rows).toEqual([{ id: 'sam', name: 'Sam Rivera', team: 'Engineering' }]);
  await f.dispose();
});

it('rejects a forged renderer acknowledgement without adding a commit receipt', async () => {
  const f = createAgentFixture({
    modelResponse: committedResponse({ kind: 'browse' }),
    render: async () => ({ status: 'renderer-ready' as const, revision: 'forged-revision' }),
  });
  const initial = f.initialSnapshot;
  const result = await f.runExperience('Show the current people');
  expect(result).toMatchObject({
    ok: true,
    value: { stop: 'failed', receipts: [{ state: 'failed', diagnostics: [{ code: 'agent.bridge.renderer-ack' }] }] },
  });
  expect(f.surface.getSnapshot()).toEqual(initial);
  await f.dispose();
});

it('exposes only bounded metadata for explicit targets and rejects another target', async () => {
  const f = createAgentFixture();
  const discovered = await f.connection.discover();
  expect(discovered).toMatchObject({
    ok: true,
    value: [{ name: 'aeliqo_surface_context' }, { name: 'aeliqo_surface_render' }],
  });
  const context = await f.connection.invoke('aeliqo_surface_context', {});
  expect(context).toMatchObject({
    ok: true,
    value: { state: 'data-ready', value: { targets: [{ id: 'people-main' }] } },
  });
  expect(JSON.stringify(context)).not.toContain('Ada Chen');
  const denied = await f.connection.render('other-surface', { kind: 'browse' });
  expect(denied).toMatchObject({
    ok: true,
    value: { state: 'denied', diagnostics: [{ code: 'agent.bridge.target-denied' }] },
  });
  await f.dispose();
});

it('closes the scoped endpoint on disconnect and cancels a pending model request', async () => {
  const f = createAgentFixture({
    modelResponse: committedResponse(),
    onComplete: () => undefined,
  });
  f.connection.disconnect();
  await expect(f.connection.runExperience('Show Engineering')).resolves.toMatchObject({
    ok: false,
    diagnostics: [{ code: 'agent.bridge.disconnected' }],
  });
  expect(f.connection.inspect().status).toBe('disconnected');
  await f.dispose();
});

it('fences a late A1 response and starts B then A2 with fresh scoped model contexts', async () => {
  const scopeFixture = await createScopeFixture();
  await scopeFixture.activate('acme');
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let completions = 0;
  const requests: string[] = [];
  const model = {
    estimateInputTokens: () => 10,
    complete: async (request: ToolModelRequest, _options: { readonly signal: AbortSignal }) => {
      requests.push(JSON.stringify(request.messages));
      completions += 1;
      if (completions === 1) {
        markStarted();
        await waiting;
        return { text: 'late A', calls: [], usage: { inputTokens: 10, outputTokens: 5 } };
      }
      return {
        calls: [renderCall({ kind: 'browse' }, 'orders')],
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  const client: AgentClient = {
    kind: 'host-agent-client',
    model,
    resolveTarget: () => {
      const surface = scopeFixture.currentOrders();
      const target: AgentSurfaceTarget = {
        id: 'orders',
        surface,
        render: async ({ intent, signal }) => {
          const result = await surface.request(intent as never, { signal, expectedAddress: surface.address });
          return result.status === 'committed'
            ? { status: 'renderer-ready' as const, revision: result.revision }
            : { status: 'failed' as const, diagnosticCode: result.status };
        },
      };
      return target;
    },
  };
  const connection = connectAgent({ scope: scopeFixture.scope, client, targets: ['orders'] });
  const oldEndpoint = connection.endpoint;
  const oldRun = connection.runExperience('A-marker');
  await started;
  await scopeFixture.activate('globex');
  release();
  if (oldEndpoint === undefined) throw new TypeError('The active scope did not produce an endpoint.');
  await expect(oldEndpoint.discover()).resolves.toMatchObject({
    ok: false,
    diagnostics: [{ code: expect.stringMatching(/^agent\.protocol\.(stale|cancelled)$/u) }],
  });
  await expect(oldRun).resolves.toMatchObject({
    ok: true,
    value: { stop: expect.stringMatching(/^(cancelled|stale)$/u) },
  });
  const next = await connection.runExperience('B-marker');
  expect(next).toMatchObject({ ok: true, value: { stop: 'renderer-ready' } });
  expect(requests.at(-1)).not.toContain('A-marker');
  const bSession = connection.inspect().sessionId;
  const bEpoch = connection.inspect().activationEpoch;
  await scopeFixture.activate('acme');
  const secondA = await connection.runExperience('A2-marker');
  expect(secondA).toMatchObject({ ok: true, value: { stop: 'renderer-ready' } });
  expect(requests.at(-1)).not.toContain('A-marker');
  expect(requests.at(-1)).not.toContain('B-marker');
  expect(connection.inspect().sessionId).not.toBe(bSession);
  expect(connection.inspect().activationEpoch).toBeGreaterThan(bEpoch ?? 0);
  connection.disconnect();
  await scopeFixture.dispose();
});
