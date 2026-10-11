import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineResource } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createAppToolEndpoint } from '../../packages/agent/src/app/index.js';
import { createAeliqoRuntime, type RuntimeResourceContext } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';
import { ActionRegistry, createActionPort } from '../../packages/runtime/src/actions/index.js';

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setup() {
  const resource = defineResource({
    id: 'people',
    label: 'People',
    description: 'People directory',
    revision: '1',
    identity: ['id'],
    schema: z.object({ id: z.string(), name: z.string(), team: z.enum(['Platform', 'Research']) }),
    fields: { team: { role: 'dimension' } },
    presentation: { allowedViews: ['table', 'cards'] },
    forms: {
      create: { schema: { id: 'people.create.input', revision: '1' }, action: { id: 'people.create', revision: '1' } },
    },
  });
  const registry = createQueryFunctionRegistry({ version: '2' });
  if (!registry.ok) throw new Error('query registry unavailable');
  const data = createLocalDataService({
    snapshot: {
      catalog: resource.catalog,
      sourceRevision: '1',
      records: {
        people: [
          { id: 'p-1', name: 'Ada', team: 'Platform' },
          { id: 'p-2', name: 'Grace', team: 'Research' },
        ],
      },
    },
    functionRegistry: registry.value,
    authorize: () => ({ ok: true, value: { scopeDigest: 'scope-1', policyRevision: 'policy-1' } }),
  });
  const actions = new ActionRegistry();
  let executions = 0;
  const registered = actions.register({
    descriptor: {
      ref: { id: 'people.create', revision: '1' },
      input: { id: 'people.create.input', revision: '1' },
      output: { id: 'people.create.output', revision: '1' },
      sideEffect: 'domain-write',
      confirmation: 'required',
      idempotency: 'required',
      entityRevision: 'none',
    },
    inputSchema: { ref: { id: 'people.create.input', revision: '1' }, parse: (input) => resource.parseRecord(input) },
    outputSchema: {
      ref: { id: 'people.create.output', revision: '1' },
      parse(input) {
        return record(input) && input.saved === true
          ? { ok: true, value: { saved: true } }
          : { ok: false, diagnostics: [{ code: 'test.output', message: 'Invalid output.', retryable: false }] };
      },
    },
    dispatch: () => {
      executions += 1;
      return { state: 'completed', output: { saved: true } };
    },
  });
  if (!registered.ok) throw new Error('action registry unavailable');
  const actionPort = createActionPort({
    registry: actions,
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: 'person-1',
          actorKey: 'person-1',
          scopeDigest: 'scope-1',
          policyRevision: 'policy-1',
          domainRevision: 'domain-1',
          confirmationEpoch: 'confirmation-1',
          grants: ['action.propose', 'action.execute'],
        },
      }),
      issueConfirmation: () => ({ ok: true, value: undefined }),
    },
  });
  const runtime = createAeliqoRuntime({
    resources: [{ resource, data }],
    actionPort,
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'person-1',
          scopeDigest: 'scope-1',
          policyRevision: 'policy-1',
          experienceRevision: 'experience-1',
          grants: [
            'catalog.read',
            'task.propose',
            'task.evaluate',
            'experience.commit',
            'result.inspect',
            'action.propose',
            'action.execute',
            'model.egress',
          ],
          readContext: { principal: 'person-1' },
        },
      }),
    },
  });
  runtime.mount({ regionId: 'main', resourceId: 'people' });
  return { runtime, actionPort, executions: () => executions };
}

describe('standard app tool endpoint', () => {
  it('exposes exactly context, render, and act for one paired Region', async () => {
    const { runtime } = setup();
    const endpoint = createAppToolEndpoint({
      runtime,
      regionId: 'main',
      goalEpoch: 'goal-1',
      transport: 'manual',
      expiresAt: Date.now() + 60_000,
    });
    expect(endpoint).toMatchObject({ ok: true });
    if (!endpoint.ok) return;
    const tools = await endpoint.value.discover();
    if (!tools.ok) throw new Error(tools.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
    expect(tools.ok && tools.value.map((tool) => tool.name)).toEqual(['aeliqo_context', 'aeliqo_render', 'aeliqo_act']);
    const context = await endpoint.value.invoke('aeliqo_context', {}, { requestId: 'context-1' });
    expect(context).toMatchObject({
      ok: true,
      value: {
        state: 'accepted',
        value: {
          activeResource: 'people',
          resources: [
            {
              resource: { id: 'people' },
              fields: expect.arrayContaining([
                expect.objectContaining({ id: 'team', values: ['Platform', 'Research'] }),
              ]),
            },
          ],
        },
      },
    });
    expect(JSON.stringify(context)).not.toContain('principalKey');
    expect(JSON.stringify(context)).not.toContain('scopeDigest');
    endpoint.value.close();
    runtime.dispose();
  });

  it('uses an explicit trusted discovery port when the render host can route multiple resources', async () => {
    const { runtime } = setup();
    const active = runtime.context('main');
    if (!active.ok) throw new Error(active.diagnostics[0].message);
    const secondary: RuntimeResourceContext = {
      ...active.value,
      resource: { id: 'absences', label: 'Absence history' },
      fields: [
        {
          id: 'week',
          label: 'Week',
          role: 'time',
          type: { value: 'date', nullable: false, temporal: { calendar: 'gregorian', grain: 'day' } },
        },
        { id: 'absence_days', label: 'Absence days', role: 'measure', type: { value: 'integer', nullable: false } },
      ],
      meanings: [
        {
          id: 'absence-days-total',
          revision: '1',
          label: 'Total absence days',
          explanation: 'Sum of absence days.',
          output: { value: 'integer', nullable: false },
          aggregation: 'additive',
        },
      ],
      views: ['table', 'trend'],
    };
    const endpoint = createAppToolEndpoint({
      runtime,
      regionId: 'main',
      goalEpoch: 'goal-multi-resource',
      transport: 'manual',
      expiresAt: Date.now() + 60_000,
      context: { read: () => ({ ok: true, value: [active.value, secondary] }) },
    });
    if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
    const context = await endpoint.value.invoke('aeliqo_context', {}, { requestId: 'context-multi' });
    expect(context).toMatchObject({
      ok: true,
      value: {
        state: 'accepted',
        value: {
          activeResource: 'people',
          resources: [
            { resource: { id: 'people' } },
            {
              resource: { id: 'absences' },
              meanings: [{ id: 'absence-days-total', revision: '1' }],
              views: ['table', 'trend'],
            },
          ],
        },
      },
    });
    endpoint.value.close();
    runtime.dispose();
  });

  it('uses the runtime pipeline and does not misreport a runtime commit as browser-ready', async () => {
    const { runtime } = setup();
    const endpoint = createAppToolEndpoint({
      runtime,
      regionId: 'main',
      goalEpoch: 'goal-1',
      transport: 'manual',
      expiresAt: Date.now() + 60_000,
    });
    if (!endpoint.ok) throw new Error(endpoint.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
    const rendered = await endpoint.value.invoke(
      'aeliqo_render',
      {
        version: '1',
        id: 'browse-people',
        kind: 'browse',
        resource: 'people',
        fields: ['name', 'team'],
        search: { text: 'platform', fields: ['team'] },
      },
      { requestId: 'render-1' },
    );
    if (!rendered.ok || rendered.value.state !== 'plan-committed')
      throw new Error(
        JSON.stringify({ rendered, context: runtime.context('main'), snapshot: runtime.snapshot('main') }),
      );
    expect(rendered).toMatchObject({
      ok: true,
      value: { state: 'plan-committed', status: 'plan-committed', value: { status: 'committed' } },
    });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'committed', task: { id: 'browse-people' } });
    endpoint.value.close();
    runtime.dispose();
  });

  it('keeps confirmation host-owned, executes once, and cancels previews when the pairing closes', async () => {
    const { runtime, actionPort, executions } = setup();
    const endpoint = createAppToolEndpoint({
      runtime,
      regionId: 'main',
      goalEpoch: 'goal-actions',
      transport: 'manual',
      expiresAt: Date.now() + 60_000,
    });
    if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
    const preview = await endpoint.value.invoke(
      'aeliqo_act',
      {
        mode: 'preview',
        action: { id: 'people.create', revision: '1' },
        input: { id: 'p-3', name: 'Lin', team: 'Platform' },
        idempotencyKey: 'create-p-3',
      },
      { requestId: 'action-preview-1' },
    );
    if (!preview.ok || !record(preview.value.value) || typeof preview.value.value.previewId !== 'string')
      throw new Error(`Expected an action preview: ${JSON.stringify(preview)}`);
    const previewId = preview.value.value.previewId;
    expect(preview.value.state).toBe('needs-choice');
    await expect(
      endpoint.value.invoke('aeliqo_act', { mode: 'execute', previewId }, { requestId: 'action-execute-early' }),
    ).resolves.toMatchObject({ ok: true, value: { state: 'needs-choice' } });
    expect(executions()).toBe(0);

    await expect(endpoint.value.confirmAction(previewId)).resolves.toMatchObject({ ok: true });
    await expect(
      endpoint.value.invoke('aeliqo_act', { mode: 'execute', previewId }, { requestId: 'action-execute-1' }),
    ).resolves.toMatchObject({ ok: true, value: { state: 'accepted', value: { state: 'executed' } } });
    expect(executions()).toBe(1);

    const abandoned = await endpoint.value.invoke(
      'aeliqo_act',
      {
        mode: 'preview',
        action: { id: 'people.create', revision: '1' },
        input: { id: 'p-4', name: 'Rin', team: 'Research' },
        idempotencyKey: 'create-p-4',
      },
      { requestId: 'action-preview-2' },
    );
    expect(abandoned).toMatchObject({ ok: true, value: { state: 'needs-choice' } });
    endpoint.value.close();
    const history = await actionPort.history();
    expect(history.ok && history.value.at(-1)).toMatchObject({ state: 'rejected', reasonCode: 'action.cancelled' });
    runtime.dispose();
  });
});
