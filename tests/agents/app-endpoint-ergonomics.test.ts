import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineResource } from '../../packages/core/src/index.js';
import { AELIQO_AGENT_INSTRUCTIONS, createAppToolEndpoint } from '../../packages/agent/src/app/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';

type Json = Record<string, unknown>;

function setup() {
  const people = defineResource({
    id: 'people',
    revision: '1',
    label: 'People',
    identity: ['id'],
    schema: z.object({
      id: z.string(),
      name: z.string(),
      team: z.enum(['Design', 'Engineering']),
      joined: z.iso.date(),
    }),
    fields: { team: { role: 'dimension' }, joined: { role: 'time' } },
    measures: { hires: { label: 'New hires', aggregate: 'count' } },
    presentation: { allowedViews: ['table', 'cards', 'trend', 'bar'] },
  });
  const access = { scopeDigest: 'scope-1', policyRevision: 'policy-1' };
  const data = createLocalDataService({
    snapshot: {
      catalog: people.catalog,
      sourceRevision: '1',
      records: {
        people: [
          { id: 'ada', name: 'Ada', team: 'Design', joined: '2026-01-12' },
          { id: 'sam', name: 'Sam', team: 'Engineering', joined: '2026-02-03' },
        ],
      },
    },
    authorize: () => ({ ok: true, value: access }),
  });
  const runtime = createAeliqoRuntime({
    resources: [{ resource: people, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'person-1',
          ...access,
          experienceRevision: 'experience-1',
          grants: ['catalog.read', 'task.propose', 'task.evaluate', 'experience.commit', 'result.inspect'],
          readContext: {},
        },
      }),
    },
  });
  runtime.mount({ regionId: 'main', resourceId: 'people' });
  const endpoint = createAppToolEndpoint({
    runtime,
    regionId: 'main',
    goalEpoch: 'goal-1',
    transport: 'manual',
    expiresAt: Date.now() + 60_000,
  });
  if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
  return { runtime, endpoint: endpoint.value };
}

async function render(endpoint: ReturnType<typeof setup>['endpoint'], intent: Json, requestId: string) {
  const result = await endpoint.invoke('aeliqo_render', intent, { requestId });
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  return result.value;
}

describe('agent-friendly app tools', () => {
  it('documents the render tool and relaxes only the generated intent fields', async () => {
    const { runtime, endpoint } = setup();
    const tools = await endpoint.discover();
    if (!tools.ok) throw new Error(tools.diagnostics[0].message);
    const renderTool = tools.value.find((tool) => tool.name === 'aeliqo_render')!;
    expect(renderTool.description).toContain('aeliqo_context');
    expect(renderTool.description).toContain('"kind":"analyze"');
    expect(renderTool.description).toContain('"renderer-ready" confirms the host showed the view');
    expect(renderTool.description).toContain('"plan-committed" confirms only that the plan committed');
    expect(renderTool.description).toContain('retry only when they identify a correctable input');
    expect(renderTool.description.length).toBeLessThanOrEqual(4096);
    const branches = (renderTool.inputSchema as { oneOf: Json[] }).oneOf;
    const analyze = branches.find(
      (branch) => (branch.properties as Json).kind && JSON.stringify(branch).includes('"analyze"'),
    )!;
    expect(analyze.required).toEqual(['resource', 'kind', 'measures']);
    const properties = analyze.properties as Record<string, Json>;
    expect(properties.measures!.description).toContain('revision is optional');
    expect(JSON.stringify(properties.measures)).not.toContain('"required":["id","revision"]');
    expect((properties.time!.properties as Record<string, Json>).grain).toEqual({
      type: 'string',
      enum: ['day', 'week', 'month', 'quarter', 'year'],
    });
    expect(tools.value.find((tool) => tool.name === 'aeliqo_context')!.description).toContain('examples');
    endpoint.close();
    runtime.dispose();
  });

  it('returns ready-to-send examples, view purposes, and time grains that all render', async () => {
    const { runtime, endpoint } = setup();
    const context = await endpoint.invoke('aeliqo_context', {}, { requestId: 'context-1' });
    if (!context.ok) throw new Error(context.diagnostics[0].message);
    const value = (context.value as { value: Json }).value;
    expect(value.timeGrains).toEqual(['day', 'week', 'month', 'quarter', 'year']);
    const people = (value.resources as Json[])[0]!;
    expect(people.viewGuide).toMatchObject({ trend: expect.stringContaining('over time'), bar: expect.any(String) });
    const examples = people.examples as Json[];
    expect(examples.map((example) => example.kind)).toEqual(['browse', 'browse', 'analyze', 'analyze']);
    for (const [index, example] of examples.entries()) {
      const rendered = await render(endpoint, example, `example-${index}`);
      expect(rendered.state, JSON.stringify(rendered)).toBe('plan-committed');
    }
    endpoint.close();
    runtime.dispose();
  });

  it('accepts a minimal trend intent without version, id, revision, calendar, or timezone', async () => {
    const { runtime, endpoint } = setup();
    const rendered = await render(
      endpoint,
      { kind: 'analyze', resource: 'people', measures: [{ id: 'hires' }], time: { field: 'joined', grain: 'month' } },
      'trend-1',
    );
    expect(rendered.state, JSON.stringify(rendered)).toBe('plan-committed');
    endpoint.close();
    runtime.dispose();
  });

  it('still rejects an invented measure with a diagnostic that names it', async () => {
    const { runtime, endpoint } = setup();
    const result = await endpoint.invoke(
      'aeliqo_render',
      { kind: 'analyze', resource: 'people', measures: [{ id: 'salary' }] },
      { requestId: 'invented-1' },
    );
    expect(JSON.stringify(result)).toContain('salary');
    expect(JSON.stringify(result)).toContain('hires@1');
    expect(result.ok && result.value.state).not.toBe('plan-committed');
    endpoint.close();
    runtime.dispose();
  });

  it('explains the expected object shape when measures are sent as strings', async () => {
    const { runtime, endpoint } = setup();
    const result = await endpoint.invoke(
      'aeliqo_render',
      { kind: 'analyze', resource: 'people', measures: ['hires'] },
      { requestId: 'measure-shape-1' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.value.diagnostics[0]?.message).toContain('must be an object with an id');
    expect(result.value.diagnostics[0]?.message).toContain('{"id":"hires"}');
    expect(result.value.diagnostics[0]?.message).not.toContain('Measure hires is not declared');
    endpoint.close();
    runtime.dispose();
  });

  it('lists valid context values when a field, view, filter value, or time grain is rejected', async () => {
    const { runtime, endpoint } = setup();
    const cases = [
      {
        input: { kind: 'browse', resource: 'people', fields: ['squad'] },
        expected: '"id", "name", "team", "joined"',
      },
      {
        input: { kind: 'browse', resource: 'people', preferredView: 'donut' },
        expected: '"table", "cards", "trend", "bar"',
      },
      {
        input: {
          kind: 'browse',
          resource: 'people',
          filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Platform' },
        },
        expected: '"Design", "Engineering"',
      },
      {
        input: {
          kind: 'analyze',
          resource: 'people',
          measures: [{ id: 'hires' }],
          time: { field: 'joined', grain: 'fortnight' },
        },
        expected: 'day, week, month, quarter, year',
      },
    ];

    for (const [index, item] of cases.entries()) {
      const result = await endpoint.invoke('aeliqo_render', item.input, { requestId: `invalid-${index}` });
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.value.diagnostics[0]?.message, JSON.stringify(result.value.diagnostics)).toContain(item.expected);
    }
    endpoint.close();
    runtime.dispose();
  });

  it('exports recommended model instructions', () => {
    expect(AELIQO_AGENT_INSTRUCTIONS).toContain('aeliqo_context');
    expect(AELIQO_AGENT_INSTRUCTIONS.length).toBeLessThanOrEqual(16_384);
  });
});
