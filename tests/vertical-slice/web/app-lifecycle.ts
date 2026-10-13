import { defineResource } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { createVarendoApp } from '@varendo/web/app';
import { z } from 'zod';

const people = defineResource({
  id: 'people',
  revision: 'lifecycle-people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
  fields: { name: { label: 'Name' }, team: { label: 'Team', role: 'dimension' } },
  presentation: { allowedViews: ['table', 'cards'] },
});

const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0].message);

const data = createLocalDataService({
  snapshot: {
    catalog: people.catalog,
    sourceRevision: 'lifecycle-data-1',
    records: { people: [{ id: 'p-1', name: 'Ada', team: 'Design' }] },
  },
  functionRegistry: functions.value,
  sourceLimits: { rows: 10, bytes: 10_000 },
  authorize: () => ({ ok: true, value: { scopeDigest: 'lifecycle-scope', policyRevision: 'lifecycle-policy-1' } }),
});

const app = createVarendoApp({
  resources: [{ resource: people, data }],
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'lifecycle-test',
        scopeDigest: 'lifecycle-scope',
        policyRevision: 'lifecycle-policy-1',
        experienceRevision: 'lifecycle-web-1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
        readContext: { principal: 'lifecycle-test' },
      },
    }),
  },
});

const target = document.querySelector<HTMLDivElement>('#target');
if (target === null) throw new Error('lifecycle target missing');
const mounted = app.mount({ target, regionId: 'resize-release', resourceId: 'people' });
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
const region = mounted.value;
const initial = await app.render({
  regionId: 'resize-release',
  intent: { version: '1', id: 'lifecycle-browse', kind: 'browse', resource: 'people', fields: ['name', 'team'] },
});
if (initial.status !== 'renderer-ready') throw new Error('initial app render failed');

let armed = false;
let unmountResult = false;
let resolveUnmount!: () => void;
const unmounted = new Promise<void>((resolve) => {
  resolveUnmount = resolve;
});
const unsubscribe = app.subscribe('resize-release', () => {
  if (!armed) return;
  armed = false;
  unmountResult = app.unmount('resize-release');
  resolveUnmount();
});

Object.assign(window, {
  async startResizeUnmount() {
    armed = true;
    target.style.width = '350px';
    await unmounted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await region.updateComplete;
    unsubscribe();
    return {
      unmountResult,
      detached: !region.isConnected,
      presentationCleared: region.presentation === undefined,
      resultsCleared: region.results.length === 0,
    };
  },
});
