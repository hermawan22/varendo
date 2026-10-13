import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { defineResource, type Intent, type ResourceDefinition } from '@varendo/core';
import { createLocalDataService, type DataRecord, type LocalDataService } from '@varendo/runtime/data';
import { createVarendoApp, type VarendoApp, type VarendoAppOptions, type WebRenderReceipt } from '@varendo/web/app';
import { z } from 'zod';
import { HEADCOUNT_RECORDS, HEADCOUNT_RESOURCE } from './playground/workforce-scenario.js';

const PEOPLE = Object.freeze([
  { id: 'p-1', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
  { id: 'p-2', name: 'Sam Rivera', team: 'Engineering', location: 'Lisbon' },
  { id: 'p-3', name: 'Iman Putra', team: 'Engineering', location: 'Bandung' },
  { id: 'p-4', name: 'Lee Morgan', team: 'Operations', location: 'London' },
]);

const people = defineResource({
  id: 'people',
  revision: 'home-people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string(), location: z.string() }),
  fields: { name: { label: 'Name' }, team: { label: 'Team', role: 'dimension' }, location: { label: 'Location' } },
  presentation: { allowedViews: ['table', 'cards'] },
});

const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0].message);
const functionRegistry = functions.value;

const readHomeAuthority: VarendoAppOptions['authority']['read'] = () => ({
  ok: true,
  value: {
    principalKey: 'home-public',
    scopeDigest: 'home-synthetic',
    policyRevision: 'home-policy-1',
    experienceRevision: 'home-web-1',
    grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
    readContext: { principal: 'home-public' },
  },
});

function homeDataService(
  resource: ResourceDefinition,
  records: Readonly<Record<string, readonly DataRecord[]>>,
): LocalDataService {
  return createLocalDataService({
    snapshot: { catalog: resource.catalog, sourceRevision: 'home-data-1', records },
    functionRegistry,
    sourceLimits: { rows: 100, bytes: 250_000 },
    authorize: ({ context }) =>
      context.principal === 'home-public'
        ? { ok: true, value: { scopeDigest: 'home-synthetic', policyRevision: 'home-policy-1' } }
        : {
            ok: false,
            diagnostics: [
              { code: 'home.denied', message: 'The public demo principal is unavailable.', retryable: false },
            ],
          },
  });
}

function createHomeApp(resources: VarendoAppOptions['resources']): VarendoApp {
  return createVarendoApp({ resources, authority: { read: readHomeAuthority } });
}

function siteTheme(): 'light' | 'dark' {
  const applied = document.documentElement.dataset.theme;
  if (applied === 'light' || applied === 'dark') return applied;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function mountRegion(app: VarendoApp, target: HTMLElement, regionId: string, resourceId: string): void {
  const mounted = app.mount({ target, regionId, resourceId });
  if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
  mounted.value.setAttribute('data-varendo-theme', siteTheme());
}

export type HomeDemoView = 'table' | 'cards' | 'chart';

export interface HomeDemoExample {
  render(team: string, view: HomeDemoView): Promise<WebRenderReceipt>;
  dispose(): void;
}

/**
 * One live runtime driving the landing demo: the same browse intent becomes a
 * table in a wide container and cards in a compact one, while a chart option
 * answers an analyze intent on the headcount resource in a second region.
 */
export function mountHomeDemo(targets: { readonly people: HTMLElement; readonly trend: HTMLElement }): HomeDemoExample {
  const app = createHomeApp([
    { resource: people, data: homeDataService(people, { people: PEOPLE }) },
    {
      resource: HEADCOUNT_RESOURCE,
      data: homeDataService(HEADCOUNT_RESOURCE, { 'workforce-headcount': HEADCOUNT_RECORDS }),
    },
  ]);
  mountRegion(app, targets.people, 'home-demo', 'people');
  mountRegion(app, targets.trend, 'home-trend', 'workforce-headcount');
  let request = 0;

  return Object.freeze({
    render(team: string, view: HomeDemoView) {
      if (view === 'chart') {
        const analyze: Intent = {
          version: '1',
          id: `home-analyze-${++request}`,
          kind: 'analyze',
          resource: 'workforce-headcount',
          measures: [{ id: 'month-end-headcount', revision: '1' }],
          time: { field: 'month', grain: 'month', calendar: 'gregorian', timezone: 'UTC' },
          preferredView: 'trend',
          sort: [{ field: 'month', direction: 'asc' }],
        };
        return app.render({ regionId: 'home-trend', intent: analyze });
      }
      const browse: Intent = {
        version: '1',
        id: `home-browse-${++request}`,
        kind: 'browse',
        resource: 'people',
        fields: ['name', 'team', 'location'],
        ...(team === 'all' ? {} : { filter: { op: 'compare', field: 'team', comparison: 'eq', value: team } }),
      };
      return app.render({ regionId: 'home-demo', intent: browse });
    },
    dispose() {
      app.dispose();
    },
  });
}
