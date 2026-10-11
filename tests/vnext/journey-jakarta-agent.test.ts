import { expect, it } from 'vitest';
import { z } from 'zod';
import { parseWireValue, type Intent } from '@varendo/core';
import { defineDataFeature } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createAeliqoRuntime, createLocalDataBinding } from '@varendo/runtime';
import { connectAgent, type AgentClient } from '@varendo/agent/browser';
import type { AgentJsonValue } from '@varendo/agent/capabilities';

const Person = z.object({ id: z.string(), name: z.string(), team: z.string(), location: z.string() });
const people = defineDataFeature({
  id: 'people',
  schema: Person,
  identity: ['id'],
  fields: { team: { role: 'dimension' }, location: { role: 'dimension' } },
});

function browse(id: string, location?: string): Intent {
  return {
    version: '1',
    id,
    kind: 'browse',
    resource: people.id,
    fields: ['id', 'name', 'team', 'location'],
    ...(location === undefined
      ? {}
      : { filter: { op: 'compare' as const, field: 'location', comparison: 'eq' as const, value: location } }),
  };
}

it('keeps a connected Jakarta proposal on the same authorized target and filter as manual browse', async () => {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  const binding = createLocalDataBinding({
    feature: people,
    snapshot: {
      catalog: people.catalog,
      sourceRevision: 'people-jakarta-1',
      records: {
        people: [
          { id: 'ada', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
          { id: 'sam', name: 'Sam Rivera', team: 'Engineering', location: 'Bandung' },
          { id: 'iman', name: 'Iman Putra', team: 'Operations', location: 'Surabaya' },
        ],
      },
    },
    initialState: { rows: [] as readonly z.infer<typeof Person>[] },
    coverage: {
      fields: ['id', 'name', 'team', 'location'],
      operators: ['eq', 'contains'],
      pagination: 'snapshot',
      stableOrder: ['id'],
      sorting: 'stable-fields-only',
      aggregation: 'unsupported',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['aggregation', 'streaming', 'live-updates'],
    },
    normalize: async (events) => {
      const rows: z.infer<typeof Person>[] = [];
      for await (const event of events) {
        if (event.kind === 'error') throw new TypeError(event.error.message);
        if (event.kind !== 'batch') continue;
        for (const row of event.rows) {
          const parsed = people.parseRecord(row);
          if (!parsed.ok) throw new TypeError(parsed.diagnostics[0].message);
          rows.push(parsed.value);
        }
      }
      return { rows };
    },
    serviceOptions: {
      functionRegistry: functions.value,
      authorize: ({ context }) =>
        context.principal === 'jakarta-user'
          ? { ok: true, value: { scopeDigest: 'jakarta-scope', policyRevision: '1' } }
          : { ok: false, diagnostics: [{ code: 'jakarta.denied', message: 'Read denied.', retryable: false }] },
    },
  });
  const runtime = createAeliqoRuntime({
    runtimeId: 'jakarta-runtime',
    resources: [{ resource: people.resource, data: binding.service }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'jakarta-user',
          scopeDigest: 'jakarta-scope',
          policyRevision: '1',
          experienceRevision: '1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: 'jakarta-user' },
        },
      }),
    },
  });
  const scope = runtime.createScope({
    id: 'jakarta-scope',
    initial: { kind: 'workspace', id: 'jakarta' },
    binding: {
      resolve: (selector) => ({
        ok: true,
        value: { selector, permissionRevision: 1, policyRevision: '1', allowedFeatures: [people.id] },
      }),
      authorize: () => ({ ok: true, value: undefined }),
      prepareActivation: () => ({ ok: true, value: undefined }),
      activate: () => undefined,
      deactivate: () => undefined,
    },
  });
  const detach = scope.attach();
  if (!scope.getSnapshot().active)
    await new Promise<void>((resolve) => {
      const stop = scope.subscribe(() => {
        if (!scope.getSnapshot().active) return;
        stop();
        resolve();
      });
    });
  const surface = runtime.createSurface({ scope, id: 'people-main', feature: people, bindings: binding });
  const manualIntent = browse('manual-jakarta', 'Jakarta');
  const agentIntent = browse('agent-jakarta', 'Jakarta');
  const serialized = parseWireValue(agentIntent);
  if (!serialized.ok) throw new TypeError(serialized.diagnostics[0].message);
  const agentWireIntent = serialized.value as AgentJsonValue;
  const calls = [
    {
      id: 'jakarta-render',
      name: 'aeliqo_surface_render',
      input: { targetId: 'people-main', intent: agentWireIntent },
    },
  ];
  const client: AgentClient = {
    kind: 'host-agent-client',
    model: {
      estimateInputTokens: () => 10,
      complete: async () => ({ text: 'Showing Jakarta.', calls, usage: { inputTokens: 10, outputTokens: 5 } }),
    },
    registeredTargets: [
      {
        id: 'people-main',
        surface,
        render: async ({ intent, signal }) => {
          const result = await surface.request(intent as Intent, { signal, expectedAddress: surface.address });
          return result.status === 'committed'
            ? { status: 'renderer-ready' as const, revision: result.revision }
            : {
                status: 'failed' as const,
                diagnosticCode: 'diagnosticCode' in result ? result.diagnosticCode : result.status,
              };
        },
      },
    ],
  };
  const connection = connectAgent({ scope, client, targets: ['people-main'] });
  try {
    const context = await connection.invoke('aeliqo_surface_context', {});
    expect(context).toMatchObject({
      ok: true,
      value: { state: 'data-ready', value: { targets: [{ id: 'people-main', address: surface.address }] } },
    });
    expect(JSON.stringify(context)).not.toContain('Ada Chen');
    const manual = await surface.request(manualIntent, { expectedAddress: surface.address });
    expect(manual.status).toBe('committed');
    const manualRows = surface.getSnapshot().state.rows;
    expect(manualRows).toEqual([{ id: 'ada', name: 'Ada Chen', team: 'Design', location: 'Jakarta' }]);
    expect(await surface.request(browse('reset-all'), { expectedAddress: surface.address })).toMatchObject({
      status: 'committed',
    });
    const beforeAmbiguous = surface.getSnapshot();
    const ambiguous = await connection.invoke('aeliqo_surface_render', { intent: agentWireIntent });
    expect(ambiguous).toMatchObject({
      ok: true,
      value: { state: 'invalid', diagnostics: [{ code: 'agent.capability.input' }] },
    });
    expect(surface.getSnapshot()).toEqual(beforeAmbiguous);

    const result = await connection.runExperience('Show people in Jakarta on people-main.');
    expect(result).toMatchObject({
      ok: true,
      value: { stop: 'renderer-ready', receipts: [{ state: 'renderer-ready' }] },
    });
    expect(surface.getSnapshot().state.rows).toEqual(manualRows);
    expect(surface.getSnapshot().address).toEqual(beforeAmbiguous.address);
    expect(connection.inspect()).toMatchObject({
      status: 'connected',
      scopeInstanceId: surface.address.scopeInstanceId,
      activationEpoch: surface.address.activationEpoch,
      targets: ['people-main'],
    });
    const other = await connection.render('people-other', agentIntent);
    expect(other).toMatchObject({ ok: true, value: { state: 'denied' } });
  } finally {
    connection.disconnect();
    surface.dispose();
    detach();
    runtime.dispose();
  }
});
