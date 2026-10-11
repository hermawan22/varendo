import type { AeliqoDataValue } from './types.js';

interface DecimalRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export function decimalInput(value: AeliqoDataValue | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (isDecimalValue(value)) return value.decimal;
  return undefined;
}

function isDecimalValue(value: AeliqoDataValue | undefined): value is { readonly decimal: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.decimal === 'string';
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function rational(numerator: bigint, denominator: bigint): DecimalRational | undefined {
  if (denominator === 0n) return undefined;
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

/** Parse decimal text without converting it through IEEE-754. */
function parseDecimal(value: string): DecimalRational | undefined {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?\d+))?$/iu.exec(value);
  if (match === null) return undefined;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) return undefined;
  let numerator = BigInt(`${match[1]}${match[2]}${fraction}`);
  const scale = fraction.length - exponent;
  let denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else if (scale < 0) numerator *= 10n ** BigInt(-scale);
  return rational(numerator, denominator);
}

/** Return a decimal string only when the rational has an exact finite form. */
function finiteDecimal(value: DecimalRational): string | undefined {
  if (value.numerator === 0n) return '0';
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos++;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives++;
  }
  if (denominator !== 1n) return undefined;
  const scale = Math.max(twos, fives);
  const coefficient =
    (value.numerator < 0n ? -value.numerator : value.numerator) *
    2n ** BigInt(scale - twos) *
    5n ** BigInt(scale - fives);
  const digits = coefficient.toString();
  const padded = digits.padStart(scale + 1, '0');
  const whole = scale === 0 ? padded : padded.slice(0, -scale) || '0';
  const fraction = scale === 0 ? '' : padded.slice(-scale).replace(/0+$/u, '');
  const sign = value.numerator < 0n ? '-' : '';
  const decimal = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return `${sign}${decimal}`;
}

export function subtractDecimal(left: string, right: string): string | undefined {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === undefined || b === undefined) return undefined;
  const difference = rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
  return difference === undefined ? undefined : finiteDecimal(difference);
}

export function timesHundred(value: string): string | undefined {
  const parsed = parseDecimal(value);
  if (parsed === undefined) return undefined;
  const scaled = rational(parsed.numerator * 100n, parsed.denominator);
  return scaled === undefined ? undefined : finiteDecimal(scaled);
}

export function divideDecimal(left: string, right: string): string | undefined {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === undefined || b === undefined || b.numerator === 0n) return undefined;
  const quotient = rational(a.numerator * b.denominator, a.denominator * b.numerator);
  return quotient === undefined ? undefined : finiteDecimal(quotient);
}

export function decimalIsZero(value: string): boolean {
  return parseDecimal(value)?.numerator === 0n;
}

export function signed(value: string): string {
  return value.startsWith('-') || value === '0' ? value : `+${value}`;
}

export function decimalText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Object.is(value, -0)) return '0';
  return String(Number(value.toPrecision(15)));
}
