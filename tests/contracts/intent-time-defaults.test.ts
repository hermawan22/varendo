import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { compileIntent, defineResource } from '../../packages/core/src/app/index.js';
import type { Intent } from '../../packages/core/src/index.js';

const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), joined: z.iso.date() }),
  fields: { joined: { role: 'time' } },
  measures: { hires: { label: 'New hires', aggregate: 'count' } },
  presentation: { allowedViews: ['table', 'trend'] },
});

function bucket(time: Extract<Intent, { kind: 'analyze' }>['time']) {
  const task = compileIntent(
    {
      version: '1',
      id: 'trend',
      kind: 'analyze',
      resource: 'people',
      measures: [{ id: 'hires', revision: '1' }],
      time,
    },
    { resource: people, regionId: 'main' },
  );
  if (!task.ok) throw new Error(task.diagnostics[0].message);
  const output = task.value.kind === 'data' ? task.value.outputs[0] : undefined;
  return output?.kind === 'query' ? output.query.timeBucket : undefined;
}

describe('analyze time bucket defaults', () => {
  it('takes the calendar and timezone from the time field metadata', () => {
    expect(bucket({ field: 'joined', grain: 'month' })).toEqual({
      field: 'joined',
      grain: 'month',
      calendar: 'gregorian',
      timezone: 'UTC',
    });
  });

  it('keeps an explicit calendar and timezone', () => {
    expect(bucket({ field: 'joined', grain: 'month', calendar: 'iso8601', timezone: 'Asia/Jakarta' })).toMatchObject({
      calendar: 'iso8601',
      timezone: 'Asia/Jakarta',
    });
  });

  it('never invents a week start', () => {
    expect(bucket({ field: 'joined', grain: 'week' })).not.toHaveProperty('weekStartsOn');
  });
});
