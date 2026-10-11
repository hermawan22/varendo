import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type OracleOutput = {
  seededFanout: {
    seed: number;
    eligibleEmployees: string[];
    semijoinTotal: number;
    fanoutMutantTotal: number;
  };
  ratioOfSums: { ratioOfSums: string; meanOfRatesMutant: string };
  emptyUnknown: {
    empty: { state: string; rate: null };
    missingNumerator: { state: string; reason: string; rate: null };
    zeroDenominator: { state: string; reason: string; rate: null };
    zeroValid: { state: string; rate: string };
  };
  exactArithmetic: {
    decimalTotal: string;
    integerTotal: string;
    safeIntegerMaximum: number;
    unsafeIntegerInput: { state: string; value: string };
  };
  ranking: {
    fixedTopK: string[];
    fixedWeekly: Array<{ employee: string; week: string; numerator: number; denominator: number; rate: string }>;
    liveTopByWeekMutant: Record<string, string[]>;
    partialPageTopMutant: string;
    fullTop: string;
    totals: Array<{ employee: string; numerator: number; denominator: number; rate: string }>;
  };
  incompleteAndAdversarial: {
    cardinality: { state: string; reason: string; offendingEmployees: string[] };
    halfOpenPeriod: { included: string[]; excluded: string[] };
    invalidDecimal: { state: string; value: string };
  };
  timeBuckets: {
    calendar: string;
    timezone: string;
    weekStartsOn: number;
    instants: Array<{
      id: string;
      utc: string;
      day: string;
      week: string;
      month: string;
      quarter: string;
      year: string;
    }>;
    unsupportedTimezone: { state: string; timezone: string };
  };
  windows: {
    registry: string;
    frame: { preceding: number; following: number };
    rows: Array<{
      id: string;
      partition: string;
      sequence: number;
      score: number;
      value: number | null;
      sum: number | null;
      lag: number | null;
      rank: number;
    }>;
    invalidLagFrame: { state: string; reason: string; requiredPreceding: number };
  };
};

const oracleDirectory = fileURLToPath(new URL('./oracle/', import.meta.url));
const oraclePath = `${oracleDirectory}oracle.py`;
const expectedPath = `${oracleDirectory}expected.json`;
const casesPath = `${oracleDirectory}cases.json`;
const hrBindingPath = `${oracleDirectory}hr-binding.json`;

function runOracle(...args: string[]): OracleOutput {
  const result = spawnSync('python3', [oraclePath, '--json', ...args], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'oracle failed');
  }
  return JSON.parse(result.stdout) as OracleOutput;
}

describe('independent numerical oracle', () => {
  it('recomputes the checked expected output without production imports', () => {
    const output = runOracle();
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Json;
    expect(output).toEqual(expected);
    const check = spawnSync('python3', [oraclePath, '--check'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
    });
    expect(check.status).toBe(0);
  });

  it('detects join fanout and preserves semijoin identity scope', () => {
    const { seededFanout } = runOracle();
    expect(seededFanout.eligibleEmployees).toEqual(['e1', 'e3']);
    expect(seededFanout.semijoinTotal).toBe(180);
    expect(seededFanout.fanoutMutantTotal).toBe(360);
    expect(seededFanout.fanoutMutantTotal).not.toBe(seededFanout.semijoinTotal);
  });

  it('requires ratio-of-sums and exact nonterminating rational values', () => {
    const output = runOracle();
    expect(output.ratioOfSums.ratioOfSums).toBe('41/55');
    expect(output.ratioOfSums.meanOfRatesMutant).toBe('1/2');
    expect(output.ratioOfSums.meanOfRatesMutant).not.toBe(output.ratioOfSums.ratioOfSums);
    expect(output.ranking.fixedWeekly.find((row) => row.employee === 'C' && row.week === '2026-W02')?.rate).toBe(
      '11/15',
    );
  });

  it('keeps empty, unknown, zero-denominator and valid-zero states distinct', () => {
    const { emptyUnknown } = runOracle();
    expect(emptyUnknown.empty).toEqual({ state: 'empty', rate: null });
    expect(emptyUnknown.missingNumerator).toEqual({ state: 'unknown', reason: 'missing-input', rate: null });
    expect(emptyUnknown.zeroDenominator).toEqual({ state: 'unknown', reason: 'zero-denominator', rate: null });
    expect(emptyUnknown.zeroValid).toEqual({ state: 'exact', rate: '0' });
  });

  it('retains exact decimal and integer values beyond IEEE-754 safe arithmetic', () => {
    const { exactArithmetic } = runOracle();
    expect(exactArithmetic.decimalTotal).toBe('9007199254740993.02');
    expect(exactArithmetic.integerTotal).toBe('9007199254740992');
    expect(BigInt(exactArithmetic.integerTotal)).toBe(9_007_199_254_740_992n);
    expect(exactArithmetic.safeIntegerMaximum).toBe(9_007_199_254_740_991);
    expect(exactArithmetic.unsafeIntegerInput).toEqual({ state: 'rejected', value: '9007199254740993' });
  });

  it('selects a fixed full-period top-K population before temporal evaluation', () => {
    const { ranking } = runOracle();
    expect(ranking.fixedTopK).toEqual(['C', 'D', 'A']);
    expect(ranking.fixedWeekly.every((row) => ranking.fixedTopK.includes(row.employee))).toBe(true);
    expect(ranking.liveTopByWeekMutant['2026-W01']).toEqual(['B', 'E', 'A']);
    expect(ranking.liveTopByWeekMutant['2026-W01']).not.toEqual(ranking.fixedTopK);
    expect(ranking.totals.filter((row) => row.rate === '3/5').map((row) => row.employee)).toEqual(['C', 'D']);
  });

  it('rejects partial-page winners, violated cardinality and closed time bounds', () => {
    const output = runOracle();
    expect(output.ranking.partialPageTopMutant).toBe('a');
    expect(output.ranking.fullTop).toBe('c');
    expect(output.ranking.partialPageTopMutant).not.toBe(output.ranking.fullTop);
    expect(output.incompleteAndAdversarial.cardinality).toMatchObject({
      state: 'invalid',
      reason: 'many-to-one-violation',
      offendingEmployees: ['e1'],
    });
    expect(output.incompleteAndAdversarial.halfOpenPeriod).toEqual({
      included: ['at-start', 'inside'],
      excluded: ['at-end'],
    });
    expect(output.incompleteAndAdversarial.invalidDecimal).toEqual({ state: 'rejected', value: '1.2.3' });
  });

  it('buckets UTC Gregorian instants exactly across leap and year boundaries', () => {
    const { timeBuckets } = runOracle();
    expect(timeBuckets).toMatchObject({ calendar: 'gregorian', timezone: 'UTC', weekStartsOn: 1 });
    expect(timeBuckets.instants.find((row) => row.id === 'leap-day-end')).toMatchObject({
      utc: '2024-02-29T23:59:59Z',
      day: '2024-02-29',
      week: '2024-W09',
      month: '2024-02',
      quarter: '2024-Q1',
      year: '2024',
    });
    expect(timeBuckets.instants.find((row) => row.id === 'year-end')).toMatchObject({
      week: '2025-W01',
      month: '2024-12',
      quarter: '2024-Q4',
      year: '2024',
    });
    expect(timeBuckets.instants.find((row) => row.id === 'fixed-offset-leap')).toMatchObject({
      utc: '2024-02-29T17:30:00Z',
      day: '2024-02-29',
    });
    expect(timeBuckets.unsupportedTimezone).toEqual({ state: 'unsupported', timezone: 'Asia/Jakarta' });
  });

  it('computes bounded sum, partition lag and competition rank with unknown propagation', () => {
    const { windows } = runOracle();
    expect(windows).toMatchObject({ registry: 'core-query-1', frame: { preceding: 1, following: 1 } });
    expect(windows.rows.map((row) => row.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1']);
    expect(windows.rows.map((row) => row.rank)).toEqual([1, 1, 3, 4, 1]);
    expect(windows.rows.find((row) => row.id === 'a1')).toMatchObject({ sum: null, lag: null });
    expect(windows.rows.find((row) => row.id === 'a2')).toMatchObject({ sum: null, lag: 10 });
    expect(windows.rows.find((row) => row.id === 'a3')).toMatchObject({ sum: null, lag: null });
    expect(windows.rows.find((row) => row.id === 'a4')).toMatchObject({ sum: 35, lag: 30 });
    expect(windows.rows.find((row) => row.id === 'b1')).toMatchObject({ sum: 7, lag: null });
    expect(windows.invalidLagFrame).toEqual({
      state: 'rejected',
      reason: 'lag-frame-requires-preceding',
      requiredPreceding: 1,
    });
  });

  it('uses the checked deterministic fixture seed', () => {
    const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as { seededFanout: { seed: number } };
    const output = runOracle();
    expect(cases.seededFanout.seed).toBe(17);
    expect(output.seededFanout.seed).toBe(17);
  });

  it('retains the HR unknown-versus-approved-leave binding mutations', () => {
    const binding = JSON.parse(readFileSync(hrBindingPath, 'utf8')) as {
      source: string;
      policy: { calendar: string; timezone: string; from: string; toExclusive: string };
      mutations: Array<{
        id: string;
        removeObservation: { employee_id: string; date: string };
        expected: {
          sameAsBaseline?: boolean;
          employee: { employee_id: string; absent: number; expected: number; unknown: number; rate: string | null };
          topFive: string[];
        };
      }>;
    };
    expect(binding.source).toBe('fixtures/hr/raw.json');
    expect(binding.policy).toEqual({
      calendar: 'iso8601',
      timezone: 'Asia/Jakarta',
      from: '2026-01-05',
      toExclusive: '2026-03-30',
    });
    expect(binding.mutations).toEqual([
      expect.objectContaining({
        id: 'missing-required-observation',
        removeObservation: { employee_id: 'e1', date: '2026-01-05' },
        expected: expect.objectContaining({
          employee: { employee_id: 'e1', absent: 20, expected: 60, unknown: 1, rate: null },
        }),
      }),
      expect.objectContaining({
        id: 'missing-approved-leave-observation',
        removeObservation: { employee_id: 'e2', date: '2026-01-05' },
        expected: expect.objectContaining({
          sameAsBaseline: true,
          employee: { employee_id: 'e2', absent: 14, expected: 56, unknown: 0, rate: '1/4' },
        }),
      }),
    ]);
  });
});
