import { scalarIdentity } from '@varendo/core';
import type { PlotScale } from '../scales.js';
import type { GeometryCheck, PlotDatum, PlotSource } from './types.js';
import type { PlotSeries } from './series.js';

export interface BarPosition {
  readonly center: number;
  readonly width: number;
}

interface BarEntry {
  readonly group: string;
  readonly datum: PlotDatum;
}

function addBarEntry(
  entriesByX: Map<string, BarEntry[]>,
  group: string,
  datum: PlotDatum,
  source: PlotSource,
): GeometryCheck<void> {
  const field = source.unit.encoding.x.field;
  const identity = scalarIdentity(datum.values[field]!, source.fields.get(field)!.type);
  if (!identity.ok) return { kind: 'error', outcome: { ok: false, diagnostics: identity.diagnostics } };
  const entries = entriesByX.get(identity.value) ?? [];
  if (entries.some((entry) => entry.group === group))
    return { kind: 'data-only', reason: 'Bar rows must contain one value per x and series grain.' };
  entries.push({ group, datum });
  entriesByX.set(identity.value, entries);
  return { kind: 'ready', value: undefined };
}

function groupBars(source: PlotSource, series: PlotSeries): GeometryCheck<Map<string, BarEntry[]>> {
  const entriesByX = new Map<string, BarEntry[]>();
  for (const [group, data] of series.groups) {
    for (const datum of data) {
      const result = addBarEntry(entriesByX, group, datum, source);
      if (result.kind !== 'ready') return result;
    }
  }
  return { kind: 'ready', value: entriesByX };
}

function minimumStep(positions: readonly number[]): number {
  const sorted = [...positions].sort((left, right) => left - right);
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) step = Math.min(step, sorted[index]! - sorted[index - 1]!);
  return Number.isFinite(step) && step > 0 ? step : 0;
}

function categoryStep(entries: readonly (readonly BarEntry[])[], x: PlotScale, field: string): number {
  const positions = entries.map((group) => x.at(group[0]!.datum.values[field]!));
  return minimumStep(positions.filter((value): value is number => value !== undefined));
}

function barCapacity(groupCount: number, step: number, plotWidth: number, rowCount: number): number {
  if (groupCount > 1) return step * 0.8;
  return Math.min(28, (plotWidth / Math.max(1, rowCount)) * 0.7);
}

function saveBarPositions(
  entries: readonly BarEntry[],
  categoryCount: number,
  source: PlotSource,
  x: PlotScale,
  step: number,
  positions: Map<string, BarPosition>,
): string | undefined {
  const axisLeft = source.options.family === 'heatmap' ? 216 : 64;
  const capacity = barCapacity(categoryCount, step, source.options.width - 24 - axisLeft, source.displayed.length);
  const barWidth = Math.min(28, capacity / entries.length);
  if (!Number.isFinite(barWidth) || barWidth < 1)
    return 'Bar groups are too dense for distinct marks at this width; exact data is available below.';
  const first = entries[0]!.datum;
  const center = x.at(first.values[source.unit.encoding.x.field]!);
  if (center === undefined) return 'A bar category has no display position.';
  const start = center - (barWidth * entries.length) / 2 + barWidth / 2;
  for (const [index, entry] of entries.entries())
    positions.set(entry.datum.identity, { center: start + index * barWidth, width: barWidth });
  return undefined;
}

export function createBarLayout(
  source: PlotSource,
  series: PlotSeries,
  x: PlotScale,
): GeometryCheck<ReadonlyMap<string, BarPosition>> {
  if (source.unit.mark !== 'bar') return { kind: 'ready', value: new Map() };
  const grouped = groupBars(source, series);
  if (grouped.kind !== 'ready') return grouped;
  const groups = grouped.value;
  const field = source.unit.encoding.x.field;
  const step = categoryStep([...groups.values()], x, field);
  if (groups.size > 1 && step < 1)
    return {
      kind: 'data-only',
      reason: 'Bar categories are too dense for distinct marks at this width; exact data is available below.',
    };
  const positions = new Map<string, BarPosition>();
  for (const entries of groups.values()) {
    const reason = saveBarPositions(entries, groups.size, source, x, step, positions);
    if (reason !== undefined) return { kind: 'data-only', reason };
  }
  return { kind: 'ready', value: positions };
}
