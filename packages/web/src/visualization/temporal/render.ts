import { html, nothing, svg } from 'lit';
import { resultCaption } from '../scope-caption.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Result } from '@varendo/core';
import type { VisualizationSpec } from '@varendo/core/visualization';
import { exactLabel } from '../../plot/scales.js';
import type { VisualizationRow } from '../types.js';
import type { TemporalGeometry, TimelineMark } from './geometry.js';

interface TemporalRenderState {
  readonly geometry: TemporalGeometry;
  readonly visualization: VisualizationSpec;
  readonly view: 'matrix' | 'timeline' | 'calendar-grid';
  readonly label: string;
  readonly page: number;
  readonly selectionEnabled: boolean;
  readonly selectedIdentity: string;
  readonly onSelect: (row: VisualizationRow) => void;
  readonly onPage: (page: number) => void;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function rowLabel(row: VisualizationRow, result: Result): string {
  return result.identity.map((id) => exactLabel(row.values[id]!)).join(', ');
}

function displayLabel(row: VisualizationRow, result: Result, spec: VisualizationSpec): string {
  if (spec.view !== 'matrix' && 'label' in spec && spec.label) return exactLabel(row.values[spec.label]!);
  return rowLabel(row, result);
}

function temporalField(result: Result, spec: VisualizationSpec): Result['fields'][number] | undefined {
  if (spec.view === 'timeline') return result.fields.find((field) => field.id === spec.start);
  if (spec.view === 'calendar-grid') return result.fields.find((field) => field.id === spec.date);
  return undefined;
}

function precisionText(result: Result): string | undefined {
  if (result.precision.kind !== 'approximate') return undefined;
  const uncertainty = result.precision.uncertainty;
  const detail = uncertainty.kind === 'unquantified' ? uncertainty.reason : uncertainty.interpretation;
  return `Approximate values: ${result.precision.method}. ${detail}`;
}

function renderMetadata(geometry: TemporalGeometry, scope: string) {
  const result = geometry.result;
  const precision = precisionText(result);
  return html`
    <p part="scope">${scope}.</p>
    ${result.period ? html`<p>${result.period.interpretation} (${result.period.timezone})</p>` : nothing}
    ${result.filters.length ? html`<p>Filtered result (${result.filters.length} applied conditions).</p>` : nothing}
    ${precision === undefined ? nothing : html`<p>${precision}</p>`}
    ${result.warnings.map((warning) => html`<p>${warning.message}</p>`)}
    ${geometry.state === 'data-only' ? html`<p role="status">${geometry.reason}</p>` : nothing}
  `;
}

function timelineAnchor(index: number, length: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start';
  if (index === length - 1) return 'end';
  return 'middle';
}

function renderTimelineMark(
  mark: TimelineMark,
  index: number,
  marks: readonly TimelineMark[],
  rows: ReadonlyMap<string, VisualizationRow>,
  result: Result,
  spec: VisualizationSpec,
): unknown {
  const row = rows.get(mark.identity)!;
  const label = displayLabel(row, result, spec).slice(0, 40);
  return svg`<line x1=${mark.x} x2=${Math.max(mark.x + 2, mark.end)} y1=${24 + mark.lane * 28} y2=${24 + mark.lane * 28} stroke="currentColor" stroke-width="12"></line><text class="timeline-label" x=${mark.x} y=${16 + mark.lane * 28} text-anchor=${timelineAnchor(index, marks.length)} font-size="11" fill="currentColor">${label}</text>`;
}

function renderTimelineTicks(geometry: TemporalGeometry) {
  const ticks = geometry.ticks?.filter((_, index, list) => index === 0 || index === list.length - 1);
  if (ticks === undefined) return nothing;
  return ticks.map(
    (tick, index) =>
      svg`<text class="timeline-tick" x=${tick.position} y=${geometry.height - 16} text-anchor=${timelineAnchor(index, ticks.length)} font-size="11" fill="currentColor">${tick.label.length > 24 ? `${tick.label.slice(0, 23)}…` : tick.label}</text>`,
  );
}

function renderTimeline(state: TemporalRenderState, field: Result['fields'][number] | undefined, scope: string) {
  const { geometry, label, visualization } = state;
  if (geometry.timeline === undefined) return nothing;
  const rows = new Map(geometry.rows.map((row) => [row.identity, row]));
  const calendar = field?.type.temporal?.calendar;
  const timezone = field?.type.temporal?.timezone ?? 'civil dates';
  return html`<p>
      Intervals use separate lanes when they overlap. ${calendar}; timezone: ${timezone}. Missing endpoints appear only
      in the data table. Visual labels are limited to 40 characters. Exact endpoints, labels and selection are available
      below.
    </p>
    <div part="viewport" tabindex="0" role="region" aria-label=${`${label}: scrollable graphic`}>
      <svg
        width=${geometry.width}
        height=${geometry.height}
        viewBox=${`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label=${`${label}: intervals in chronological order. ${scope}. Exact values below.`}
      >
        ${geometry.timeline.map((mark, index, marks) => renderTimelineMark(mark, index, marks, rows, geometry.result, visualization))}
        ${renderTimelineTicks(geometry)}
      </svg>
    </div>`;
}

function renderCalendarRow(row: VisualizationRow, state: TemporalRenderState): unknown {
  const { geometry, visualization } = state;
  const label = displayLabel(row, geometry.result, visualization);
  if (visualization.view !== 'calendar-grid' || visualization.value === undefined) return html`<span>${label}</span>`;
  return html`<span>${label}: ${exactLabel(row.values[visualization.value]!)}</span>`;
}

function renderCalendarDay(
  day: NonNullable<TemporalGeometry['days']>[number],
  index: number,
  state: TemporalRenderState,
) {
  const { geometry } = state;
  const weekStart = geometry.weekStartsOn!;
  const startColumn = index === 0 ? `grid-column-start:${((day.weekday - weekStart + 7) % 7) + 1}` : '';
  const soleRow = day.rows.length === 1 ? day.rows[0] : undefined;
  return html`<section class="day" style=${startColumn}>
    <strong>${day.date}</strong>
    <span>${day.rows.length} rows</span>
    ${day.rows.slice(0, 3).map((row) => renderCalendarRow(row, state))}
    ${day.rows.length > 3 ? html`<span>${day.rows.length - 3} additional rows in the data table.</span>` : nothing}
    ${soleRow === undefined ? nothing : renderSelectionButton(soleRow, rowLabel(soleRow, geometry.result), state)}
  </section>`;
}

function renderCalendar(state: TemporalRenderState, field: Result['fields'][number] | undefined) {
  const { geometry, label } = state;
  if (geometry.days === undefined) return nothing;
  const timezone = field?.type.temporal?.timezone ?? 'civil dates';
  const weekday = WEEKDAYS[geometry.weekStartsOn!];
  return html`<p>
      Gregorian calendar; timezone: ${timezone}. Weeks start on ${weekday}. Missing dates appear only in the data table.
      Counts below are rows per day.
    </p>
    <div part="viewport" tabindex="0" role="region" aria-label=${`${label}: scrollable graphic`}>
      <div class="days">${geometry.days.map((day, index) => renderCalendarDay(day, index, state))}</div>
    </div>`;
}

function renderSelectionButton(row: VisualizationRow, label: string, state: TemporalRenderState) {
  return html`<button
    type="button"
    ?disabled=${!state.selectionEnabled}
    aria-pressed=${state.selectedIdentity === row.identity ? 'true' : 'false'}
    aria-label=${`Select ${label}`}
    @click=${() => state.onSelect(row)}
  >
    Select
  </button>`;
}

function renderFieldHeader(field: Result['fields'][number]) {
  const unit = field.type.unit ? ` (${field.type.unit.symbol})` : '';
  return html`<th scope="col">${field.label}${unit}</th>`;
}

function renderDataHeader(view: TemporalRenderState['view'], fields: readonly Result['fields'][number][]) {
  if (view === 'matrix')
    return html`${fields.map(renderFieldHeader)}
      <th scope="col">Select</th>`;
  return html`<th scope="col">Select</th>
    ${fields.map(renderFieldHeader)}`;
}

function renderDataRow(row: VisualizationRow, state: TemporalRenderState, fields: readonly Result['fields'][number][]) {
  const values = fields.map((field) => html`<td data-label=${field.label}>${exactLabel(row.values[field.id]!)}</td>`);
  const selection = html`<td data-label="Select">
    ${renderSelectionButton(row, rowLabel(row, state.geometry.result), state)}
  </td>`;
  if (state.view === 'matrix')
    return html`<tr>
      ${values}${selection}
    </tr>`;
  return html`<tr>
    ${selection}${values}
  </tr>`;
}

function renderDataTable(state: TemporalRenderState, fields: readonly Result['fields'][number][]) {
  const { geometry, label, page } = state;
  const precision = geometry.result.precision.kind === 'exact' ? 'exact' : 'approximate';
  return html`<div part="data" tabindex="0" role="region" aria-label=${`${label}: scrollable data`}>
    <table>
      <caption>
        ${label}: ${precision} loaded values
      </caption>
      <thead>
        <tr>
          ${renderDataHeader(state.view, fields)}
        </tr>
      </thead>
      <tbody>
        ${repeat(
          geometry.rows.slice(page * 25, page * 25 + 25),
          (row) => row.identity,
          (row) => renderDataRow(row, state, fields),
        )}
      </tbody>
    </table>
  </div>`;
}

function renderPagination(state: TemporalRenderState) {
  const { geometry, page, onPage } = state;
  if (geometry.rows.length <= 25) return nothing;
  const firstRow = page * 25 + 1;
  const lastRow = Math.min((page + 1) * 25, geometry.rows.length);
  return html`<nav aria-label="Visualization data pages">
    <button type="button" ?disabled=${page === 0} @click=${() => onPage(page - 1)}>Previous</button>
    <span>Rows ${firstRow}–${lastRow} of ${geometry.rows.length}</span>
    <button type="button" ?disabled=${(page + 1) * 25 >= geometry.rows.length} @click=${() => onPage(page + 1)}>
      Next
    </button>
  </nav>`;
}

export function renderTemporalGeometry(state: TemporalRenderState) {
  const { geometry, label, view } = state;
  const result = geometry.result;
  const scope = resultCaption(result, geometry.rows.length);
  const field = temporalField(result, state.visualization);
  const fields = geometry.columns.map((id) => result.fields.find((candidate) => candidate.id === id)!);
  return html`<figure class=${view}>
    <figcaption>${label}</figcaption>
    ${renderMetadata(geometry, scope)} ${renderTimeline(state, field, scope)} ${renderCalendar(state, field)}
    ${view === 'matrix' ? html`<p part="scroll-hint">Scroll the table horizontally to compare every declared column.</p>` : nothing}
    ${renderDataTable(state, fields)} ${renderPagination(state)}
  </figure>`;
}
