import { validateScalar } from '@varendo/core';
import type { AeliqoDataValue, AeliqoDeltaResult } from './types.js';
import {
  decimalInput,
  decimalIsZero,
  decimalText,
  divideDecimal,
  signed,
  subtractDecimal,
  timesHundred,
} from './delta-decimal.js';

export type AeliqoDeltaMode = 'absolute' | 'relative' | 'percentage-point';

type UnavailableReason = NonNullable<AeliqoDeltaResult['reason']>;

function unavailable(reason: UnavailableReason): AeliqoDeltaResult {
  return { status: 'unavailable', reason };
}

const DELTA_MODES: readonly AeliqoDeltaMode[] = ['absolute', 'relative', 'percentage-point'];

function isDeltaMode(mode: string): mode is AeliqoDeltaMode {
  return DELTA_MODES.includes(mode as AeliqoDeltaMode);
}

function hasInvalidDecimal(value: AeliqoDataValue | undefined): boolean {
  if (value === null || typeof value !== 'object') return false;
  return !validateScalar(value, { value: 'decimal', nullable: false }).ok;
}

function hasInvalidInput(current: AeliqoDataValue | undefined, baseline: AeliqoDataValue | undefined): boolean {
  return hasInvalidDecimal(current) || hasInvalidDecimal(baseline);
}

function numeric(value: AeliqoDataValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = decimalInput(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function exactValue(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  value: string,
): string | number {
  if (typeof current === 'number' && typeof baseline === 'number') return Number(value);
  return value;
}

function exactAbsoluteDelta(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  mode: AeliqoDeltaMode,
  difference: string | undefined,
): AeliqoDeltaResult | undefined {
  if (difference === undefined || (mode !== 'absolute' && mode !== 'percentage-point')) return undefined;
  const value = exactValue(current, baseline, difference);
  if (typeof value === 'number' && !Number.isFinite(value)) return unavailable('invalid');
  if (mode === 'absolute') return { status: 'ready', value, display: signed(difference) };
  const percentagePoints = timesHundred(difference);
  if (percentagePoints === undefined) return undefined;
  return { status: 'ready', value, display: `${signed(percentagePoints)} pp` };
}

function exactRelativeDelta(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  currentText: string | undefined,
  baselineText: string | undefined,
  difference: string | undefined,
): AeliqoDeltaResult | undefined {
  if (currentText === undefined || baselineText === undefined) return undefined;
  const ratio = difference === undefined ? undefined : divideDecimal(difference, baselineText);
  if (ratio === undefined && decimalIsZero(baselineText)) return unavailable('zero-denominator');
  if (ratio !== undefined) {
    const percentage = timesHundred(ratio);
    if (percentage !== undefined) {
      const value = exactValue(current, baseline, ratio);
      if (typeof value === 'string') return { status: 'ready', value, display: `${signed(percentage)}%` };
      if (Number.isFinite(value)) return { status: 'ready', value, display: `${signed(percentage)}%` };
    }
  }
  if (typeof current === 'object' || typeof baseline === 'object') return unavailable('invalid');
  return undefined;
}

function approximateDisplay(value: number, mode: AeliqoDeltaMode): string {
  if (mode === 'relative') return `${formatApproximatePercent(value)}%`;
  if (mode === 'percentage-point') return `${formatApproximatePercent(value)} pp`;
  return `${value > 0 ? '+' : ''}${decimalText(value)}`;
}

function formatApproximatePercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  const precision = Math.abs(value) < 0.1 ? 1 : 0;
  return `${sign}${(value * 100).toFixed(precision)}`;
}

function approximateDelta(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  mode: AeliqoDeltaMode,
): AeliqoDeltaResult {
  const currentNumber = numeric(current);
  const baselineNumber = numeric(baseline);
  if (currentNumber === undefined) return unavailable('missing-current');
  if (baselineNumber === undefined) return unavailable('missing-baseline');
  if (mode === 'relative' && baselineNumber === 0) return unavailable('zero-denominator');
  const difference = currentNumber - baselineNumber;
  const value = mode === 'relative' ? difference / baselineNumber : difference;
  if (!Number.isFinite(value)) return unavailable('invalid');
  return { status: 'ready', value, display: approximateDisplay(value, mode) };
}

/** Calculate a delta only when the two values are explicitly compatible. */
export function calculateAeliqoDelta(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  mode: AeliqoDeltaMode = 'absolute',
  compatible = true,
): AeliqoDeltaResult {
  if (!compatible) return unavailable('incompatible');
  if (!isDeltaMode(mode)) return unavailable('invalid');
  if (hasInvalidInput(current, baseline)) return unavailable('invalid');
  return exactDelta(current, baseline, mode) ?? approximateDelta(current, baseline, mode);
}

function exactDelta(
  current: AeliqoDataValue | undefined,
  baseline: AeliqoDataValue | undefined,
  mode: AeliqoDeltaMode,
): AeliqoDeltaResult | undefined {
  const currentText = decimalInput(current);
  const baselineText = decimalInput(baseline);
  const difference = exactDifference(currentText, baselineText);
  const absolute = exactAbsoluteDelta(current, baseline, mode, difference);
  if (absolute !== undefined) return absolute;
  if (mode !== 'relative') return undefined;
  return exactRelativeDelta(current, baseline, currentText, baselineText, difference);
}

function exactDifference(current: string | undefined, baseline: string | undefined): string | undefined {
  if (current === undefined || baseline === undefined) return undefined;
  return subtractDecimal(current, baseline);
}
