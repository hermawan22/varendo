import { scalarIdentity } from '@varendo/core';
import type { VarendoChartPoint, VarendoChartSeries } from '../types.js';

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 180;
export const PLOT_LEFT = 56;
export const PLOT_RIGHT = 16;
export const PLOT_TOP = 18;
export const PLOT_HEIGHT = 132;

function plotWidth(width: number): number {
  return Math.max(1, width - PLOT_LEFT - PLOT_RIGHT);
}

export interface VarendoChartGeometry {
  readonly segments: readonly { readonly seriesIndex: number; readonly points: string }[];
  readonly circles: readonly { readonly seriesIndex: number; readonly x: number; readonly y: number }[];
}

interface VarendoChartDomainPoint {
  readonly key: string;
  readonly x?: string | number;
  readonly label: string;
}

function hasExplicitX(series: readonly VarendoChartSeries[]): boolean {
  return series.some((item) => item.points.some((point) => point.x !== undefined));
}

function temporalX(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pointBaseKey(point: VarendoChartPoint, index: number, explicitX: boolean): string {
  if (!explicitX || point.x === undefined) return `index:${index}`;
  if (typeof point.x === 'number') return `number:${point.x}`;
  // Date.parse only retains milliseconds; use the core instant identity so
  // sub-millisecond rows cannot collide and equivalent offsets align.
  const instant = scalarIdentity(point.x, { value: 'instant', nullable: false });
  if (instant.ok) return `instant:${instant.value}`;
  const date = scalarIdentity(point.x, { value: 'date', nullable: false });
  return date.ok ? `date:${date.value}` : `string:${point.x}`;
}

function instantParts(value: string): { readonly milliseconds: number; readonly fraction: string } | undefined {
  const identity = scalarIdentity(value, { value: 'instant', nullable: false });
  if (!identity.ok) return undefined;
  try {
    const parsed: unknown = JSON.parse(identity.value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed[0] !== 'instant' ||
      !Array.isArray(parsed[1]) ||
      parsed[1].length !== 2 ||
      typeof parsed[1][0] !== 'number' ||
      typeof parsed[1][1] !== 'string'
    )
      return undefined;
    return { milliseconds: parsed[1][0], fraction: parsed[1][1] };
  } catch {
    return undefined;
  }
}

function dateIdentity(value: string): string | undefined {
  const identity = scalarIdentity(value, { value: 'date', nullable: false });
  return identity.ok ? identity.value : undefined;
}

function occurrenceKey(baseKey: string, occurrence: number): string {
  return `${baseKey}#${occurrence}`;
}

function compareDate(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Return one bounded, ordered x domain shared by every rendered series. */
export function buildVarendoChartDomain(series: readonly VarendoChartSeries[]): readonly VarendoChartDomainPoint[] {
  const explicitX = hasExplicitX(series);
  if (!explicitX) {
    const length = Math.max(0, ...series.map((item) => item.points.length));
    return Array.from({ length }, (_, index) => ({
      key: `index:${index}`,
      label: series.find((item) => item.points[index] !== undefined)?.points[index]?.label ?? `Point ${index + 1}`,
    }));
  }

  const domain: VarendoChartDomainPoint[] = [];
  const seen = new Set<string>();
  series.forEach((item) => {
    const occurrences = new Map<string, number>();
    item.points.forEach((point, index) => {
      const baseKey = pointBaseKey(point, index, explicitX);
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      const key = explicitX ? occurrenceKey(baseKey, occurrence) : baseKey;
      if (seen.has(key)) return;
      seen.add(key);
      domain.push({ key, ...(point.x === undefined ? {} : { x: point.x }), label: point.label });
    });
  });
  const output = domain;
  const numeric = output.length > 0 && output.every((entry) => typeof entry.x === 'number' && Number.isFinite(entry.x));
  const temporal =
    output.length > 0 && output.every((entry) => typeof entry.x === 'string' && instantParts(entry.x) !== undefined);
  const dates =
    output.length > 0 && output.every((entry) => typeof entry.x === 'string' && dateIdentity(entry.x) !== undefined);
  if (numeric) output.sort((left, right) => (left.x as number) - (right.x as number));
  else if (temporal) output.sort((left, right) => compareTemporal(left.x as string, right.x as string));
  else if (dates) output.sort((left, right) => compareDate(left.x as string, right.x as string));
  return output;
}

function compareTemporal(left: string, right: string): number {
  const a = instantParts(left);
  const b = instantParts(right);
  if (a !== undefined && b !== undefined) {
    if (a.milliseconds !== b.milliseconds) return a.milliseconds < b.milliseconds ? -1 : 1;
    const length = Math.max(a.fraction.length, b.fraction.length);
    const af = a.fraction.padEnd(length, '0');
    const bf = b.fraction.padEnd(length, '0');
    return compareDate(af, bf);
  }
  const aTime = temporalX(left);
  const bTime = temporalX(right);
  return aTime === undefined || bTime === undefined ? 0 : aTime - bTime;
}

/** Insert null points for dates absent from an individual grouped series. */
export function alignVarendoChartSeries(series: readonly VarendoChartSeries[]): readonly VarendoChartSeries[] {
  const explicitX = hasExplicitX(series);
  const domain = buildVarendoChartDomain(series);
  return series.map((item) => {
    const byKey = new Map<string, VarendoChartPoint>();
    const occurrences = new Map<string, number>();
    item.points.forEach((point, index) => {
      const baseKey = pointBaseKey(point, index, explicitX);
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      byKey.set(explicitX ? occurrenceKey(baseKey, occurrence) : baseKey, point);
    });
    const points = domain.map((entry) => {
      const point = byKey.get(entry.key);
      if (point !== undefined)
        return {
          ...point,
          label: entry.label,
          ...(entry.x === undefined ? {} : { x: entry.x }),
        };
      return {
        label: entry.label,
        value: null,
        ...(entry.x === undefined ? {} : { x: entry.x }),
      };
    });
    return { ...item, points };
  });
}

function numericCoordinates(domain: readonly VarendoChartDomainPoint[]): number[] | undefined {
  const values = domain.map((entry) => (typeof entry.x === 'number' && Number.isFinite(entry.x) ? entry.x : undefined));
  return values.every((value) => value !== undefined) ? (values as number[]) : undefined;
}

function instantCoordinates(domain: readonly VarendoChartDomainPoint[]): number[] | undefined {
  const instants = domain.map((entry) => (typeof entry.x === 'string' ? instantParts(entry.x) : undefined));
  if (instants.some((value) => value === undefined)) return undefined;
  const values = instants as NonNullable<(typeof instants)[number]>[];
  const base = values[0]?.milliseconds;
  if (base === undefined) return undefined;
  const coordinates = values.map(
    (value) => value.milliseconds - base + (value.fraction.length > 0 ? Number(`0.${value.fraction}`) * 1000 : 0),
  );
  return coordinates.every(Number.isFinite) ? coordinates : undefined;
}

function dateCoordinates(domain: readonly VarendoChartDomainPoint[]): number[] | undefined {
  const values = domain.map((entry) => {
    if (typeof entry.x !== 'string' || dateIdentity(entry.x) === undefined) return undefined;
    return temporalX(entry.x);
  });
  return values.every((value) => value !== undefined) ? (values as number[]) : undefined;
}

function coordinateValues(domain: readonly VarendoChartDomainPoint[]): number[] | undefined {
  return numericCoordinates(domain) ?? instantCoordinates(domain) ?? dateCoordinates(domain);
}

function centeredCoordinates(length: number, width: number): readonly number[] {
  const step = length === 1 ? 0 : plotWidth(width) / (length - 1);
  return Array.from({ length }, (_, index) => PLOT_LEFT + step * index);
}

function scaledCoordinates(values: readonly number[], width: number): readonly number[] {
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  const scaledMin = min / scale;
  const span = max / scale - scaledMin;
  if (span === 0) {
    const center = PLOT_LEFT + plotWidth(width) / 2;
    return values.map(() => center);
  }
  return values.map((value) => PLOT_LEFT + ((value / scale - scaledMin) / span) * plotWidth(width));
}

function xCoordinates(domain: readonly VarendoChartDomainPoint[], width: number): readonly number[] {
  if (domain.length === 0) return [];
  const values = coordinateValues(domain);
  if (values === undefined) return centeredCoordinates(domain.length, width);
  return scaledCoordinates(values, width);
}

interface ChartXAxisTick {
  readonly position: number;
  readonly label: string;
  readonly anchor: 'start' | 'middle' | 'end';
}

interface ChartYAxisTick {
  readonly position: number;
  readonly label: string;
}

function visibleTickIndexes(length: number): number[] {
  if (length <= 3) return Array.from({ length }, (_, index) => index);
  return [0, Math.floor((length - 1) / 2), length - 1];
}

function chartTickLabel(label: string): string {
  return label.length <= 10 ? label : `${label.slice(0, 8)}…`;
}

export function xAxisTicks(series: readonly VarendoChartSeries[], width: number): ChartXAxisTick[] {
  const domain = buildVarendoChartDomain(series);
  const positions = xCoordinates(domain, width);
  return visibleTickIndexes(domain.length).flatMap((index) => {
    const point = domain[index];
    const position = positions[index];
    if (point === undefined || position === undefined) return [];
    let anchor: ChartXAxisTick['anchor'] = 'middle';
    if (index === 0) anchor = 'start';
    else if (index === domain.length - 1) anchor = 'end';
    return [{ position, label: chartTickLabel(point.label), anchor }];
  });
}

function numericExtent(series: readonly VarendoChartSeries[]): readonly [number, number] | undefined {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const point of item.points) {
      if (point.value === null || !Number.isFinite(point.value)) continue;
      minimum = Math.min(minimum, point.value);
      maximum = Math.max(maximum, point.value);
    }
  }
  return Number.isFinite(minimum) ? [minimum, maximum] : undefined;
}

/** Whole-number data never gets a fractional midpoint label such as 1.5. */
function yTickValues(minimum: number, maximum: number): number[] {
  if (minimum === maximum) return [minimum];
  const middle = minimum / 2 + maximum / 2;
  if (Number.isInteger(minimum) && Number.isInteger(maximum) && !Number.isInteger(middle)) return [minimum, maximum];
  return [minimum, middle, maximum];
}

export function yAxisTicks(series: readonly VarendoChartSeries[]): ChartYAxisTick[] {
  const extent = numericExtent(series);
  if (extent === undefined) return [];
  const [minimum, maximum] = extent;
  const values = yTickValues(minimum, maximum);
  const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  const scaledMinimum = minimum / scale;
  const span = maximum / scale - scaledMinimum;
  const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4, notation: 'compact' });
  return values.map((value) => {
    const fraction = span === 0 ? 0 : (value / scale - scaledMinimum) / span;
    return {
      position: PLOT_TOP + PLOT_HEIGHT - fraction * PLOT_HEIGHT,
      label: format.format(value),
    };
  });
}

/** Pure bounded geometry used by the SVG renderer and its verification tests. */
export function buildVarendoChartGeometry(
  series: readonly VarendoChartSeries[],
  width = CHART_WIDTH,
): VarendoChartGeometry {
  const aligned = alignVarendoChartSeries(series);
  const finite: number[] = [];
  for (const item of aligned) {
    for (const point of item.points) {
      if (point.value !== null && Number.isFinite(point.value)) finite.push(point.value);
    }
  }
  if (finite.length === 0) return { segments: [], circles: [] };
  let min = finite[0]!;
  let max = finite[0]!;
  for (const value of finite) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  // Scale before subtracting so finite extreme values cannot overflow to
  // Infinity and poison the SVG coordinates.
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  const scaledMin = min / scale;
  const span = max / scale - scaledMin || 1;
  const circles: { seriesIndex: number; x: number; y: number }[] = [];
  const segments: { seriesIndex: number; points: string }[] = [];
  const domain = buildVarendoChartDomain(series);
  const x = xCoordinates(domain, width);
  aligned.forEach((item, seriesIndex) => {
    let current: string[] = [];
    const flush = (): void => {
      if (current.length > 0) segments.push({ seriesIndex, points: current.join(' ') });
      current = [];
    };
    item.points.forEach((point, index) => {
      if (point.value === null || !Number.isFinite(point.value)) {
        flush();
        return;
      }
      const xCoordinate = x[index] ?? PLOT_LEFT;
      const y = PLOT_TOP + PLOT_HEIGHT - ((point.value / scale - scaledMin) / span) * PLOT_HEIGHT;
      current.push(`${xCoordinate},${y}`);
      circles.push({ seriesIndex, x: xCoordinate, y });
    });
    flush();
  });
  return { segments, circles };
}
