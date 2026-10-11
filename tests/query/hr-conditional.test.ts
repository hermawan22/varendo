import { describe, expect, it } from 'vitest';
import type { Expression } from '../../packages/core/src/contracts/types.js';
import type { RelationalQuery } from '../../packages/core/src/query/types.js';
import {
  baseJoins,
  coreCall,
  execute,
  field,
  integer,
  literal,
  periodFilter,
  plainField,
  plan,
  queryPins,
  registry,
  sourceFor,
  text,
  version,
} from './fixtures/hr.js';

const status = field('observations', 'status');
const absent = literal('absent', text());
const zero = literal(0, integer());
const one = literal(1, integer());
const isNull = (expression: Expression): Expression => coreCall('core.is-null', [expression]);
const equal = (left: Expression, right: Expression): Expression => coreCall('core.equal', [left, right]);
const conditional = (condition: Expression, thenBranch: Expression, elseBranch: Expression): Expression =>
  coreCall('core.if', [condition, thenBranch, elseBranch]);

function conditionalRowsQuery(): RelationalQuery {
  return {
    root: 'schedules',
    pins: queryPins,
    joins: baseJoins(),
    filter: periodFilter,
    derives: [
      { id: 'unknown_flag', expression: conditional(isNull(status), one, zero) },
      {
        id: 'absent_flag',
        expression: conditional(isNull(status), zero, conditional(equal(status, absent), one, zero)),
      },
    ],
    select: [
      { id: 'employee_id', expression: field('schedules', 'employee_id') },
      { id: 'date', expression: field('schedules', 'date') },
      { id: 'observation_id', expression: field('observations', 'id') },
      { id: 'leave_employee_id', expression: field('leave', 'employee_id') },
      { id: 'leave_date', expression: field('leave', 'date') },
      { id: 'employee_dimension_id', expression: field('employees', 'id') },
      { id: 'unknown_flag', expression: plainField('unknown_flag') },
      { id: 'absent_flag', expression: plainField('absent_flag') },
    ],
  };
}

function rowFor(rows: readonly Record<string, unknown>[], employee_id: string, date: string): Record<string, unknown> {
  const row = rows.find((candidate) => candidate.employee_id === employee_id && candidate.date === date);
  if (row === undefined) throw new Error(`Missing row ${employee_id}/${date}`);
  return row;
}

describe('raw HR conditional query expressions', () => {
  it('pins core.equal and core.if to the reviewed query v2 registry', () => {
    expect(registry.digest).toBe('core-query-2');
    expect(registry.resolve(version('core.equal'))?.operation).toBe('comparison');
    expect(registry.resolve(version('core.if'))?.operation).toBe('conditional');
    const planned = plan(conditionalRowsQuery());
    expect(planned).toMatchObject({ ok: true });
  });

  it('evaluates absent and unknown flags on joined observation rows', () => {
    const baseline = execute(conditionalRowsQuery());
    const e1Absent = rowFor(baseline.rows, 'e1', '2026-01-06');
    expect(e1Absent).toMatchObject({ unknown_flag: 0, absent_flag: 1 });

    const missing = execute(conditionalRowsQuery(), sourceFor({ employee_id: 'e1', date: '2026-01-05' }));
    const e1Missing = rowFor(missing.rows, 'e1', '2026-01-05');
    expect(e1Missing).toMatchObject({ unknown_flag: 1, absent_flag: 0 });

    const approvedLeaveMissing = execute(conditionalRowsQuery(), sourceFor({ employee_id: 'e2', date: '2026-01-05' }));
    expect(approvedLeaveMissing.rows.some((row) => row.employee_id === 'e2' && row.date === '2026-01-05')).toBe(false);
  });
});
