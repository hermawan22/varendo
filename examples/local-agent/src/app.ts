import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { defineResource } from '@varendo/core';
import { createLocalDataService, type AuthorizeRead, type DataRecord } from '@varendo/runtime/data';
import { createVarendoApp } from '@varendo/web/app';
import { z } from 'zod';

export const people = defineResource({
  id: 'people',
  revision: 'people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
  fields: { name: { label: 'Name' }, team: { label: 'Team', role: 'dimension' } },
  presentation: { allowedViews: ['table', 'cards'] },
});

export const workforceHeadcount = defineResource({
  id: 'workforce-headcount',
  revision: 'headcount-1',
  label: 'Monthly workforce headcount',
  identity: ['id'],
  rowGrain: ['month'],
  schema: z.object({ id: z.string(), month: z.iso.date(), headcount: z.number().int() }),
  fields: {
    id: { label: 'Snapshot ID', hidden: true },
    month: { label: 'Month', role: 'time' },
    headcount: { label: 'Month end headcount', role: 'measure' },
  },
  meanings: [
    {
      id: 'month-end-headcount',
      revision: '1',
      label: 'Month end headcount',
      explanation: 'Employees active at the end of each month. Compare across months; never sum across time.',
      output: { value: 'integer', nullable: false, grain: ['month'] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'headcount' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: 'core-query-2',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'semi-additive',
      aggregationDimensions: ['month'],
      missingPolicy: 'reject',
    },
  ],
  presentation: { allowedViews: ['table', 'trend'], preferred: { analyze: 'trend' } },
});

export const HEADCOUNT = Object.freeze([
  { id: '2026-03', month: '2026-03-01', headcount: 118 },
  { id: '2026-04', month: '2026-04-01', headcount: 121 },
  { id: '2026-05', month: '2026-05-01', headcount: 124 },
  { id: '2026-06', month: '2026-06-01', headcount: 127 },
  { id: '2026-07', month: '2026-07-01', headcount: 126 },
  { id: '2026-08', month: '2026-08-01', headcount: 130 },
]);

function currentAuthority() {
  return {
    ok: true as const,
    value: {
      principalKey: 'current-user',
      scopeDigest: 'permitted-people',
      policyRevision: 'policy-1',
      experienceRevision: 'web-1',
      grants: [
        'catalog.read',
        'task.propose',
        'task.evaluate',
        'result.inspect',
        'experience.commit',
        'model.egress',
        'action.propose',
      ],
      readContext: { principal: 'current-user' },
    },
  };
}

export function createTutorialApp(records: readonly DataRecord[]) {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const authorize: AuthorizeRead = ({ context }) =>
    context.principal === 'current-user'
      ? { ok: true as const, value: { scopeDigest: 'permitted-people', policyRevision: 'policy-1' } }
      : {
          ok: false as const,
          diagnostics: [{ code: 'people.denied', message: 'People access is denied.', retryable: false }],
        };
  const peopleData = createLocalDataService({
    snapshot: { catalog: people.catalog, sourceRevision: 'people-data-1', records: { people: [...records] } },
    functionRegistry: functions.value,
    sourceLimits: { rows: 1_000, bytes: 1_000_000 },
    authorize,
  });
  const headcountData = createLocalDataService({
    snapshot: {
      catalog: workforceHeadcount.catalog,
      sourceRevision: 'headcount-data-1',
      records: { 'workforce-headcount': HEADCOUNT },
    },
    functionRegistry: functions.value,
    sourceLimits: { rows: 1_000, bytes: 1_000_000 },
    authorize,
  });
  return createVarendoApp({
    resources: [
      { resource: people, data: peopleData },
      { resource: workforceHeadcount, data: headcountData },
    ],
    authority: { read: currentAuthority },
  });
}

export function mountPeople(target: HTMLElement, records: readonly DataRecord[]) {
  const app = createTutorialApp(records);
  const mounted = app.mount({ target, regionId: 'people-main', resourceId: 'people' });
  if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);

  return {
    app,
    render: () =>
      app.render({
        regionId: 'people-main',
        intent: {
          version: '1',
          id: 'browse-people',
          kind: 'browse',
          resource: 'people',
          fields: ['name', 'team'],
        },
      }),
    dispose: () => app.dispose(),
  };
}
