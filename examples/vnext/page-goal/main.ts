import type { Intent } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { createAeliqoApp } from '@varendo/web/app';
import {
  LAYOUT_INTENTS,
  LAYOUT_STATE_MAPPINGS,
  LAYOUT_PATTERNS,
  LAYOUT_VIEWS,
  WORKSPACE_RESOURCE,
  WORKSPACE_RECORDS,
  layoutIntent,
} from '../workspace/page.js';

const functions = createQueryFunctionRegistry({ version: '2' });
const intents = createIntentCompilerRegistry(LAYOUT_INTENTS);
if (!functions.ok || !intents.ok) throw new Error('Registration failed.');
const resource = WORKSPACE_RESOURCE;
const data = createLocalDataService({
  snapshot: {
    catalog: resource.catalog,
    sourceRevision: 'attendance-1',
    records: { attendance: WORKSPACE_RECORDS },
  },
  functionRegistry: functions.value,
  authorize: ({ context }) =>
    context.principal === 'attendance-user'
      ? { ok: true, value: { scopeDigest: 'attendance-scope', policyRevision: '1' } }
      : { ok: false, diagnostics: [{ code: 'attendance.denied', message: 'Read denied.', retryable: false }] },
});
const status = document.querySelector<HTMLElement>('#status');
const target = document.querySelector<HTMLElement>('#workspace');
if (!status || !target) throw new Error('Missing host elements.');
const app = createAeliqoApp({
  resources: [{ resource, data }],
  intents: intents.value,
  patterns: LAYOUT_PATTERNS,
  stateMappings: LAYOUT_STATE_MAPPINGS,
  views: LAYOUT_VIEWS,
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'attendance-user',
        scopeDigest: 'attendance-scope',
        policyRevision: '1',
        experienceRevision: '1',
        grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
        readContext: { principal: 'attendance-user' },
      },
    }),
  },
  onPresentation(receipt) {
    status!.textContent = `${receipt.status}: ${receipt.presentation.plan.rootId}`;
  },
});
const mounted = app.mount({ target, regionId: 'attendance-workspace', resourceId: resource.id });
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
const browse: Intent = {
  version: '1',
  id: 'attendance-rows',
  kind: 'browse',
  resource: resource.id,
  fields: ['employee', 'day', 'present'],
  filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
};
async function show(intent: Intent): Promise<void> {
  const receipt = await app.render({ regionId: 'attendance-workspace', intent });
  if (receipt.status !== 'renderer-ready')
    status!.textContent = `${receipt.status}: ${receipt.diagnostics[0]?.message ?? 'Try another request.'}`;
}
document.querySelector('#component')!.addEventListener('click', () => void show(browse));
document.querySelector('#overview')!.addEventListener('click', () => void show(layoutIntent('workspace')));
document.querySelector('#page')!.addEventListener('click', () => void show(layoutIntent('page')));
window.addEventListener('pagehide', () => app.dispose(), { once: true });
await show(browse);
