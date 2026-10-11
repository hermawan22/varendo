import { scaleLinear, scaleLog, scalePoint } from 'd3-scale';
import { compareScalars, scalarIdentity, scalarInstantParts, validateScalar } from '@varendo/core';
import type { PlotEncoding, Scalar, SemanticType } from '@varendo/core';

export interface PlotTick {
  readonly position: number;
  readonly value: Scalar;
  readonly label: string;
}

export interface PlotScale {
  readonly at: (value: Scalar) => number | undefined;
  readonly ticks: readonly PlotTick[];
}

export function exactLabel(value: Scalar): string {
  if (value === null) return 'Missing';
  if (typeof value === 'object') return value.decimal;
  return String(value);
}

interface Exact {
  readonly coefficient: bigint;
  readonly scale: number;
}

function numericExact(value: Scalar, type: SemanticType): Exact {
  if (type.value === 'date') return dateExact(value);
  if (type.value === 'instant') return instantExact(value);
  return decimalExact(value);
}

function dateExact(value: Scalar): Exact {
  return { coefficient: BigInt(Date.parse(`${value}T00:00:00Z`)), scale: 0 };
}

function instantExact(value: Scalar): Exact {
  if (typeof value !== 'string') throw Error('Invalid instant');
  const parts = scalarInstantParts(value);
  if (parts === undefined) throw Error('Invalid instant');
  const { milliseconds, fraction } = parts;
  const scale = Math.max(3, fraction.length);
  return {
    coefficient: BigInt(milliseconds) * 10n ** BigInt(scale - 3) + BigInt(fraction.padEnd(scale, '0') || '0'),
    scale,
  };
}

function decimalExact(value: Scalar): Exact {
  const raw = typeof value === 'object' && value !== null ? value.decimal : String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(raw);
  if (match === null) throw Error('Invalid number');
  const exponent = Number(match[4] ?? 0);
  const fraction = match[3] ?? '';
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function collectValues(input: readonly Scalar[], type: SemanticType): Scalar[] {
  const values: Scalar[] = [];
  const identities = new Set<string>();
  for (const value of input) {
    if (value === null) continue;
    if (!validateScalar(value, type).ok) throw Error('Invalid scale value');
    const identity = scalarIdentity(value, type);
    if (!identity.ok) throw Error('Invalid scale identity');
    if (identities.has(identity.value)) continue;
    identities.add(identity.value);
    values.push(value);
  }
  return values;
}

function identityOf(value: Scalar, type: SemanticType): string {
  const identity = scalarIdentity(value, type);
  if (!identity.ok) throw Error('Invalid scale identity');
  return identity.value;
}

function ordinalScale(
  values: readonly Scalar[],
  type: SemanticType,
  range: readonly [number, number],
): PlotScale['at'] {
  const scale = scalePoint<string>()
    .domain(values.map((value) => identityOf(value, type)))
    .range([...range])
    .padding(0.5);
  return (value) => {
    if (value === null) return undefined;
    return scale(identityOf(value, type));
  };
}

interface NumericDomain {
  readonly integers: readonly bigint[];
  readonly toInteger: (value: Scalar) => bigint;
}

function exactIntegers(values: readonly Scalar[], type: SemanticType, includeZero: boolean): NumericDomain {
  const exact = values.map((value) => numericExact(value, type));
  if (includeZero) exact.push({ coefficient: 0n, scale: 0 });
  const decimalPlaces = Math.max(0, ...exact.map((value) => value.scale));
  const integers = exact.map((value) => value.coefficient * 10n ** BigInt(decimalPlaces - value.scale));
  return {
    integers,
    toInteger: (value) => {
      const part = numericExact(value, type);
      return part.coefficient * 10n ** BigInt(decimalPlaces - part.scale);
    },
  };
}

function sortedValues(values: Scalar[], type: SemanticType): Scalar[] {
  values.sort((left, right) => {
    const order = compareScalars(left, right, type);
    if (!order.ok || order.value === null) throw Error('Unordered scale');
    return order.value;
  });
  return values;
}

function numericScale(
  values: Scalar[],
  encoding: PlotEncoding,
  type: SemanticType,
  range: readonly [number, number],
): PlotScale['at'] {
  sortedValues(values, type);
  const domain = exactIntegers(values, type, encoding.zero === true);
  const [minimum, maximum] = integerExtent(domain.integers);
  if (encoding.scale === 'log') return logarithmicScale(minimum, maximum, domain.integers, domain.toInteger, range);
  return linearScale(minimum, maximum, domain.toInteger, range);
}

function integerExtent(values: readonly bigint[]): readonly [bigint, bigint] {
  let minimum = values[0] ?? 0n;
  let maximum = minimum;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return [minimum, maximum];
}

function logarithmicPosition(value: bigint): number {
  const digits = value.toString();
  return Math.log10(Number(digits.slice(0, 16))) + digits.length - Math.min(16, digits.length);
}

function logarithmicScale(
  minimum: bigint,
  maximum: bigint,
  integers: readonly bigint[],
  toInteger: (value: Scalar) => bigint,
  range: readonly [number, number],
): PlotScale['at'] {
  if (integers.some((value) => value <= 0n)) throw Error('Log scales require positive observations');
  const low = logarithmicPosition(minimum || 1n);
  const high = logarithmicPosition(maximum || 1n);
  if (minimum !== maximum && low === high) throw Error('Log scale precision cannot distinguish the observations');
  const scale = scaleLog()
    .domain([1, 10])
    .range([...range]);
  return (value) => {
    if (value === null) return undefined;
    const integer = toInteger(value);
    if (integer <= 0n) throw Error('Log scales require positive observations');
    const ratio = high === low ? 0.5 : (logarithmicPosition(integer) - low) / (high - low);
    return scale(10 ** ratio);
  };
}

function linearScale(
  minimum: bigint,
  maximum: bigint,
  toInteger: (value: Scalar) => bigint,
  range: readonly [number, number],
): PlotScale['at'] {
  const span = maximum - minimum;
  const scale = scaleLinear()
    .domain([0, 1])
    .range([...range]);
  return (value) => {
    if (value === null) return undefined;
    const integer = toInteger(value);
    const ratio = span === 0n ? 0.5 : Number(((integer - minimum) * 1_000_000_000_000n) / span) / 1_000_000_000_000;
    return scale(ratio);
  };
}

function tickValues(values: readonly Scalar[]): Scalar[] {
  return values.filter(
    (_, index) =>
      values.length <= 6 || index === 0 || index === values.length - 1 || index % Math.ceil(values.length / 5) === 0,
  );
}

const NICE_MULTIPLIERS = [1n, 2n, 5n, 10n] as const;
const MAX_NICE_TICKS = 7n;

function niceStep(span: bigint): bigint {
  let power = 1n;
  while (power * 10n <= span / 5n) power *= 10n;
  return (
    NICE_MULTIPLIERS.map((multiplier) => multiplier * power).find((step) => span / step < MAX_NICE_TICKS) ?? power * 10n
  );
}

function ceilToStep(value: bigint, step: bigint): bigint {
  const remainder = ((value % step) + step) % step;
  return remainder === 0n ? value : value + step - remainder;
}

function integerLabel(value: bigint, decimalPlaces: number): string {
  if (decimalPlaces === 0) return value.toString();
  const digits = (value < 0n ? -value : value).toString().padStart(decimalPlaces + 1, '0');
  const whole = digits.slice(0, -decimalPlaces);
  const fraction = digits.slice(-decimalPlaces).replace(/0+$/u, '');
  return `${value < 0n ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Round 1-2-5 steps inside the exact domain, so a zero baseline is labeled and marks keep their positions. */
function niceTickValues(values: readonly Scalar[], type: SemanticType, includeZero: boolean): Scalar[] | undefined {
  const exact = values.map((value) => decimalExact(value));
  if (includeZero) exact.push({ coefficient: 0n, scale: 0 });
  const decimalPlaces = Math.max(0, ...exact.map((value) => value.scale));
  const [minimum, maximum] = integerExtent(
    exact.map((value) => value.coefficient * 10n ** BigInt(decimalPlaces - value.scale)),
  );
  if (maximum === minimum) return undefined;
  const step = niceStep(maximum - minimum);
  const ticks: Scalar[] = [];
  for (let value = ceilToStep(minimum, step); value <= maximum; value += step) {
    const label = integerLabel(value, decimalPlaces);
    ticks.push(type.value === 'decimal' ? { decimal: label } : Number(label));
  }
  return ticks.length >= 2 ? ticks : undefined;
}

function axisTicks(values: readonly Scalar[], encoding: PlotEncoding, type: SemanticType): Scalar[] {
  const numeric = ['integer', 'float', 'decimal'].includes(type.value);
  const nice =
    numeric && encoding.scale === 'linear' ? niceTickValues(values, type, encoding.zero === true) : undefined;
  return nice ?? tickValues(values as Scalar[]);
}

/** Offset exact values before floating geometry conversion, preserving small differences on large baselines. */
export function makePlotScale(
  encoding: PlotEncoding,
  type: SemanticType,
  input: readonly Scalar[],
  range: readonly [number, number],
): PlotScale {
  return buildScale(encoding, type, input, range, (values) => tickValues(values as Scalar[]));
}

/** A positional x/y scale whose linear numeric ticks use rounded 1-2-5 steps instead of data values. */
export function makeAxisScale(
  encoding: PlotEncoding,
  type: SemanticType,
  input: readonly Scalar[],
  range: readonly [number, number],
): PlotScale {
  return buildScale(encoding, type, input, range, (values) => axisTicks(values, encoding, type));
}

function buildScale(
  encoding: PlotEncoding,
  type: SemanticType,
  input: readonly Scalar[],
  range: readonly [number, number],
  pickTicks: (values: readonly Scalar[]) => Scalar[],
): PlotScale {
  const values = collectValues(input, type);
  const at =
    encoding.scale === 'ordinal' ? ordinalScale(values, type, range) : numericScale(values, encoding, type, range);
  const ticks = pickTicks(values).map((value) => ({
    position: at(value)!,
    value,
    label: exactLabel(value),
  }));
  return { at, ticks };
}
