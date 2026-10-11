import { aeliqoChartStyles } from './aeliqo-chart-styles.js';
import {
  alignAeliqoChartSeries,
  buildAeliqoChartGeometry,
  CHART_HEIGHT,
  CHART_WIDTH,
  PLOT_HEIGHT,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  xAxisTicks,
  yAxisTicks,
  type AeliqoChartGeometry,
} from './aeliqo-chart-geometry.js';
import { html, LitElement, nothing, svg } from 'lit';
import type { AeliqoChartPoint, AeliqoChartSeries } from '../types.js';
import { AELIQO_WEB_VERSION } from '../version.js';

export { alignAeliqoChartSeries, buildAeliqoChartDomain, buildAeliqoChartGeometry } from './aeliqo-chart-geometry.js';
export type { AeliqoChartGeometry } from './aeliqo-chart-geometry.js';

const chartCopy = {
  en: {
    title: 'Chart',
    scope: 'Scope',
    unit: 'Unit',
    series: 'Series',
    value: 'Value',
    label: 'Label',
    point: 'Point',
    unavailable: 'Chart unavailable: values must be finite.',
    gaps: 'Missing values are shown as gaps.',
    dataTable: 'View data table',
  },
  id: {
    title: 'Grafik',
    scope: 'Cakupan',
    unit: 'Satuan',
    series: 'Seri',
    value: 'Nilai',
    label: 'Label',
    point: 'Titik',
    unavailable: 'Grafik tidak tersedia: nilai harus berupa bilangan hingga.',
    gaps: 'Data yang hilang ditampilkan sebagai celah.',
    dataTable: 'Lihat tabel data',
  },
} as const;

export class AeliqoChartElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
  static readonly properties = {
    title: { type: String },
    summary: { type: String },
    unit: { type: String },
    scope: { type: String },
    lang: { type: String },
    points: { attribute: false },
    series: { attribute: false },
  };

  title = 'Chart';
  summary = '';
  unit = '';
  scope = '';
  points: readonly AeliqoChartPoint[] = [];
  series: readonly AeliqoChartSeries[] = [];
  private chartWidth = CHART_WIDTH;
  private sizeObserver?: ResizeObserver;

  private get copy(): typeof chartCopy.en | typeof chartCopy.id {
    const locale = this.lang || this.closest?.('[lang]')?.getAttribute('lang') || '';
    return /^id(?:-|$)/i.test(locale) ? chartCopy.id : chartCopy.en;
  }

  private get displayTitle(): string {
    return this.title === 'Chart' ? this.copy.title : this.title;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const Observer = globalThis.ResizeObserver;
    if (Observer === undefined) return;
    this.sizeObserver = new Observer((entries) => this.applyMeasuredWidth(entries[0]?.contentRect.width));
    this.sizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    this.sizeObserver?.disconnect();
    delete this.sizeObserver;
    super.disconnectedCallback();
  }

  private applyMeasuredWidth(measured: number | undefined): void {
    if (measured === undefined || !Number.isFinite(measured) || measured <= PLOT_LEFT + PLOT_RIGHT) return;
    const next = Math.round(measured);
    if (next === this.chartWidth) return;
    const previous = this.chartWidth;
    this.chartWidth = next;
    this.requestUpdate('chartWidth', previous);
  }

  protected override render() {
    const series = this.resolvedSeries();
    const aligned = alignAeliqoChartSeries(series);
    const hasInvalidPoints = series.some((item) =>
      item.points.some((point) => point.value !== null && !Number.isFinite(point.value)),
    );
    const hasGaps = aligned.some((item) => item.points.some((point) => point.value === null));
    const geometry = hasInvalidPoints ? { segments: [], circles: [] } : this.getGeometry(aligned, this.chartWidth);
    const accessibleName = this.accessibleName(series, hasInvalidPoints, hasGaps);

    return html`
      <figure part="figure">
        ${this.renderCaption()} ${this.renderPlot(geometry, accessibleName, series)}
        ${this.renderFeedback(hasInvalidPoints, hasGaps)} ${this.renderLegend(series)}
        ${this.renderDataTable(series, aligned)}
      </figure>
    `;
  }

  private accessibleName(series: readonly AeliqoChartSeries[], hasInvalidPoints: boolean, hasGaps: boolean): string {
    const copy = this.copy;
    const parts = [this.displayTitle, this.summary];
    if (this.scope) parts.push(`${copy.scope}: ${this.scope}.`);
    if (series.length > 0) parts.push(`${copy.series}: ${series.map((item) => item.label).join(', ')}.`);
    if (hasInvalidPoints) parts.push(copy.unavailable);
    if (hasGaps) parts.push(copy.gaps);
    return parts.filter((part) => part.length > 0).join(' ');
  }

  private renderCaption() {
    return html`<figcaption>
      <strong>${this.displayTitle}</strong>
      ${this.summary ? html`<span part="summary">${this.summary}</span>` : nothing}
      ${this.unit ? html`<span part="unit">${this.copy.unit}: ${this.unit}</span>` : nothing}
      ${this.scope ? html`<span part="scope">${this.copy.scope}: ${this.scope}</span>` : nothing}
    </figcaption>`;
  }

  private renderFeedback(hasInvalidPoints: boolean, hasGaps: boolean) {
    return html`
      ${hasInvalidPoints ? html`<p part="error" role="status">${this.copy.unavailable}</p>` : nothing}
      ${hasGaps && !hasInvalidPoints ? html`<p part="gap" role="status">${this.copy.gaps}</p>` : nothing}
    `;
  }

  private renderLegend(series: readonly AeliqoChartSeries[]) {
    if (series.length === 0) return nothing;
    return html`<ul part="legend" aria-label=${this.copy.series}>
      ${series.map(
        (item, index) =>
          html`<li>
            <span part="legend-marker" class=${this.seriesClasses(index)} aria-hidden="true"></span>
            <span part="legend-label">${item.label}${item.unit ? ` (${item.unit})` : nothing}</span>
          </li>`,
      )}
    </ul>`;
  }

  private renderDataTable(series: readonly AeliqoChartSeries[], aligned: readonly AeliqoChartSeries[]) {
    return html`<details part="data">
      <summary>${this.copy.dataTable}</summary>
      <table>
        <caption>
          ${this.displayTitle}${this.unit ? ` (${this.unit})` : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col">${this.copy.label}</th>
            ${series.map((item) => html`<th scope="col">${item.label}${item.unit ? ` (${item.unit})` : nothing}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${this.tableLabels(aligned).map(
            (label, index) =>
              html`<tr>
                <th scope="row">${label}</th>
                ${aligned.map((item) => html`<td>${this.formatValue(item.points[index]?.value, item.points[index]?.displayValue)}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>
    </details>`;
  }

  private resolvedSeries(): readonly AeliqoChartSeries[] {
    if (this.series.length > 0) return this.series;
    return [{ id: 'value', label: this.copy.value, ...(this.unit ? { unit: this.unit } : {}), points: this.points }];
  }

  private tableLabels(series: readonly AeliqoChartSeries[]): readonly string[] {
    const length = Math.max(0, ...series.map((item) => item.points.length));
    return Array.from(
      { length },
      (_, index) =>
        series.find((item) => item.points[index] !== undefined)?.points[index]?.label ??
        `${this.copy.point} ${index + 1}`,
    );
  }

  private formatValue(value: number | null | undefined, displayValue?: string): string {
    if (displayValue !== undefined) return displayValue;
    return value === null || value === undefined || !Number.isFinite(value) ? '—' : String(value);
  }

  private getGeometry(series: readonly AeliqoChartSeries[], width: number): AeliqoChartGeometry {
    return buildAeliqoChartGeometry(series, width);
  }

  private renderPlot(geometry: AeliqoChartGeometry, accessibleName: string, series: readonly AeliqoChartSeries[]) {
    const xTicks = xAxisTicks(series, this.chartWidth);
    const yTicks = yAxisTicks(series);
    return svg`
      <svg
        part="plot"
        role="img"
        aria-label=${accessibleName}
        viewBox=${`0 0 ${this.chartWidth} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMinYMin meet"
      >
        ${
          this.copy === chartCopy.id
            ? svg`<title>Grafik data</title><desc>Gunakan tabel data di bawah untuk menelusuri nilainya.</desc>`
            : svg`<title>Data chart</title><desc>Use the data table below to explore the values.</desc>`
        }
        ${yTicks.map((tick) => svg`<line class="gridline" vector-effect="non-scaling-stroke" x1=${PLOT_LEFT} y1=${tick.position} x2=${this.chartWidth - PLOT_RIGHT} y2=${tick.position}></line>`)}
        <line class="axis" vector-effect="non-scaling-stroke" x1=${PLOT_LEFT} y1=${PLOT_TOP} x2=${PLOT_LEFT} y2=${PLOT_TOP + PLOT_HEIGHT}></line>
        <line class="axis" vector-effect="non-scaling-stroke" x1=${PLOT_LEFT} y1=${PLOT_TOP + PLOT_HEIGHT} x2=${this.chartWidth - PLOT_RIGHT} y2=${PLOT_TOP + PLOT_HEIGHT}></line>
        ${geometry.segments.map((segment) => svg`<polyline vector-effect="non-scaling-stroke" points=${segment.points} class=${this.seriesClasses(segment.seriesIndex)} part="line"></polyline>`)}
        ${geometry.circles.map(
          (circle) =>
            svg`<circle vector-effect="non-scaling-stroke" cx=${circle.x} cy=${circle.y} r="3" class=${this.seriesClasses(circle.seriesIndex)} part="point"></circle>`,
        )}
        ${yTicks.map((tick) => svg`<text class="axis-y-tick" x=${PLOT_LEFT - 8} y=${tick.position + 3} text-anchor="end">${tick.label}</text>`)}
        ${xTicks.map((tick) => svg`<text class="axis-x-tick" x=${tick.position} y=${PLOT_TOP + PLOT_HEIGHT + 18} text-anchor=${tick.anchor}>${tick.label}</text>`)}
      </svg>
    `;
  }

  private seriesClasses(index: number): string {
    const style = index % 5;
    return `series-${index} color-${index % 4} style-${style}`;
  }

  static readonly styles = aeliqoChartStyles;
}
