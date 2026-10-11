import { describe, expect, it } from 'vitest';
import type { Expression } from '../../packages/core/src/contracts/types.js';
import type { QueryResult, QuerySource, RelationalQuery } from '../../packages/core/src/query/types.js';
import {
  aggregateCall,
  baseJoins,
  binding,
  coreCall,
  execute,
  expected,
  field,
  float,
  integer,
  literal,
  periodFilter,
  plainField,
  plan,
  queryPins,
  raw,
  sourceFor,
  text,
  version,
  type HrExpectedEmployee,
} from './fixtures/hr.js';

const absentStatus = literal('absent', text());
const zero = literal(0, integer());
const one = literal(1, integer());
const nullRate = literal(null, float(true));
const status = field('observations', 'status');

const isNull = (expression: Expression): Expression => coreCall('core.is-null', [expression]);
const equal = (left: Expression, right: Expression): Expression => coreCall('core.equal', [left, right]);
const conditional = (condition: Expression, thenBranch: Expression, elseBranch: Expression): Expression =>
  coreCall('core.if', [condition, thenBranch, elseBranch]);
const sum = (expression: Expression): Expression => aggregateCall('core.aggregate.sum', [expression]);
const count = (expression: Expression): Expression => aggregateCall('core.aggregate.count', [expression]);

/** A missing observation contributes zero to the display count. */
const absentDisplayFlag = conditional(isNull(status), zero, conditional(equal(status, absentStatus), one, zero));
/** The raw numerator deliberately propagates a missing status to null. */
const absentNumeratorFlag = conditional(equal(status, absentStatus), one, zero);
const unknownFlag = conditional(isNull(status), one, zero);
function metricQuery(
  groupBy: readonly { id: string; expression: Expression }[],
  selectIds: readonly string[],
): RelationalQuery {
  return {
    root: 'schedules',
    pins: queryPins,
    joins: baseJoins(),
    filter: periodFilter,
    groupBy,
    aggregates: [
      { id: 'absent', function: version('core.aggregate.sum'), arguments: [absentDisplayFlag] },
      { id: 'expected', function: version('core.aggregate.count'), arguments: [field('schedules', 'date')] },
      { id: 'unknown', function: version('core.aggregate.sum'), arguments: [unknownFlag] },
      {
        id: 'rate',
        function: version('core.if'),
        arguments: [
          equal(sum(unknownFlag), zero),
          coreCall('core.divide.null', [sum(absentNumeratorFlag), count(field('schedules', 'date'))]),
          nullRate,
        ],
      },
    ],
    select: selectIds.map((id) => ({ id, expression: plainField(id) })),
  };
}

const employeeQuery = (): RelationalQuery =>
  metricQuery(
    [
      { id: 'employee_id', expression: field('schedules', 'employee_id') },
      { id: 'department', expression: field('employees', 'department') },
    ],
    ['employee_id', 'department', 'absent', 'expected', 'unknown', 'rate'],
  );

const departmentQuery = (): RelationalQuery =>
  metricQuery(
    [{ id: 'department', expression: field('employees', 'department') }],
    ['department', 'absent', 'expected', 'unknown', 'rate'],
  );

function rankingQuery(): RelationalQuery {
  return {
    ...employeeQuery(),
    orderBy: [
      { expression: plainField('rate'), direction: 'desc', nulls: 'last' },
      { expression: plainField('employee_id'), direction: 'asc', nulls: 'last' },
    ],
    topK: expected.topFive.length,
  };
}

function fractionNumber(value: string | null): number | null {
  if (value === null) return null;
  const parts = value.split('/');
  if (parts.length === 1) return Number(parts[0]);
  if (parts.length !== 2) throw new Error(`Invalid expected fraction ${value}`);
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
    throw new Error(`Invalid expected fraction ${value}`);
  return numerator / denominator;
}

function ordered(rows: readonly Record<string, unknown>[], key = 'employee_id'): Record<string, unknown>[] {
  return [...rows].sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

function assertApproximateFraction(actual: unknown, expectedFraction: string | null): void {
  const expectedNumber = fractionNumber(expectedFraction);
  if (expectedNumber === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(typeof actual).toBe('number');
  expect(Math.abs(Number(actual) - expectedNumber)).toBeLessThan(1e-12);
}

function assertEmployeeRows(result: QueryResult, expectedRows: readonly HrExpectedEmployee[]): void {
  const wanted = ordered(
    expectedRows.map((row) => ({
      employee_id: row.employee_id,
      department: row.department,
      absent: row.absent,
      expected: row.expected,
      unknown: row.unknown,
      rate: fractionNumber(row.rate),
    })),
  );
  const actual = ordered(
    result.rows.map((row) => ({
      employee_id: row.employee_id,
      department: row.department,
      absent: row.absent,
      expected: row.expected,
      unknown: row.unknown,
      rate: row.rate,
    })),
  );
  expect(actual).toHaveLength(wanted.length);
  for (let index = 0; index < wanted.length; index += 1) {
    expect(actual[index]?.employee_id).toBe(wanted[index]?.employee_id);
    expect(actual[index]?.department).toBe(wanted[index]?.department);
    expect(actual[index]?.absent).toBe(wanted[index]?.absent);
    expect(actual[index]?.expected).toBe(wanted[index]?.expected);
    expect(actual[index]?.unknown).toBe(wanted[index]?.unknown);
    assertApproximateFraction(
      actual[index]?.rate,
      expectedRows.find((row) => row.employee_id === wanted[index]?.employee_id)?.rate ?? null,
    );
  }
  expect(result.complete).toBe(true);
}

function assertDepartmentRows(result: QueryResult): void {
  const wanted = [...expected.departments].sort((left, right) => left.department.localeCompare(right.department));
  const actual = [...result.rows].sort((left, right) =>
    String(left.department).localeCompare(String(right.department)),
  );
  expect(actual).toHaveLength(wanted.length);
  for (let index = 0; index < wanted.length; index += 1) {
    const row = actual[index]!;
    const target = wanted[index]!;
    expect(row.department).toBe(target.department);
    expect(row.absent).toBe(target.absent);
    expect(row.expected).toBe(target.expected);
    expect(row.unknown).toBe(target.unknown);
    assertApproximateFraction(row.rate, target.rate);
  }
}

function expectedMutationRows(mutation: (typeof binding.mutations)[number]): HrExpectedEmployee[] {
  return expected.employees.map((row) =>
    row.employee_id === mutation.expected.employee.employee_id ? { ...row, ...mutation.expected.employee } : row,
  );
}

function assertMutationTopFive(source: QuerySource, expectedTopFive: readonly string[]): void {
  const result = execute(rankingQuery(), source);
  expect(result.rows.map((row) => row.employee_id)).toEqual(expectedTopFive);
  if (result.rows.some((row) => typeof row.rate === 'number')) expect(result.precision.kind).toBe('approximate');
}

describe('production query engine raw HR metrics', () => {
  it('binds every per-employee count and rate to the raw fixture', () => {
    expect(raw.synthetic).toBe(true);
    expect(binding.source).toBe('fixtures/hr/raw.json');
    expect(raw.policy.period).toMatchObject(binding.policy);
    const result = execute(employeeQuery());
    assertEmployeeRows(result, expected.employees);
    expect(result.precision.kind).toBe('approximate');
  });

  it('computes department metrics through the validated employee relationship', () => {
    const result = execute(departmentQuery());
    assertDepartmentRows(result);
    expect(result.precision.kind).toBe('approximate');
  });

  it('returns the fixture top five through query ordering and top-k', () => {
    const result = execute(rankingQuery());
    expect(result.rows.map((row) => row.employee_id)).toEqual(expected.topFive);
    expect(result.precision.kind).toBe('approximate');
  });

  it('applies both missing-observation mutations to the full employee output', () => {
    for (const mutation of binding.mutations) {
      const source = sourceFor(mutation.removeObservation);
      const result = execute(employeeQuery(), source);
      assertEmployeeRows(result, expectedMutationRows(mutation));
      assertMutationTopFive(source, mutation.expected.topFive);
      if (mutation.expected.sameAsBaseline === true) expect(result.rows).toEqual(execute(employeeQuery()).rows);
    }
  });

  it('keeps the declared half-open period independent of extra schedules', () => {
    const source = sourceFor();
    const employeeId = raw.employees[0]!.id;
    const outside: QuerySource = {
      ...source,
      relations: {
        ...source.relations,
        schedules: {
          ...source.relations.schedules!,
          rows: [
            ...raw.schedules,
            { employee_id: employeeId, date: '2026-01-04' },
            { employee_id: employeeId, date: binding.policy.toExclusive },
          ],
        },
      },
    };
    assertEmployeeRows(execute(employeeQuery(), outside), expected.employees);
  });

  it('rejects duplicate observation join keys before conditional aggregation', () => {
    const source = sourceFor();
    const duplicate: QuerySource = {
      ...source,
      relations: {
        ...source.relations,
        observations: {
          ...source.relations.observations!,
          rows: [...raw.observations, { ...raw.observations[0]!, id: 'synthetic-duplicate-observation' }],
        },
      },
    };
    expect(() => execute(employeeQuery(), duplicate)).toThrow(/query\.cardinality/);
  });

  it('plans the full conditional metric DAG with the v2 registry', () => {
    const planned = plan(employeeQuery());
    expect(planned).toMatchObject({ ok: true });
    if (planned.ok)
      expect(planned.value.nodes.map((node) => node.op)).toEqual([
        'scan',
        'scan',
        'join',
        'scan',
        'join',
        'scan',
        'join',
        'filter',
        'group',
        'aggregate',
        'project',
      ]);
  });
});
