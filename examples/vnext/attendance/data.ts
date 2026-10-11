import { defineResource, type Intent, type QuerySpec } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { z } from 'zod';
import { attendanceDayFilter } from './period.js';

const visiblePeriod: NonNullable<QuerySpec['period']> = {
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-10-01T00:00:00+07:00',
  timezone: 'Asia/Jakarta',
  calendar: 'gregorian',
  interpretation: 'September 2026, through the last complete local day as of 6 September',
};
const asOfExclusiveDay = '2026-09-06';

export const records = [
  { id: 'ada-01', employee: 'Ada', day: '2026-09-01', present: 1, eligible: 1 },
  { id: 'ben-01', employee: 'Ben', day: '2026-09-01', present: 1, eligible: 1 },
  { id: 'ada-02', employee: 'Ada', day: '2026-09-02', present: 1, eligible: 1 },
  { id: 'ben-02', employee: 'Ben', day: '2026-09-02', present: 0, eligible: 1 },
  { id: 'ada-03', employee: 'Ada', day: '2026-09-03', present: 1, eligible: 1 },
  { id: 'ben-03-leave', employee: 'Ben', day: '2026-09-03', present: 0, eligible: 0 },
  { id: 'ada-06-future', employee: 'Ada', day: '2026-09-06', present: 1, eligible: 1 },
] as const;

const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0]!.message);
export const functionRegistry = functions.value;
const ref = (id: string) => ({ id, revision: '1' }) as const;

const generated = defineResource({
  id: 'daily-attendance',
  revision: 'attendance-1',
  label: 'Synthetic attendance',
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
    present: { label: 'Present eligible employee-days', role: 'measure' },
    eligible: { label: 'Eligible employee-days', role: 'measure' },
  },
  meanings: [
    {
      id: 'attendance.rate',
      revision: '1',
      label: 'Attendance rate',
      explanation: 'Present eligible employee-days divided by eligible employee-days; approved leave is excluded.',
      output: { value: 'float', nullable: true },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: ref('core.ratio-of-sums.null'),
          arguments: [
            { kind: 'field', ref: 'present' },
            { kind: 'field', ref: 'eligible' },
          ],
        },
      },
      dependencies: [],
      functionRegistryDigest: functions.value.digest,
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'ratio-of-sums',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    },
    {
      id: 'attendance.present',
      revision: '1',
      label: 'Present employee-days',
      explanation: 'Sum of present eligible employee-days.',
      output: { value: 'integer', nullable: true },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: ref('core.aggregate.sum'),
          arguments: [{ kind: 'field', ref: 'present' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: functions.value.digest,
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    },
  ],
  presentation: { allowedViews: ['table', 'trend'], preferred: { analyze: 'trend' } },
});

// z.iso.date() establishes a civil day. The host declares its actual calendar
// timezone explicitly; generated resource fields otherwise default to UTC.
export const resource = defineResource({
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
              type: {
                ...field.type,
                temporal: { calendar: 'gregorian' as const, timezone: 'Asia/Jakarta', grain: 'day' as const },
              },
            }
          : field,
      ),
    })),
  },
});

export function dailyAttendanceIntent(
  measures: readonly [
    { readonly id: string; readonly revision: string },
    ...{ readonly id: string; readonly revision: string }[],
  ] = [{ id: 'attendance.rate', revision: '1' }],
  id = 'daily-attendance',
): Intent {
  return {
    version: '1',
    id,
    kind: 'analyze',
    resource: resource.id,
    measures,
    time: { field: 'day', grain: 'day', calendar: 'gregorian', timezone: 'Asia/Jakarta' },
    filter: attendanceDayFilter(visiblePeriod, asOfExclusiveDay),
    preferredView: 'trend',
  };
}
