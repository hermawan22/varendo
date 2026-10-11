import { defineResource } from '@varendo/core';
import * as z from 'zod';

/** Synthetic month end snapshots used by the primary People journey. */
export const HEADCOUNT_RESOURCE = defineResource({
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
      explanation:
        'Employees active at the end of each month. Values are compared across months, never summed over time.',
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

export const HEADCOUNT_RECORDS = Object.freeze([
  { id: 'hc-2026-03', month: '2026-03-01', headcount: 118 },
  { id: 'hc-2026-04', month: '2026-04-01', headcount: 121 },
  { id: 'hc-2026-05', month: '2026-05-01', headcount: 124 },
  { id: 'hc-2026-06', month: '2026-06-01', headcount: 127 },
  { id: 'hc-2026-07', month: '2026-07-01', headcount: 126 },
  { id: 'hc-2026-08', month: '2026-08-01', headcount: 130 },
]);
