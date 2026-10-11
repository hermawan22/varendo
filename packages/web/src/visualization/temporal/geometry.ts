import { bindVisualizationSpec } from '@varendo/core/visualization';
import { compareScalars } from '@varendo/core';
import type { Outcome, Result, Scalar, SemanticType, VisualizationSpec } from '@varendo/core';
import { materializeVisualizationRows } from '../materialization.js';
import type { VisualizationInputs, VisualizationRow } from '../types.js';
import { makePlotScale, type PlotTick } from '../../plot/scales.js';

export interface TimelineMark {
  readonly identity: string;
  readonly x: number;
  readonly end: number;
  readonly lane: number;
}

export interface CalendarDay {
  readonly date: string;
  readonly weekday: number;
  readonly rows: readonly VisualizationRow[];
}

export interface TemporalGeometry {
  readonly view: 'matrix' | 'timeline' | 'calendar-grid';
  readonly result: Result;
  readonly rows: readonly VisualizationRow[];
  readonly columns: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly state: 'ready' | 'data-only';
  readonly reason?: string;
  readonly timeline?: readonly TimelineMark[];
  readonly ticks?: readonly PlotTick[];
  readonly days?: readonly CalendarDay[];
  readonly weekStartsOn?: number;
}

type TemporalSpec = Extract<VisualizationSpec, { readonly view: 'matrix' | 'timeline' | 'calendar-grid' }>;
type TimelineSpec = Extract<VisualizationSpec, { readonly view: 'timeline' }>;
type CalendarSpec = Extract<VisualizationSpec, { readonly view: 'calendar-grid' }>;

interface TimelineInterval {
  readonly row: VisualizationRow;
  readonly start: Scalar;
  readonly end: Scalar;
}

type LaneResult = { readonly kind: 'lane'; readonly index: number } | { readonly kind: 'work-budget' };

interface TimelineLayout {
  readonly state: 'ready' | 'data-only';
  readonly reason?: string;
  readonly marks?: readonly TimelineMark[];
  readonly ticks?: readonly PlotTick[];
}

const fail = (message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: 'visualization.temporal', message, retryable: false }],
});

/** The calendar draws Gregorian civil days. Other declared calendars retain exact data. */
function civilDay(value: Scalar, type: SemanticType, formatter: Intl.DateTimeFormat | undefined): string | undefined {
  if (value === null) return undefined;
  if (type.value === 'date') return String(value);
  const parts = formatter!.formatToParts(new Date(String(value)));
  const part = (name: string) => parts.find((candidate) => candidate.type === name)?.value;
  if (part('era') !== 'AD') throw Error('The calendar date is outside the supported civil range.');
  return `${part('year')!.padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function validDimensions(input: VisualizationInputs): boolean {
  return (
    Number.isFinite(input.width) &&
    Number.isFinite(input.height) &&
    input.width >= 160 &&
    input.height >= 120 &&
    input.width * input.height <= 4_000_000 &&
    Number.isInteger(input.maxMarks) &&
    input.maxMarks >= 1 &&
    input.maxMarks <= 50_000
  );
}

function columnsFor(spec: TemporalSpec, result: Result): readonly string[] {
  if (spec.view === 'matrix') return spec.columns;
  return result.fields.map((field) => field.id);
}

function baseGeometry(
  spec: TemporalSpec,
  result: Result,
  rows: readonly VisualizationRow[],
  input: VisualizationInputs,
): TemporalGeometry {
  return {
    view: spec.view,
    result,
    rows,
    columns: columnsFor(spec, result),
    width: input.width,
    height: input.height,
    state: 'ready',
  };
}

function dataOnly(base: TemporalGeometry, reason: string): Outcome<TemporalGeometry> {
  return { ok: true, value: { ...base, state: 'data-only', reason } };
}

const CIVIL_CALENDARS: ReadonlySet<string> = new Set(['gregory', 'gregorian', 'iso8601']);
const TEMPORAL_VIEWS: ReadonlySet<string> = new Set(['matrix', 'timeline', 'calendar-grid']);

function isTemporalSpec(spec: VisualizationSpec): spec is TemporalSpec {
  return TEMPORAL_VIEWS.has(spec.view);
}

function supportsCivilCalendar(field: Result['fields'][number]): boolean {
  return CIVIL_CALENDARS.has(field.type.temporal!.calendar);
}

function fieldForSpec(spec: TimelineSpec | CalendarSpec, result: Result): Result['fields'][number] {
  const fieldId = spec.view === 'timeline' ? spec.start : spec.date;
  return result.fields.find((field) => field.id === fieldId)!;
}

function compileTemporalView(
  spec: TemporalSpec,
  input: VisualizationInputs,
  result: Result,
  rows: readonly VisualizationRow[],
): Outcome<TemporalGeometry> {
  const base = baseGeometry(spec, result, rows, input);
  if (spec.view === 'matrix') return { ok: true, value: base };
  const field = fieldForSpec(spec, result);
  if (!supportsCivilCalendar(field))
    return dataOnly(base, 'This calendar is not supported visually; the declared dates remain in the data table.');
  if (spec.view === 'timeline') return compileTimeline(input, base, field, spec);
  return compileCalendar(input, base, field, spec);
}

function timelineIntervals(
  rows: readonly VisualizationRow[],
  spec: TimelineSpec,
  field: Result['fields'][number],
): Outcome<readonly TimelineInterval[]> {
  const intervals: TimelineInterval[] = [];
  for (const row of rows) {
    const start = row.values[spec.start]!;
    const end = spec.end === undefined ? start : row.values[spec.end]!;
    if (start === null || end === null) continue;
    const ordered = compareScalars(start, end, field.type);
    if (!ordered.ok) return ordered;
    if (ordered.value === null || ordered.value > 0)
      return fail('Timeline interval ends must not precede their starts.');
    intervals.push({ row, start, end });
  }
  return { ok: true, value: intervals };
}

function compareTimelineValues(left: Scalar, right: Scalar, field: Result['fields'][number]): number {
  const comparison = compareScalars(left, right, field.type);
  if (!comparison.ok || comparison.value === null) throw Error('Unordered timeline');
  return comparison.value;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortTimelineIntervals(intervals: TimelineInterval[], field: Result['fields'][number]): void {
  intervals.sort(
    (left, right) =>
      compareTimelineValues(left.start, right.start, field) ||
      compareTimelineValues(left.end, right.end, field) ||
      compareText(left.row.identity, right.row.identity),
  );
}

function timelineLane(
  ends: readonly Scalar[],
  start: Scalar,
  field: Result['fields'][number],
  work: { count: number },
): LaneResult {
  for (let index = 0; index < ends.length; index += 1) {
    work.count += 1;
    if (work.count > 100_000) return { kind: 'work-budget' };
    if (compareTimelineValues(ends[index]!, start, field) < 0) return { kind: 'lane', index };
  }
  return { kind: 'lane', index: ends.length };
}

function layoutTimeline(
  intervals: readonly TimelineInterval[],
  input: VisualizationInputs,
  field: Result['fields'][number],
): TimelineLayout {
  const scale = makePlotScale(
    { field: field.id, scale: 'temporal' },
    field.type,
    intervals.flatMap((interval) => [interval.start, interval.end]),
    [24, input.width - 24],
  );
  const ends: Scalar[] = [];
  const marks: TimelineMark[] = [];
  const work = { count: 0 };
  for (const interval of intervals) {
    const lane = timelineLane(ends, interval.start, field, work);
    if (lane.kind === 'work-budget')
      return {
        state: 'data-only',
        reason: 'Timeline lane calculation exceeds the work budget; all intervals remain in the data table.',
      };
    if ((lane.index + 1) * 28 > input.height - 40)
      return {
        state: 'data-only',
        reason: 'Overlapping intervals exceed the visible lane budget; all intervals remain in the data table.',
      };
    ends[lane.index] = interval.end;
    marks.push({
      identity: interval.row.identity,
      x: scale.at(interval.start)!,
      end: scale.at(interval.end)!,
      lane: lane.index,
    });
  }
  return { state: 'ready', marks: Object.freeze(marks), ticks: scale.ticks };
}

function compileTimeline(
  input: VisualizationInputs,
  base: TemporalGeometry,
  field: Result['fields'][number],
  spec: TimelineSpec,
): Outcome<TemporalGeometry> {
  const intervals = timelineIntervals(base.rows, spec, field);
  if (!intervals.ok) return intervals;
  if (intervals.value.length > Math.min(input.maxMarks, 1000))
    return dataOnly(base, 'Timeline mark budget exceeded; all loaded intervals remain in the data table.');
  try {
    const ordered = [...intervals.value];
    sortTimelineIntervals(ordered, field);
    const layout = layoutTimeline(ordered, input, field);
    if (layout.state === 'data-only') return dataOnly(base, layout.reason ?? 'Timeline geometry is unavailable.');
    if (layout.marks === undefined) return dataOnly(base, 'Timeline geometry is unavailable.');
    return {
      ok: true,
      value: {
        ...base,
        timeline: layout.marks,
        ...(layout.ticks === undefined ? {} : { ticks: layout.ticks }),
      },
    };
  } catch {
    return dataOnly(
      base,
      'These temporal values cannot be represented safely as geometry; exact values remain in the data table.',
    );
  }
}

function calendarFormatter(field: Result['fields'][number]): Intl.DateTimeFormat | undefined {
  if (field.type.value !== 'instant') return undefined;
  return new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    timeZone: field.type.temporal!.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  });
}

function rowsByDay(
  rows: readonly VisualizationRow[],
  spec: CalendarSpec,
  field: Result['fields'][number],
  formatter: Intl.DateTimeFormat | undefined,
): Map<string, VisualizationRow[]> {
  const grouped = new Map<string, VisualizationRow[]>();
  for (const row of rows) {
    const day = civilDay(row.values[spec.date]!, field.type, formatter);
    if (day === undefined) continue;
    const group = grouped.get(day) ?? [];
    group.push(row);
    grouped.set(day, group);
  }
  return grouped;
}

function calendarDays(
  grouped: ReadonlyMap<string, readonly VisualizationRow[]>,
  maxMarks: number,
  weekStartsOn: number,
):
  | { readonly kind: 'days'; readonly days: readonly CalendarDay[]; readonly weekStartsOn: number }
  | { readonly kind: 'span-budget' } {
  const dates = [...grouped.keys()].sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return { kind: 'days', days: [], weekStartsOn };
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  const count = Math.round((end - start) / 86_400_000) + 1;
  if (!Number.isFinite(count) || count < 1 || count > Math.min(maxMarks, 366)) return { kind: 'span-budget' };
  return { kind: 'days', days: daysInRange(start, count, grouped), weekStartsOn };
}

function daysInRange(
  start: number,
  count: number,
  grouped: ReadonlyMap<string, readonly VisualizationRow[]>,
): readonly CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(start + offset * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    days.push({ date: key, weekday: date.getUTCDay(), rows: grouped.get(key) ?? [] });
  }
  return days;
}

function compileCalendar(
  input: VisualizationInputs,
  base: TemporalGeometry,
  field: Result['fields'][number],
  spec: CalendarSpec,
): Outcome<TemporalGeometry> {
  try {
    const grouped = rowsByDay(base.rows, spec, field, calendarFormatter(field));
    const result = calendarDays(grouped, input.maxMarks, spec.weekStartsOn ?? 1);
    if (result.kind === 'span-budget')
      return dataOnly(base, 'Calendar span exceeds the day budget; all loaded dates remain in the data table.');
    return { ok: true, value: { ...base, days: result.days, weekStartsOn: result.weekStartsOn } };
  } catch {
    return dataOnly(
      base,
      'The declared timezone or date is not supported visually; exact dates remain in the data table.',
    );
  }
}

export function compileTemporalVisualization(input: VisualizationInputs): Outcome<TemporalGeometry> {
  const bound = bindVisualizationSpec(input.visualization, input.context);
  if (!bound.ok) return bound;
  const spec = bound.value.spec;
  if (!isTemporalSpec(spec)) return fail('This renderer requires a matrix, timeline or calendar specification.');
  const materialized = materializeVisualizationRows(bound.value, spec.result, input.datasets);
  if (!materialized.ok) return materialized;
  if (!validDimensions(input)) return fail('Visualization dimensions or mark budget are outside supported limits.');
  return compileTemporalView(spec, input, bound.value.results[0]!, materialized.value);
}
