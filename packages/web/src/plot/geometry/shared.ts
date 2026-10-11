import type { Outcome, Result } from '@varendo/core';
import type { PlotDatum, PlotGeometry, PlotGeometryOptions } from './types.js';

export function fail(code: string, message: string): Outcome<never> {
  return {
    ok: false,
    diagnostics: [{ code: `plot.${code}`, message, retryable: false }],
  };
}

export function dataOnly(
  options: PlotGeometryOptions,
  rows: readonly PlotDatum[],
  result: Result,
  reason: string,
): Outcome<PlotGeometry> {
  return {
    ok: true,
    value: {
      state: 'data-only',
      reason,
      width: options.width,
      height: options.height,
      marks: [],
      rows,
      series: [],
      legend: [],
      result,
    },
  };
}

export function validateOptions(options: PlotGeometryOptions): Outcome<void> {
  const { width, height, maxRows, maxMarks } = options;
  const validDimensions = dimensionsWithinBudget(width, height);
  const validRows = integerWithinBudget(maxRows, 1, 10_000);
  const validMarks = integerWithinBudget(maxMarks, 1, 50_000);
  if (!validDimensions || !validRows || !validMarks)
    return fail('budget', 'The plot dimensions or geometry budget are unsupported.');
  return { ok: true, value: undefined };
}

function dimensionsWithinBudget(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 160 &&
    height >= 120 &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 4_000_000
  );
}

function integerWithinBudget(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
