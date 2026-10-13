import { html, nothing, svg } from 'lit';
import { resultCaption } from '../scope-caption.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Result, ResultRef, Scalar } from '@varendo/core';
import { exactLabel } from '../../plot/scales.js';
import { seriesColor, svgPlotMarks } from '../../plot/render.js';
import type { CompiledPlotNode } from '../../plot/composition.js';
import type { PlotGeometry } from '../../plot/geometry.js';
import type { CartesianRenderContext } from './types.js';

const PAGE_SIZE = 25;

function resultKey(ref: ResultRef): string {
  return JSON.stringify([
    ref.id,
    ref.revision,
    ref.sourceLineage ?? null,
    ref.outputId,
    ref.queryDigest,
    ref.scopeDigest,
  ]);
}

function diagnosticMessage(diagnostics: readonly { readonly message: string }[]): string {
  return diagnostics[0]?.message ?? 'The visualization is unavailable.';
}

function histogramScopeText(result: Result): string {
  switch (result.coverage.kind) {
    case 'complete':
      return 'Complete bin delivery';
    case 'partial':
      return 'Partial bin delivery: ' + result.coverage.reason;
    case 'sample':
      return 'Sampled bin delivery: ' + result.coverage.method;
    case 'unknown':
      return 'Bin scope unknown: ' + result.coverage.reason;
  }
}

function scopeText(result: Result, histogram: boolean, count: number): string {
  if (!histogram) return resultCaption(result, count) + '.';
  return (
    histogramScopeText(result) +
    '. Source observation coverage and missing/outside-bin counts are unknown. ' +
    count +
    ' bins.'
  );
}

function uncertaintyText(result: Result): string {
  if (result.precision.kind !== 'approximate') return '';
  const uncertainty = result.precision.uncertainty;
  if (uncertainty.kind === 'quantified') {
    return uncertainty.interpretation + ' (range ' + uncertainty.lower + '–' + uncertainty.upper + ').';
  }
  return uncertainty.reason;
}

function tickText(text: string): string {
  if (text.length <= 12) return text;
  return text.slice(0, 5) + '…' + text.slice(-5);
}

function xTickAnchor(index: number, count: number): 'start' | 'middle' | 'end' {
  if (count === 1 || (index > 0 && index < count - 1)) return 'middle';
  if (index === 0) return 'start';
  return 'end';
}

function identityLabel(row: { readonly values: Readonly<Record<string, Scalar>> }, result: Result): string {
  return result.identity.map((field) => exactLabel(row.values[field]!)).join(', ');
}

function histogramMeasure(context: CartesianRenderContext): string | undefined {
  if (context.expectedView !== 'histogram' || context.state.kind !== 'ready') return undefined;
  if (context.state.bound.spec.view !== 'histogram') return undefined;
  return context.state.bound.spec.bins.measure;
}

function pageData(geometry: PlotGeometry, context: CartesianRenderContext, identities?: readonly string[]) {
  const identitySet = identities === undefined ? undefined : new Set(identities);
  const displayed =
    identitySet === undefined ? geometry.rows : geometry.rows.filter((row) => identitySet.has(row.identity));
  const pageCount = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const page = Math.min(context.page, pageCount - 1);
  return {
    displayed,
    pageCount,
    page,
    rows: displayed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
  };
}

function renderNode(
  node: CompiledPlotNode,
  label: string,
  context: CartesianRenderContext,
  graphic = true,
  data = true,
): unknown {
  switch (node.kind) {
    case 'unit':
      return renderGeometry(node.geometry, label, context, graphic, data, node.displayedIdentities);
    case 'facet':
      return html`<section part="facet" aria-label=${label}>
        ${node.children.map(
          (child) =>
            html`<section aria-label=${node.field + ': ' + child.label}>
              ${data ? html`<h3>${node.field}: ${child.label}</h3>` : nothing}
              ${renderNode(child.node, label + ', ' + node.field + ': ' + child.label, context, graphic, data)}
            </section>`,
        )}
      </section>`;
    case 'concat':
      return html`<section part=${'concat-' + node.direction} aria-label=${label}>
        ${node.children.map((child, index) =>
          renderNode(child, label + ', panel ' + (index + 1), context, graphic, data),
        )}
      </section>`;
    default:
      return html`<section aria-label=${label}>
        ${data ? html`<h3>${label}</h3>` : nothing}
        <div part="layer">
          ${node.children.map(
            (child, index) =>
              html`<div>${renderNode(child, label + ', layer ' + (index + 1), context, true, false)}</div>`,
          )}
        </div>
        ${
          data
            ? node.children.map((child, index) =>
                renderNode(child, label + ', layer ' + (index + 1), context, false, true),
              )
            : nothing
        }
      </section>`;
  }
}

function renderGeometry(
  geometry: PlotGeometry,
  label: string,
  context: CartesianRenderContext,
  graphic: boolean,
  data: boolean,
  identities?: readonly string[],
): unknown {
  const page = pageData(geometry, context, identities);
  const valueLabel = geometry.result.precision.kind === 'exact' ? 'Exact loaded values' : 'Loaded approximate values';
  const measure = histogramMeasure(context);
  const tableLabel = measure === undefined ? valueLabel : valueLabel + '; executor-produced ' + measure + ' bins';
  return html`<figure part="figure">
    ${renderCaption(geometry, label, context, data, page.displayed.length)}
    ${renderResultNotes(geometry, data, valueLabel)} ${renderHistogramNote(measure, data)}
    ${renderGeometryError(geometry)} ${renderChart(geometry, label, context, graphic)}
    ${
      data
        ? html`${renderLegend(geometry)}${renderColorKey(geometry)}
            <details part="data-details">
              <summary>View data table</summary>
              ${renderDataTable(geometry, label, tableLabel, context, page.rows)}
              ${renderPagination(page, label, context)}
            </details>`
        : nothing
    }
  </figure>`;
}

function renderCaption(
  geometry: PlotGeometry,
  label: string,
  context: CartesianRenderContext,
  data: boolean,
  displayedCount: number,
): unknown {
  if (!data) return nothing;
  const partition = displayedCount === geometry.rows.length ? nothing : ' ' + displayedCount + ' rows in this view.';
  return html`<figcaption>${label}</figcaption>
    <p part="scope">
      ${scopeText(geometry.result, context.expectedView === 'histogram', geometry.rows.length)}${partition}
    </p>`;
}

function renderResultNotes(geometry: PlotGeometry, data: boolean, valueLabel: string): unknown {
  if (!data) return nothing;
  const period = geometry.result.period
    ? html`<p part="note">${geometry.result.period.interpretation} (${geometry.result.period.timezone}).</p>`
    : nothing;
  const filters =
    geometry.result.filters.length > 0
      ? html`<p part="note">Filtered result (${geometry.result.filters.length} applied conditions).</p>`
      : nothing;
  const approximate =
    geometry.result.precision.kind === 'approximate'
      ? html`<p part="note">${valueLabel}: ${geometry.result.precision.method}. ${uncertaintyText(geometry.result)}</p>`
      : nothing;
  const warnings = renderWarnings(geometry.result);
  const abbreviated = hasAbbreviatedTicks(geometry);
  return html`${period}${filters}
  ${abbreviated ? html`<p part="note">Axis labels are shortened for display; full values are listed in the data table.</p>` : nothing}
  ${approximate}${warnings}`;
}

function hasAbbreviatedTicks(geometry: PlotGeometry): boolean {
  if (geometry.axes === undefined) return false;
  return [...geometry.axes.x.ticks, ...geometry.axes.y.ticks].some((tick) => tick.label.length > 12);
}

function renderWarnings(result: Result): unknown {
  if (result.warnings.length === 0) return nothing;
  return html`<ul part="warnings" aria-label="Result warnings">
    ${result.warnings.map((warning) => html`<li>${warning.message}</li>`)}
  </ul>`;
}

function renderHistogramNote(measure: string | undefined, data: boolean): unknown {
  if (!data || measure === undefined) return nothing;
  return html`<p part="note">
    Executor-produced ${measure} bins. Bin delivery does not establish source observation coverage.
  </p>`;
}

function renderGeometryError(geometry: PlotGeometry): unknown {
  if (geometry.state !== 'data-only') return nothing;
  return html`<p part="error" role="status">${geometry.reason ?? 'The chart geometry is unavailable.'}</p>`;
}

/** Horizontal guides for a quantitative y axis; categorical axes stay unruled. */
function renderGridlines(ticks: NonNullable<PlotGeometry['axes']>['y']['ticks'], left: number, right: number): unknown {
  if (!ticks.every((tick) => typeof tick.value === 'number' || (typeof tick.value === 'object' && tick.value !== null)))
    return nothing;
  return ticks.map(
    (tick) => svg`<line class="gridline" x1=${left} x2=${right} y1=${tick.position} y2=${tick.position}></line>`,
  );
}

function renderChart(
  geometry: PlotGeometry,
  label: string,
  context: CartesianRenderContext,
  graphic: boolean,
): unknown {
  const axes = geometry.axes;
  if (!graphic || axes === undefined || geometry.state !== 'plot') return nothing;
  const left = geometry.axisLeft ?? 64;
  const xTickStart = geometry.height - 6;
  const xTickRowGap = 44;
  const xTitleBaseline = geometry.height + 86;
  const svgHeight = geometry.height + 110;
  return html`<div
    part="viewport"
    role="region"
    tabindex="0"
    aria-label=${label + ' ' + context.expectedView + ' chart. Scroll to view the full graphic.'}
    style=${'inline-size: ' + context.width + 'px'}
  >
    <svg
      viewBox=${'0 0 ' + geometry.width + ' ' + svgHeight}
      width=${geometry.width}
      height=${svgHeight}
      role="img"
      aria-label=${label + '. ' + scopeText(geometry.result, context.expectedView === 'histogram', geometry.rows.length) + ' Values and selection are available in the data table below.'}
    >
      ${renderGridlines(axes.y.ticks, left, geometry.width - 24)} ${svgPlotMarks(geometry)}
      <path
        d=${'M' + left + ',24V' + (geometry.height - 48) + 'H' + (geometry.width - 24)}
        fill="none"
        stroke="currentColor"
      ></path>
      ${axes.x.ticks.map(
        (tick, index) =>
          svg`<text class=${index % 2 === 0 ? 'axis-x-tick' : 'axis-x-tick axis-x-tick-offset'} x=${tick.position} y=${xTickStart + (index % 2) * xTickRowGap} text-anchor=${xTickAnchor(index, axes.x.ticks.length)}>${tickText(tick.label)}</text>`,
      )}
      ${axes.y.ticks.map(
        (tick) =>
          svg`<text class="axis-y-tick" x=${left - 4} y=${tick.position} text-anchor="end">${tickText(tick.label)}</text>`,
      )}
      <text class="axis-title axis-title-x" x=${geometry.width / 2} y=${xTitleBaseline} text-anchor="middle">
        ${axes.xLabel}
      </text>
      <text class="axis-title" x=${left + 8} y="32">${axes.yLabel}</text>
    </svg>
  </div>`;
}

function renderLegend(geometry: PlotGeometry): unknown {
  if (!geometry.legend.some((entry) => entry.label)) return nothing;
  return html`<ul part="legend" aria-label="Series">
    ${geometry.legend.map(
      (entry) =>
        html`<li>
          <span part="legend-marker" aria-hidden="true" style=${'background:' + seriesColor(geometry, entry.id)}></span
          >${entry.label || entry.id}
        </li>`,
    )}
  </ul>`;
}

function renderColorKey(geometry: PlotGeometry): unknown {
  const field = geometry.result.fields.find((candidate) => candidate.id === geometry.colorField);
  if (field === undefined || geometry.colorTicks === undefined) return nothing;
  return html`<div part="color-key" role="group" aria-label=${field.label + ' color key'}>
    <span>${field.label}</span>
    <div part="color-key-bar" aria-hidden="true"></div>
    <ul part="color-key-ticks">
      ${geometry.colorTicks.map((tick) => html`<li>${tick.label}</li>`)}
    </ul>
  </div>`;
}

function fieldHeader(field: Result['fields'][number]): unknown {
  if (field.type.unit === undefined) return html`<th scope="col">${field.label}</th>`;
  return html`<th scope="col">${field.label} (${field.type.unit.symbol})</th>`;
}

function renderDataTable(
  geometry: PlotGeometry,
  label: string,
  tableLabel: string,
  context: CartesianRenderContext,
  rows: PlotGeometry['rows'],
): unknown {
  return html`<div part="data">
    <table>
      <caption>
        ${label}: ${tableLabel}
      </caption>
      <thead>
        <tr>
          ${context.selectionEnabled ? html`<th scope="col">Select</th>` : nothing}
          ${geometry.result.fields.map((field) => fieldHeader(field))}
        </tr>
      </thead>
      <tbody>
        ${repeat(
          rows,
          (row) => row.identity,
          (row) =>
            html`<tr>
              ${context.selectionEnabled ? renderSelectCell(row, geometry, context) : nothing}
              ${geometry.result.fields.map(
                (field) => html`<td data-label=${field.label}>${exactLabel(row.values[field.id]!)}</td>`,
              )}
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function renderSelectCell(
  row: PlotGeometry['rows'][number],
  geometry: PlotGeometry,
  context: CartesianRenderContext,
): unknown {
  return html`<td data-label="Select">
    <button
      type="button"
      data-varendo-row-identity=${row.identity}
      data-varendo-result=${resultKey(geometry.result.ref)}
      aria-pressed=${context.isSelected(row.identity, geometry.result.ref) ? 'true' : 'false'}
      aria-label=${'Select ' + identityLabel(row, geometry.result)}
      @click=${() => context.select(row.identity, geometry.result.ref)}
    >
      Select
    </button>
  </td>`;
}

function renderPagination(
  pageDataResult: ReturnType<typeof pageData>,
  label: string,
  context: CartesianRenderContext,
): unknown {
  const { displayed, page, pageCount } = pageDataResult;
  if (displayed.length <= PAGE_SIZE) return nothing;
  return html`<nav part="pagination" aria-label=${label + ' data pages'}>
    <button type="button" ?disabled=${page === 0} @click=${() => context.setPage(page - 1)}>Previous</button>
    <span
      >Rows ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, displayed.length)} of ${displayed.length}</span
    >
    <button type="button" ?disabled=${page + 1 >= pageCount} @click=${() => context.setPage(page + 1)}>Next</button>
  </nav>`;
}

export function renderCartesian(context: CartesianRenderContext): unknown {
  if (context.state.kind === 'empty')
    return html`<p role="status">No ${context.expectedView} visualization is available.</p>`;
  if (context.state.kind === 'error')
    return html`<p part="error" role="status">${diagnosticMessage(context.state.diagnostics)}</p>`;
  return renderNode(context.state.compiled.root, context.label, context);
}
