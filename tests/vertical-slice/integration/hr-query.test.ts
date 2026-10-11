import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createQueryPlanner, type QuerySource, type QuerySpec } from '../../../packages/core/dist/query/index.js';
import {
  catalog,
  functionRegistry,
  metricQuery,
  rankingQuery,
  snapshot,
  sourceLimits,
  trendQuery,
} from '../../../examples/vertical-slice/src/hr.js';

type ExpectedRow = {
  employee_id: string;
  week?: string;
  absent: number;
  expected: number;
  unknown: number;
  rate: string | null;
};
const golden = JSON.parse(readFileSync(new URL('../../../fixtures/hr/expected.json', import.meta.url), 'utf8')) as {
  employees: ExpectedRow[];
  topFive: string[];
  weekly: ExpectedRow[];
};
function execute(query: QuerySpec) {
  const factory = createQueryPlanner({
    catalog,
    registry: functionRegistry,
    limits: { maxRows: sourceLimits.rows, maxBytes: sourceLimits.bytes },
  });
  if (!factory.ok) throw new Error(JSON.stringify(factory.diagnostics));
  const plan = factory.value.plan(query);
  if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics));
  const current = snapshot();
  const source: QuerySource = {
    revision: current.sourceRevision,
    relations: Object.fromEntries(
      Object.entries(current.records).map(([entity, rows]) => [entity, { entity, complete: true, rows }]),
    ),
  };
  const result = factory.value.evaluate(plan.value, source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function fraction(value: string | null): number | null {
  if (value === null) return null;
  const [numerator, denominator = '1'] = value.split('/');
  return Number(numerator) / Number(denominator);
}
function checkRow(row: Record<string, unknown>, expected: ExpectedRow) {
  expect(row.employee_id).toBe(expected.employee_id);
  expect(row['absence.absent']).toBe(expected.absent);
  expect(row['absence.expected']).toBe(expected.expected);
  expect(row['absence.unknown']).toBe(expected.unknown);
  const rate = fraction(expected.rate);
  if (rate === null) expect(row['absence.rate']).toBeNull();
  else expect(row['absence.rate']).toBeCloseTo(rate, 12);
}

describe('raw HR fixture through the production query compiler', () => {
  it('matches independent employee totals and exact ranked membership', () => {
    const metrics = execute(metricQuery());
    expect(metrics.rows).toHaveLength(golden.employees.length);
    expect(metrics.schema.fields.find((field) => field.id === 'absence.rate')?.label).toBe('Absence rate');
    for (const expected of golden.employees)
      checkRow(
        metrics.rows.find((row) => row.employee_id === expected.employee_id)!,
        expected,
      );
    const ranked = execute(rankingQuery());
    expect(ranked.complete).toBe(true);
    expect(ranked.rows.map((row) => row.employee_id)).toEqual(golden.topFive);
  });
  it('matches independent weekly numerator, denominator and unknown policy without display arithmetic', () => {
    // Cohort materialization belongs to ADC. This test isolates the same weekly query's calendar/math pass.
    const weekly = execute({ ...trendQuery(), population: { kind: 'all-authorized' } });
    for (const expected of golden.weekly) {
      const row = weekly.rows.find((row) => row.employee_id === expected.employee_id && row.date === expected.week);
      expect(row, `${expected.employee_id}/${expected.week}`).toBeDefined();
      checkRow(row!, expected);
    }
    expect(weekly.schema.fields.find((field) => field.id === 'date')?.type.temporal).toEqual({
      calendar: 'iso8601',
      timezone: 'Asia/Jakarta',
      grain: 'week',
    });
  });
});
