import { defineResource } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { z } from 'zod';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';
import { standardDataRecipe } from '../../../packages/web/src/recipes/standard.js';

const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string() }),
  presentation: { allowedViews: ['table'] },
});
const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0].message);
const data = createLocalDataService({
  snapshot: {
    catalog: people.catalog,
    sourceRevision: '1',
    records: { people: [{ id: 'ada', name: 'Ada' }] },
  },
  functionRegistry: functions.value,
  sourceLimits: { rows: 10, bytes: 10_000 },
  authorize: () => ({ ok: true, value: { scopeDigest: 'people-scope', policyRevision: '1' } }),
});
let queries = 0;
let recipeCalls = 0;
const renderedWidths: number[] = [];
const execute = data.execute;
data.execute = (...args) => {
  queries++;
  return execute(...args);
};
const app = createVarendoApp({
  resources: [{ resource: people, data }],
  onPresentation(receipt) {
    const width = receipt.environment.inlineSize;
    if (width.state === 'known') renderedWidths.push(width.value);
  },
  recipes: [
    {
      ...standardDataRecipe,
      build(context) {
        recipeCalls++;
        return standardDataRecipe.build(context);
      },
    },
  ],
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'resize-user',
        scopeDigest: 'people-scope',
        policyRevision: '1',
        experienceRevision: '1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
        readContext: { principal: 'resize-user' },
      },
    }),
  },
});
const target = document.querySelector<HTMLElement>('#target')!;
const mounted = app.mount({ target, regionId: 'resize', resourceId: 'people' });
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
const initial = await app.render({
  regionId: 'resize',
  intent: { version: '1', id: 'browse', kind: 'browse', resource: 'people', fields: ['name'] },
});
if (initial.status !== 'renderer-ready') throw new Error(JSON.stringify(initial.diagnostics));
const editor = document.createElement('input');
editor.id = 'editor';
editor.setAttribute('aria-label', 'Host draft');
mounted.value.shadowRoot!.append(editor);
Object.assign(window, {
  resizeFixture: {
    snapshot: () => ({
      environment: mounted.value.presentation?.environment,
      queries,
      recipeCalls,
      renderedWidths,
    }),
    dispose: () => app.dispose(),
  },
});
