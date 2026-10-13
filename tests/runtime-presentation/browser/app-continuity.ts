import { defineResource, type PresentationPlan, type Task } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import type { PresentationPatternManifest } from '@varendo/core/presentation';
import { createLocalDataService } from '@varendo/runtime/data';
import { html } from 'lit';
import { z } from 'zod';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';
import { defineRecipe, defineView, type RecipeContext } from '../../../packages/web/src/recipes/index.js';
import type { VarendoRegionElement } from '../../../packages/web/src/region/varendo-region.js';

const goal = { id: 'people.layout', revision: '1' } as const;
const read = { id: 'data.read', revision: '1' } as const;
const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string() }),
  fields: { name: { label: 'Name' }, id: { label: 'ID' } },
  presentation: { allowedViews: ['table', 'fixture.filter'] },
});
const layoutSchema = z.object({
  layout: z.enum(['workspace', 'page', 'reordered-page', 'missing-filter', 'new-goal']),
});
const registry = createIntentCompilerRegistry([
  {
    ref: goal,
    schema: layoutSchema,
    capabilities: ['data.read'],
    compile(raw, context) {
      const input = layoutSchema.parse(raw);
      const task: Task = {
        version: '1',
        id: input.layout,
        revision: context.taskRevision,
        catalogRevision: people.catalog.revision,
        functionRegistryDigest: people.catalog.functionRegistryDigest,
        regionId: context.regionId,
        kind: 'data',
        goal: input.layout,
        assumptions: [],
        outputs: [
          {
            id: 'primary',
            kind: 'query',
            query: {
              entity: 'people',
              fields: ['id', 'name'],
              measures: [],
              relations: [],
              groupBy: [],
              population: { kind: 'all-authorized' },
              ...(input.layout === 'new-goal'
                ? { where: { op: 'compare' as const, field: 'name', comparison: 'eq' as const, value: 'Grace' } }
                : {}),
              order: [],
            },
            dependsOn: [],
            delivery: 'eager',
          },
        ],
        needs: [{ id: 'people', operation: read, outputId: 'primary', fields: ['id', 'name'], required: true }],
      };
      return { ok: true, value: task };
    },
  },
]);
if (!registry.ok) throw Error('intent registry');
const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw Error('functions');
const data = createLocalDataService({
  snapshot: {
    catalog: people.catalog,
    sourceRevision: '1',
    records: {
      people: [
        { id: 'ada', name: 'Ada' },
        { id: 'grace', name: 'Grace' },
      ],
    },
  },
  functionRegistry: functions.value,
  authorize: () => ({ ok: true, value: { scopeDigest: 'scope', policyRevision: '1' } }),
});
let region: VarendoRegionElement | undefined;
function filterText(): string {
  const payload = region?.interaction?.values.find((value) => value.nodeId === 'filter')?.payload;
  if (payload?.kind !== 'filter') return '';
  const predicate = payload.predicates[0];
  return predicate?.op === 'compare' && typeof predicate.value === 'string' ? predicate.value : '';
}
const filter = defineView({
  ref: { id: 'fixture.filter', revision: '1' },
  manifest: {
    ref: { id: 'fixture.filter', revision: '1' },
    configSchema: { id: 'fixture.filter.config', revision: '1' },
    roles: ['filter'],
    operations: [],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: true,
    resolveConfig: (values) => ({
      ok: true,
      value: {
        values,
        fields: ['name'],
        ports: [
          { id: 'filter', direction: 'inout', payload: 'filter', entity: 'people', identity: ['id'], grain: ['id'] },
        ],
      },
    }),
  },
  render: () =>
    html`<label
      >Filter people<input
        aria-label="Filter people"
        .value=${filterText()}
        @input=${(event: Event) => {
          const value = (event.target as HTMLInputElement).value;
          region?.onSemanticInteraction?.({
            nodeId: 'filter',
            portId: 'filter',
            payload: {
              kind: 'filter',
              outputId: 'primary',
              predicates: [{ op: 'compare', field: 'name', comparison: 'eq', value }],
            },
          });
        }}
    /></label>`,
});
function structure(id: string, label: string) {
  return defineView({
    ref: { id, revision: '1' },
    manifest: {
      ref: { id, revision: '1' },
      configSchema: { id: id + '.config', revision: '1' },
      roles: ['structure'],
      operations: [],
      result: 'none',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: true,
      resolveConfig: (values) => ({ ok: true, value: { values, fields: [], ports: [] } }),
    },
    render: () => (id === 'fixture.header' ? html`<h1>${label}</h1>` : html`<aside>${label}</aside>`),
  });
}
const header = structure('fixture.header', 'People overview');
const sidebar = structure('fixture.sidebar', 'Host sidebar');
function layoutPlan(context: Pick<RecipeContext, 'task' | 'current' | 'result' | 'incumbent'>): PresentationPlan {
  if (context.result === undefined) throw Error('missing result');
  const layout = context.task.id;
  const extra = layout !== 'workspace';
  let children = extra ? ['header', 'sidebar', 'filter', 'people'] : ['filter', 'people'];
  if (layout === 'reordered-page') children = ['sidebar', 'header', 'filter', 'people'];
  if (layout === 'missing-filter') children = ['header', 'sidebar', 'people'];
  const structural = (id: string, ref: { id: string; revision: string }) => ({
    id,
    role: 'structure',
    representation: ref,
    config: { schema: { id: ref.id + '.config', revision: '1' }, values: {} },
    children: [],
  });
  const nodes: PresentationPlan['nodes'][number][] = [
    {
      id: 'workspace',
      role: 'structure',
      representation: { id: 'layout.stack', revision: '1' },
      config: { schema: { id: 'layout.stack.config', revision: '1' }, values: {} },
      children,
    },
    {
      id: 'people',
      role: 'table',
      representation: { id: 'data.table', revision: '1' },
      result: context.result.ref,
      config: {
        schema: { id: 'data.table.config', revision: '1' },
        values: {
          selection: 'multiple',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
          ],
        },
      },
      children: [],
    },
  ];
  if (layout !== 'missing-filter')
    nodes.push({
      id: 'filter',
      role: 'filter',
      representation: filter.ref,
      result: context.result.ref,
      config: { schema: filter.manifest.configSchema, values: {} },
      children: [],
    });
  if (extra) nodes.push(structural('header', header.ref), structural('sidebar', sidebar.ref));
  return {
    id: 'layout-' + layout,
    revision: context.task.revision,
    rootId: 'workspace',
    preconditions: context.current,
    nodes,
    links: [],
    coverage: [{ needId: 'people', nodeIds: ['people'], operations: [read] }],
    stateTransfer:
      context.incumbent?.nodes.map((node) => ({
        fromNode: node.id,
        toNode: node.id,
        mapping: { id: 'varendo.state.identity', revision: '1' },
      })) ?? [],
    diagnostics: [],
  };
}
const pattern: PresentationPatternManifest = {
  ref: { id: 'fixture.people-layout', revision: '1' },
  expand(request) {
    return {
      ok: true,
      value: layoutPlan({
        task: request.context.task,
        current: request.preconditions,
        result: request.context.results[0]!,
      }),
    };
  },
  matches(plan, context) {
    return (
      plan.rootId === 'workspace' &&
      plan.nodes.some((node) => node.id === 'people') &&
      (context.task.id === 'workspace' ? plan.nodes.length === 3 : plan.nodes.length >= 4)
    );
  },
};
const app = createVarendoApp({
  resources: [{ resource: people, data }],
  intents: registry.value,
  views: [filter, header, sidebar],
  patterns: [pattern],
  recipes: [
    defineRecipe({
      ref: { id: 'fixture.layout-recipe', revision: '1' },
      intents: [goal],
      build(context) {
        return { ok: true, value: layoutPlan(context) };
      },
    }),
  ],
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'user',
        scopeDigest: 'scope',
        policyRevision: '1',
        experienceRevision: '1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
        readContext: { principal: 'user' },
      },
    }),
  },
});
const mounted = app.mount({
  target: document.querySelector<HTMLElement>('#target')!,
  regionId: 'main',
  resourceId: 'people',
});
if (!mounted.ok) throw Error('mount');
region = mounted.value;
async function render(layout: string) {
  const receipt = await app.render({
    regionId: 'main',
    intent: {
      version: '1',
      id: 'intent-' + layout,
      kind: 'custom',
      resource: 'people',
      intent: goal,
      input: { layout },
    },
  });
  document.querySelector('#status')!.textContent = receipt.status;
  return receipt;
}
const initial = await render('workspace');
if (initial.status !== 'renderer-ready') throw Error(JSON.stringify(initial.diagnostics));
await region.updateComplete;
const initialTable = region.shadowRoot!.querySelector('varendo-table');
const initialFilter = region.shadowRoot!.querySelector('input');
Object.assign(window, {
  continuityFixture: {
    render,
    refreshSource() {
      return data.replaceSnapshot({
        catalog: people.catalog,
        sourceRevision: '2',
        records: {
          people: [
            { id: 'ada', name: 'Ada refreshed' },
            { id: 'lin', name: 'Lin' },
          ],
        },
      });
    },
    snapshot() {
      const selection = region?.interaction?.values.find((value) => value.payload.kind === 'selection')?.payload;
      return {
        taskId: app.snapshot('main')?.task?.id,
        resultId: region?.results[0]?.ref.id,
        selectedResultId:
          selection?.kind === 'selection' && selection.selection.mode === 'ids'
            ? selection.selection.result.id
            : undefined,
        selectedKeys:
          selection?.kind === 'selection' && selection.selection.mode === 'ids' ? selection.selection.keys : [],
        sameTable: initialTable === region?.shadowRoot?.querySelector('varendo-table'),
        sameFilter: initialFilter === region?.shadowRoot?.querySelector('input'),
        filter: filterText(),
      };
    },
  },
});
