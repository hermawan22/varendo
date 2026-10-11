import { defineResource, type Intent } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { z } from 'zod';
import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { createAeliqoApp } from '../../../packages/web/src/app/app.js';
import { defineView, standardDataRecipe } from '../../../packages/web/src/recipes/index.js';

const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string() }),
  presentation: { allowedViews: ['example.people-grid', 'table'] },
});
const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error('functions');
const data = createLocalDataService({
  snapshot: { catalog: people.catalog, sourceRevision: '1', records: { people: [{ id: 'ada', name: 'Ada' }] } },
  functionRegistry: functions.value,
  authorize: () => ({ ok: true, value: { scopeDigest: 'scope', policyRevision: '1' } }),
});
let mode = new URLSearchParams(location.search).get('mode') ?? 'safe';
let authorized = true;
let renders = 0;
const view = defineView({
  ref: { id: 'example.people-grid', revision: '1' },
  manifest: {
    ref: { id: 'example.people-grid', revision: '1' },
    configSchema: { id: 'example.grid-config', revision: '1' },
    roles: ['grid'],
    operations: [{ id: 'data.read', revision: '1' }],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: true,
    resolveConfig: (values) => ({
      ok: true,
      value: {
        values,
        fields: ['id', 'name'],
        ports: [{ id: 'selection', direction: 'inout', payload: 'selection', entity: 'people', identity: ['id'] }],
        operations: [{ id: 'data.read', revision: '1' }],
      },
    }),
  },
  render({ result }) {
    renders++;
    if (mode === 'throw' || mode === 'emit-rollback') throw new Error('synthetic host renderer failure');
    if (mode === 'revoke') authorized = false;
    if (mode === 'emit') {
      mode = 'safe';
      emitSelection();
    }
    const capturedMode = mode;
    const content = html`<section data-owner="stable">
      <label>Draft <input aria-label="Host draft" /></label>
      <p>${result?.rows[0]?.name}</p>
    </section>`;
    return html`${repeat(
      [1],
      (id) => id,
      () => {
        if (mode === 'emit-rollback') {
          mode = 'safe';
          emitSelection();
        }
        if (capturedMode === 'captured-directive-throw' || mode === 'directive-throw')
          throw new Error('synthetic nested directive failure');
        return content;
      },
    )}`;
  },
});
const app = createAeliqoApp({
  resources: [{ resource: people, data }],
  views: [view],
  recipes: [
    {
      ...standardDataRecipe,
      build(context) {
        if (new URLSearchParams(location.search).get('wrap') === 'false') return standardDataRecipe.build(context);
        if (mode === 'unsupported')
          return {
            ok: false,
            diagnostics: [{ code: 'web.recipe.unsupported', message: 'No registered target', retryable: false }],
          };
        const { incumbent: _incumbent, ...fresh } = context;
        const built = standardDataRecipe.build(fresh);
        if (!built.ok) return built;
        return {
          ok: true,
          value: {
            ...built.value,
            rootId: 'wrapper',
            nodes: [
              {
                id: 'wrapper',
                role: 'structure',
                representation: { id: 'layout.stack', revision: '1' },
                config: { schema: { id: 'layout.stack.config', revision: '1' }, values: {} },
                children: [built.value.rootId],
              },
              ...built.value.nodes,
            ],
          },
        };
      },
    },
  ],
  authority: {
    read: () =>
      authorized
        ? {
            ok: true,
            value: {
              principalKey: 'user',
              scopeDigest: 'scope',
              policyRevision: '1',
              experienceRevision: '1',
              grants: ['task.evaluate', 'result.inspect'],
              readContext: { principal: 'user' },
            },
          }
        : {
            ok: false,
            diagnostics: [{ code: 'runtime.authority-denied', message: 'Access revoked', retryable: false }],
          },
  },
});
const target = document.querySelector<HTMLElement>('#target')!;
const mounted = app.mount({ target, regionId: 'main', resourceId: 'people' });
if (!mounted.ok) throw new Error('mount');
const initial: Intent = { version: '1', id: 'first', kind: 'browse', resource: 'people', preferredView: view.ref.id };
const receipt = await app.render({ regionId: 'main', intent: initial });
document.querySelector('#status')!.textContent = receipt.status;
if (receipt.status !== 'renderer-ready') throw new Error(JSON.stringify(receipt.diagnostics));
const initialInteractions = { live: mounted.value.interaction, canonical: receipt.runtime.region.state?.interaction };
const input = mounted.value.shadowRoot!.querySelector('input')!;
function emitSelection() {
  if (!mounted.ok) return;
  const nodeId = mounted.value.presentation!.nodes.find((node) => node.manifest.id === view.ref.id)!.node.id;
  mounted.value.onSemanticInteraction?.({
    nodeId,
    portId: 'selection',
    payload: { kind: 'selection', selection: { mode: 'clear' } },
  });
}
Object.assign(window, {
  transactionFixture: {
    snapshot: () => ({
      runtime: app.snapshot('main'),
      initialInteractions,
      plan: mounted.value.presentation?.plan,
      liveInteraction: mounted.value.interaction,
      canonicalInteraction: app.snapshot('main')?.region?.state?.interaction,
      renders,
      sameInput: input === mounted.value.shadowRoot!.querySelector('input'),
    }),
    async render(nextMode: string) {
      mode = nextMode;
      return app.render({ regionId: 'main', intent: { ...initial, id: 'next-' + nextMode } });
    },
    directThrow(kind = 'throw') {
      const element = mounted.value;
      const previous = element.presentation;
      const publication = element.preparePublication();
      mode = kind;
      element.presentation = previous === undefined ? undefined : { ...previous };
      try {
        publication.apply();
      } catch {
        /* Exercise rollback after the failed root update. */
      }
      element.presentation = previous;
      try {
        publication.rollback();
        return { rolledBack: true };
      } catch (error) {
        return { rolledBack: false, error: String(error) };
      } finally {
        publication.complete();
      }
    },
    emitSelection,
    dispose: () => app.dispose(),
  },
});
