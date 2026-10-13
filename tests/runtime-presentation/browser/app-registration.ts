import { defineResource, type Intent } from '@varendo/core';
import { createLocalDataService } from '@varendo/runtime/data';
import { z } from 'zod';
import { html } from 'lit';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';
import { defineView } from '../../../packages/web/src/recipes/index.js';

const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string(), joined: z.iso.date() }),
  fields: { team: { role: 'dimension' }, joined: { role: 'time' } },
  measures: { hires: { label: 'New hires', aggregate: 'count' } },
  presentation: { allowedViews: ['table', 'cards', 'trend', 'bar', 'example.comparison'] },
});
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
  authorize: () => ({ ok: true, value: { scopeDigest: 'scope', policyRevision: '1' } }),
});
const view = defineView({
  ref: { id: 'example.comparison', revision: '1' },
  manifest: {
    ref: { id: 'example.comparison', revision: '1' },
    configSchema: { id: 'example.comparison-config', revision: '1' },
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
        fields: ['id', 'name', 'team', 'joined'],
        ports: [],
        operations: [{ id: 'data.read', revision: '1' }],
      },
    }),
  },
  render: ({ result }) =>
    html`<varendo-comparison
      .compareKeys=${['ada', 'sam']}
      .metrics=${[{ id: 'names', label: 'Names', values: Object.fromEntries(result?.rows.map((row) => [String(row.id), row.name]) ?? []) }]}
    ></varendo-comparison>`,
});
let authorized = true;
const app = createVarendoApp({
  resources: [{ resource: people, data }],
  views: [view],
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
              grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
              readContext: {},
            },
          }
        : { ok: false, diagnostics: [{ code: 'runtime.authority-denied', message: 'Revoked', retryable: false }] },
  },
});
const target = document.querySelector<HTMLElement>('#target')!;
const mounted = app.mount({ target, regionId: 'main', resourceId: 'people' });
if (!mounted.ok) throw new Error(JSON.stringify(mounted.diagnostics));
document.querySelector('#status')!.textContent = 'mounted';
function intent(kind: string): Intent {
  const base = { version: '1' as const, id: kind, resource: 'people' };
  if (kind === 'trend')
    return {
      ...base,
      kind: 'analyze',
      measures: [{ id: 'hires', revision: '1' }],
      time: { field: 'joined', grain: 'month' },
    };
  if (kind === 'bar')
    return { ...base, kind: 'analyze', measures: [{ id: 'hires', revision: '1' }], dimensions: ['team'] };
  if (kind === 'auto') return { ...base, kind: 'browse' };
  return { ...base, kind: 'browse', preferredView: kind === 'custom' ? view.ref.id : kind };
}
const render = (kind: string) => app.render({ regionId: 'main', intent: intent(kind) });
let pending: ReturnType<typeof render> | undefined;
Object.assign(window, {
  registrationFixture: {
    render,
    start: (kind: string) => {
      pending = render(kind);
    },
    finish: () => pending,
    revoke: () => {
      authorized = false;
    },
    dispose: () => app.dispose(),
    resize: (width: number) => {
      target.style.width = `${width}px`;
    },
    snapshot: () => ({ runtime: app.snapshot('main'), plan: mounted.value.presentation?.plan }),
  },
});
