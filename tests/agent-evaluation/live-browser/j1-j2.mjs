import { defineResource } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { createAeliqoApp } from '@varendo/web/app';
import { createAppToolEndpoint } from '@varendo/agent/app';
import { PLAYGROUND_RESOURCES, PLAYGROUND_RECORDS } from '../../../apps/site/src/playground/scenarios.ts';
import { attendanceDayFilter } from '../../../examples/vnext/attendance/period.ts';
import { z } from 'zod';

const period = {
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-10-01T00:00:00+07:00',
  timezone: 'Asia/Jakarta',
  calendar: 'gregorian',
  interpretation: 'September 2026 through the last complete local day as of 6 September',
};

function attendanceResource(digest) {
  const generated = defineResource({
    id: 'attendance',
    revision: 'attendance-live-1',
    label: 'Synthetic daily attendance',
    identity: ['id'],
    rowGrain: ['id'],
    schema: z.object({
      id: z.string(),
      employee: z.string(),
      day: z.iso.date(),
      present: z.number().int(),
      eligible: z.number().int(),
    }),
    fields: {
      id: { label: 'Observation', hidden: true },
      employee: { label: 'Employee', role: 'dimension' },
      day: { label: 'Local day', role: 'time' },
      present: { label: 'Present employee-days', role: 'measure' },
      eligible: { label: 'Eligible employee-days', role: 'measure' },
    },
    meanings: [
      {
        id: 'attendance.rate',
        revision: '1',
        label: 'Tingkat kehadiran',
        explanation: 'Present eligible employee-days divided by eligible employee-days; approved leave excluded.',
        output: { value: 'float', nullable: true },
        implementation: {
          kind: 'expression',
          expression: {
            kind: 'call',
            function: { id: 'core.ratio-of-sums.null', revision: '1' },
            arguments: [
              { kind: 'field', ref: 'present' },
              { kind: 'field', ref: 'eligible' },
            ],
          },
        },
        dependencies: [],
        functionRegistryDigest: digest,
        origin: 'manual',
        lifecycle: 'active',
        scope: 'workspace',
        authority: 'approved',
        aggregation: 'ratio-of-sums',
        aggregationDimensions: [],
        missingPolicy: 'reject',
      },
    ],
    presentation: { allowedViews: ['table', 'trend'], preferred: { analyze: 'trend' } },
  });
  return defineResource({
    id: generated.id,
    label: generated.label,
    schema: generated.schema,
    fields: generated.fieldMetadata,
    presentation: generated.presentation,
    catalog: {
      ...generated.catalog,
      entities: generated.catalog.entities.map((entity) => ({
        ...entity,
        fields: entity.fields.map((field) =>
          field.id === 'day'
            ? {
                ...field,
                type: { ...field.type, temporal: { calendar: 'gregorian', timezone: 'Asia/Jakarta', grain: 'day' } },
              }
            : field,
        ),
      })),
    },
  });
}

/** Browser evaluation host for the server-owned model; the public Playground exposes WebMCP only. */
export async function openJ1(target) {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error('J1 query registry unavailable.');
  const resource = PLAYGROUND_RESOURCES.people;
  const data = createLocalDataService({
    snapshot: {
      catalog: resource.catalog,
      sourceRevision: 'live-people-1',
      records: { people: PLAYGROUND_RECORDS.people },
    },
    functionRegistry: functions.value,
    authorize: () => ({ ok: true, value: { scopeDigest: 'synthetic-local', policyRevision: '1' } }),
  });
  const app = createAeliqoApp({
    resources: [{ resource, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'synthetic-people',
          scopeDigest: 'synthetic-local',
          policyRevision: '1',
          experienceRevision: '1',
          grants: [
            'catalog.read',
            'task.propose',
            'task.evaluate',
            'result.inspect',
            'experience.commit',
            'model.egress',
          ],
          readContext: { principal: 'synthetic-people' },
        },
      }),
    },
  });
  const regionId = 'playground-main';
  const mounted = app.mount({ target, regionId, resourceId: resource.id });
  if (!mounted.ok) throw new Error(mounted.diagnostics[0]?.message ?? 'J1 mount failed.');
  const render = ({ intent, signal }) => app.render({ regionId, intent, signal });
  const initial = await render({
    intent: {
      version: '1',
      id: 'j1-initial',
      kind: 'browse',
      resource: 'people',
      fields: ['name', 'team', 'location'],
    },
  });
  if (initial.status !== 'renderer-ready') throw new Error('The J1 host could not render its initial view.');
  const connected = createAppToolEndpoint({
    runtime: app.runtime,
    regionId,
    goalEpoch: 'live-j1',
    transport: 'byok',
    expiresAt: Date.now() + 300_000,
    render: { render },
  });
  if (!connected.ok) throw new Error(connected.diagnostics[0]?.message ?? 'J1 pairing failed.');
  return {
    endpoint: connected.value,
    close() {
      connected.value.close();
      app.dispose();
    },
  };
}

export async function openJ2(target) {
  target.ownerDocument.documentElement.lang = 'id-ID';
  const fixedFilter = attendanceDayFilter(period, '2026-09-06');
  const supportedPeriod = {
    from: period.from,
    toExclusive: '2026-09-06T00:00:00+07:00',
    timezone: period.timezone,
    calendar: period.calendar,
    interpretation: 'September 1–5, 2026 are complete local days in Asia/Jakarta.',
  };
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0]?.message ?? 'No query registry.');
  const resource = attendanceResource(functions.value.digest);
  const records = [
    { id: 'a1', employee: 'Ada', day: '2026-09-01', present: 1, eligible: 1 },
    { id: 'b1', employee: 'Ben', day: '2026-09-01', present: 1, eligible: 1 },
    { id: 'a2', employee: 'Ada', day: '2026-09-02', present: 1, eligible: 1 },
    { id: 'b2', employee: 'Ben', day: '2026-09-02', present: 0, eligible: 1 },
    { id: 'a3', employee: 'Ada', day: '2026-09-03', present: 1, eligible: 1 },
    { id: 'b3', employee: 'Ben', day: '2026-09-03', present: 0, eligible: 0 },
    { id: 'future', employee: 'Ada', day: '2026-09-06', present: 1, eligible: 1 },
  ];
  const service = createLocalDataService({
    snapshot: { catalog: resource.catalog, sourceRevision: 'attendance-live-1', records: { attendance: records } },
    functionRegistry: functions.value,
    sourceLimits: { rows: 100, bytes: 100_000 },
    authorize: () => ({ ok: true, value: { scopeDigest: 'attendance-live-scope', policyRevision: '1' } }),
  });
  const app = createAeliqoApp({
    resources: [{ resource, data: service }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'synthetic-attendance',
          scopeDigest: 'attendance-live-scope',
          policyRevision: '1',
          experienceRevision: '1',
          grants: [
            'catalog.read',
            'task.propose',
            'task.evaluate',
            'result.inspect',
            'experience.commit',
            'model.egress',
          ],
          readContext: { principal: 'synthetic-attendance' },
        },
      }),
    },
  });
  const mounted = app.mount({ target, regionId: 'live-attendance', resourceId: 'attendance' });
  if (!mounted.ok) throw new Error(mounted.diagnostics[0]?.message ?? 'J2 mount failed.');
  const periodLabel = target.ownerDocument.createElement('p');
  periodLabel.textContent = 'Periode 1–5 September 2026 (Asia/Jakarta); tanggal tanpa data tidak dihitung nol.';
  periodLabel.dataset.testid = 'approved-period';
  target.prepend(periodLabel);
  const render = async ({ intent, signal }) => {
    // The host owns the visible as-of period. Omission uses that period; an explicit mismatch is rejected.
    if (
      intent.kind !== 'analyze' ||
      intent.resource !== 'attendance' ||
      intent.measures.length !== 1 ||
      intent.measures[0].id !== 'attendance.rate' ||
      intent.time?.field !== 'day' ||
      intent.time.grain !== 'day' ||
      (intent.time.calendar !== undefined && intent.time.calendar !== 'gregorian') ||
      (intent.time.timezone !== undefined && intent.time.timezone !== 'Asia/Jakarta') ||
      (intent.period !== undefined &&
        Object.entries(supportedPeriod).some(
          ([key, value]) => key !== 'interpretation' && intent.period[key] !== value,
        )) ||
      (intent.filter !== undefined && JSON.stringify(intent.filter) !== JSON.stringify(fixedFilter))
    )
      return {
        status: 'failed',
        requestId: 'live-j2-invalid',
        regionId: 'live-attendance',
        diagnostics: [
          { code: 'live.j2-invalid', message: 'Only the registered daily rate is supported.', retryable: false },
        ],
      };
    const { period: _period, ...withoutPeriod } = intent;
    const bounded = {
      ...withoutPeriod,
      time: { ...intent.time, calendar: 'gregorian', timezone: 'Asia/Jakarta' },
      filter: fixedFilter,
    };
    return app.render({ regionId: 'live-attendance', intent: bounded, signal });
  };
  const connected = createAppToolEndpoint({
    runtime: app.runtime,
    regionId: 'live-attendance',
    goalEpoch: 'live-j2',
    transport: 'byok',
    expiresAt: Date.now() + 300_000,
    render: { render },
    context: {
      read() {
        const contexts = app.runtime.contexts('live-attendance');
        if (!contexts.ok) return contexts;
        return {
          ok: true,
          value: contexts.value.map((context) =>
            context.resource.id === 'attendance'
              ? {
                  ...context,
                  queryConstraint: {
                    interpretation:
                      'September 1–5, 2026 are complete local days. September 6 is the exclusive as-of day in Asia/Jakarta.',
                    requiredFilter: fixedFilter,
                    supportedPeriod,
                  },
                }
              : context,
          ),
        };
      },
    },
  });
  if (!connected.ok) throw new Error(connected.diagnostics[0]?.message ?? 'J2 pairing failed.');
  return {
    endpoint: connected.value,
    close() {
      connected.value.close();
      app.unmount('live-attendance');
      app.dispose();
    },
  };
}
