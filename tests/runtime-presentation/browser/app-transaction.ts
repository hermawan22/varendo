import { defineResource, type Intent } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { z } from 'zod';
import { html } from 'lit';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';
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
let mode = 'safe';
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
      value: { values, fields: ['id', 'name'], ports: [], operations: [{ id: 'data.read', revision: '1' }] },
    }),
  },
  render({ result }) {
    renders++;
    if (mode === 'throw') throw new Error('synthetic host renderer failure');
    if (mode === 'revoke') authorized = false;
    return html`<section data-owner="stable">
      <label>Draft <input aria-label="Host draft" /></label>
      <p>${result?.rows[0]?.name}</p>
    </section>`;
  },
});
const app = createVarendoApp({
  resources: [{ resource: people, data }],
  views: [view],
  recipes: [
    {
      ...standardDataRecipe,
      build(context) {
        if (mode === 'unsupported')
          return {
            ok: false,
            diagnostics: [{ code: 'web.recipe.unsupported', message: 'No registered target', retryable: false }],
          };
        return standardDataRecipe.build(context);
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
const ready = app.render({ regionId: 'main', intent: initial }).then((receipt) => {
  if (receipt.status !== 'renderer-ready') throw new Error(JSON.stringify(receipt.diagnostics));
  return receipt;
});
Object.assign(window, { transactionReady: ready });
const receipt = await ready;
document.querySelector('#status')!.textContent = receipt.status;
const input = mounted.value.shadowRoot!.querySelector('input')!;
Object.assign(window, {
  transactionFixture: {
    snapshot: () => ({
      runtime: app.snapshot('main'),
      plan: mounted.value.presentation?.plan,
      renders,
      sameInput: input === mounted.value.shadowRoot!.querySelector('input'),
    }),
    async render(nextMode: string) {
      mode = nextMode;
      return app.render({ regionId: 'main', intent: { ...initial, id: 'next-' + nextMode } });
    },
    dispose: () => app.dispose(),
  },
});
