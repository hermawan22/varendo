import { html, svg, css, nothing } from 'lit';
import { resultCaption } from '../visualization/scope-caption.js';
import type { PlotUnit, PlotSpec, Result, ResultRef, Outcome } from '@varendo/core';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { compilePlotComposition, type PlotDataset, type CompiledPlot, type CompiledPlotNode } from './composition.js';
import { compilePlotUnit } from './geometry.js';
import type { PlotGeometry } from './geometry.js';
import { exactLabel } from './scales.js';
import { canvasPlotColor } from './palette.js';
import { observePlotTheme } from './theme.js';
import { svgPlotMarks, paintPlotCanvas, seriesColor, seriesSymbol } from './render.js';

export interface VarendoPlotSelectionDetail {
  readonly source: 'user';
  readonly identity: string;
  readonly result: ResultRef;
}
export type VarendoPlotSelectionEvent = CustomEvent<VarendoPlotSelectionDetail>;

/** Direct plot surface: no runtime, query evaluator or model instance is constructed. */
const tickText = (text: string): string => (text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text);
const plotInputProperties = ['spec', 'results', 'datasets', 'unit', 'result', 'rows', 'width', 'height', 'maxMarks'];

function plotInputsChanged(changed: ReadonlyMap<string, unknown>): boolean {
  return plotInputProperties.some((key) => changed.has(key));
}

function scopeDescription(result: Result): string {
  switch (result.coverage.kind) {
    case 'complete':
      return 'Complete result';
    case 'sample':
      return `Sample: ${result.coverage.method}`;
    case 'partial':
      return `Partial result: ${result.coverage.reason}`;
    case 'unknown':
      return `Scope unknown: ${result.coverage.reason}`;
    default:
      return assertCoverageNever(result.coverage);
  }
}

function assertCoverageNever(coverage: never): never {
  throw new Error(`Unsupported result coverage: ${String(coverage)}`);
}

export class VarendoPlotElement extends VarendoFoundationElement {
  static readonly properties = {
    spec: { attribute: false },
    results: { attribute: false },
    datasets: { attribute: false },
    unit: { attribute: false },
    result: { attribute: false },
    rows: { attribute: false },
    renderer: { type: String },
    width: { type: Number },
    height: { type: Number },
    maxMarks: { type: Number, attribute: 'max-marks' },
    label: { type: String },
    page: { state: true },
    selectedIdentity: { type: String, attribute: 'selected-identity' },
    selectedResult: { attribute: false },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: block;
        max-inline-size: 100%;
        color: var(--varendo-color-text, #111827);
      }
      figure {
        margin: 0;
      }
      [part='viewport'] {
        direction: ltr;
        position: relative;
        max-inline-size: 100%;
        overflow: auto;
      }
      [part='canvas'] {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      svg {
        display: block;
      }
      svg text {
        font: 11px system-ui;
        fill: currentColor;
      }
      table {
        border-collapse: collapse;
        inline-size: 100%;
      }
      th,
      td {
        text-align: start;
        padding: 0.5rem;
        border-block-end: 1px solid var(--varendo-color-border, #64748b);
      }
      [part='data'] {
        overflow: auto;
      }
      button {
        min-block-size: 2.75rem;
        min-inline-size: 2.75rem;
      }
      button:focus-visible {
        outline: 3px solid var(--varendo-color-focus, #4338ca);
        outline-offset: 2px;
      }
      [aria-selected='true'] {
        background: var(--varendo-color-surface, #f8fafc);
      }
      [part='concat-inline'] {
        display: flex;
        gap: 1rem;
        overflow: auto;
      }
      [part='facet'] {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
      }
      [part='layer'] {
        display: grid;
        overflow: auto;
      }
      [part='layer'] > div {
        grid-area: 1/1;
      }
      @media (forced-colors: active) {
        svg path,
        svg circle,
        svg rect {
          stroke: CanvasText;
          fill: CanvasText;
        }
      }
    `,
  ];
  spec: PlotSpec | undefined;
  results: readonly Result[] = [];
  datasets: readonly PlotDataset[] = [];
  unit: PlotUnit | undefined;
  result: Result | undefined;
  rows: unknown = [];
  renderer: 'svg' | 'canvas' = 'svg';
  width = 640;
  height = 320;
  maxMarks = 20_000;
  label = 'Data visualization';
  selectedIdentity = '';
  selectedResult: ResultRef | undefined;
  private selectionScope = '';
  private singleResult = true;
  private page = 0;
  private composition: Outcome<CompiledPlot> | undefined;
  private stopThemeObservation: (() => void) | undefined;
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.renderer === 'canvas') this.requestUpdate();
    this.stopThemeObservation = observePlotTheme(this, () => {
      if (this.renderer === 'canvas') this.requestUpdate();
    });
  }
  override disconnectedCallback(): void {
    this.stopThemeObservation?.();
    this.stopThemeObservation = undefined;
    super.disconnectedCallback();
  }
  private canvasGeometries: PlotGeometry[] = [];
  private compiled: Outcome<PlotGeometry> | undefined;
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!plotInputsChanged(changed)) return;
    this.compileInput();
    this.clampPage();
    this.updateSelectionScope(this.collectGeometries());
  }

  private compileInput(): void {
    const options = { width: this.width, height: this.height, maxRows: 10_000, maxMarks: this.maxMarks };
    this.composition = this.spec ? compilePlotComposition(this.spec, this.results, this.datasets, options) : undefined;
    this.compiled =
      this.unit && this.result && !this.spec ? compilePlotUnit(this.unit, this.result, this.rows, options) : undefined;
  }

  private clampPage(): void {
    const count = this.compiled?.ok ? this.compiled.value.rows.length : 0;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(count / 25) - 1));
  }

  private collectGeometries(): PlotGeometry[] {
    const geometries: PlotGeometry[] = [];
    if (this.composition?.ok) this.collectNodeGeometries(this.composition.value.root, geometries);
    else if (this.compiled?.ok) geometries.push(this.compiled.value);
    return geometries;
  }

  private collectNodeGeometries(node: CompiledPlotNode, geometries: PlotGeometry[]): void {
    if (node.kind === 'unit') {
      geometries.push(node.geometry);
      return;
    }
    if (node.kind === 'facet') {
      node.children.forEach((child) => this.collectNodeGeometries(child.node, geometries));
      return;
    }
    node.children.forEach((child) => this.collectNodeGeometries(child, geometries));
  }

  private updateSelectionScope(geometries: readonly PlotGeometry[]): void {
    const scope = JSON.stringify([...new Set(geometries.map((geometry) => this.refKey(geometry.result.ref)))].sort());
    const scopeChanged = this.selectionScope !== '' && this.selectionScope !== scope && !this.selectedResult;
    if (scopeChanged || !this.selectionExists(geometries)) this.selectedIdentity = '';
    this.singleResult = new Set(geometries.map((geometry) => this.refKey(geometry.result.ref))).size === 1;
    this.selectionScope = scope;
  }

  private selectionExists(geometries: readonly PlotGeometry[]): boolean {
    return geometries.some((geometry) => {
      const resultMatches =
        !this.selectedResult || this.refKey(this.selectedResult) === this.refKey(geometry.result.ref);
      return resultMatches && geometry.rows.some((row) => row.identity === this.selectedIdentity);
    });
  }
  protected override updated(): void {
    if (this.renderer !== 'canvas') return;
    const style = getComputedStyle(this);
    const forcedColors = this.ownerDocument.defaultView?.matchMedia('(forced-colors: active)').matches === true;
    const canvases = this.renderRoot.querySelectorAll<HTMLCanvasElement>('canvas');
    canvases.forEach((canvas, index) => {
      const g = this.canvasGeometries[index];
      if (!g) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const ratio = Math.min(
        2,
        Math.max(1, globalThis.devicePixelRatio || 1),
        Math.sqrt(4_000_000 / (g.width * g.height)),
      );
      canvas.width = Math.round(g.width * ratio);
      canvas.height = Math.round(g.height * ratio);
      canvas.style.width = `${g.width}px`;
      canvas.style.height = `${g.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintPlotCanvas(context, g, (color) => (forcedColors ? style.color : canvasPlotColor(color, style)));
    });
  }

  private refKey(ref: ResultRef): string {
    return JSON.stringify([
      ref.id,
      ref.revision,
      ref.sourceLineage ?? null,
      ref.outputId,
      ref.queryDigest,
      ref.scopeDigest,
    ]);
  }
  private select(identity: string, result: Result): void {
    this.dispatchEvent(
      new CustomEvent('varendo-plot-select', {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: Object.freeze({ source: 'user', identity, result: result.ref }),
      }),
    );
  }
  protected override render() {
    this.canvasGeometries = [];
    if (this.composition) {
      if (!this.composition.ok) return html`<p role="status">${this.composition.diagnostics[0].message}</p>`;
      return this.renderNode(this.composition.value.root, this.label);
    }
    const compiled = this.compiled;
    if (!compiled) return html`<p role="status">No result is available.</p>`;
    if (!compiled.ok) return html`<p role="status">${compiled.diagnostics[0].message}</p>`;
    return this.renderGeometry(compiled.value, this.label);
  }
  private renderNode(node: CompiledPlotNode, label: string, graphic = true, data = true): unknown {
    switch (node.kind) {
      case 'unit':
        return this.renderGeometry(node.geometry, label, graphic, data, node.displayedIdentities);
      case 'facet':
        return html`<section aria-label=${label} part="facet">
          ${node.children.map((c) => html`<section aria-label=${`${node.field}: ${c.label}`}>${data ? html`<h3>${node.field}: ${c.label}</h3>` : nothing}${this.renderNode(c.node, `${label}, ${node.field}: ${c.label}`, graphic, data)}</section>`)}
        </section>`;
      case 'concat':
        return html`<section part=${`concat-${node.direction}`} aria-label=${label}>
          ${node.children.map((c, i) => this.renderNode(c, `${label}, panel ${i + 1}`, graphic, data))}
        </section>`;
      default:
        return html`<section aria-label=${label}>
          ${data ? html`<h3>${label}</h3>` : nothing}${graphic ? html`<div part="layer">${node.children.map((c, i) => html`<div>${this.renderNode(c, `${label}, layer ${i + 1}`, true, false)}</div>`)}</div>` : nothing}${data ? node.children.map((c, i) => this.renderNode(c, `${label}, layer ${i + 1}`, false, true)) : nothing}
        </section>`;
    }
  }
  private renderGeometry(
    g: PlotGeometry,
    label: string,
    graphic = true,
    data = true,
    displayedIdentities?: readonly string[],
  ) {
    const displayed = this.displayedRows(g, displayedIdentities);
    const page = Math.min(this.page, Math.max(0, Math.ceil(displayed.length / 25) - 1));
    const pageRows = displayed.slice(page * 25, page * 25 + 25);
    if (graphic && g.axes && this.renderer === 'canvas') this.canvasGeometries.push(g);
    const scope = scopeDescription(g.result);
    const valueLabel = g.result.precision.kind === 'exact' ? 'Exact loaded values' : 'Loaded approximate values';
    return html`<figure part="figure">
      ${data ? this.renderMetadata(g, label, displayed.length) : nothing} ${this.renderAxisNotice(g, graphic)}
      ${g.state === 'data-only' ? html`<p role="status">${g.reason}</p>` : nothing}
      ${graphic ? this.renderGraphic(g, label, scope) : nothing}
      ${data ? this.renderData(g, label, valueLabel, displayed, pageRows, page) : nothing}
    </figure>`;
  }

  private displayedRows(
    g: PlotGeometry,
    displayedIdentities?: readonly string[],
  ): readonly PlotGeometry['rows'][number][] {
    if (displayedIdentities === undefined) return g.rows;
    const identities = new Set(displayedIdentities);
    return g.rows.filter((row) => identities.has(row.identity));
  }

  private renderMetadata(g: PlotGeometry, label: string, displayedCount: number): unknown {
    const precision = g.result.precision;
    return html`<figcaption>${label}</figcaption>
      <p part="scope">
        ${resultCaption(g.result, g.rows.length)}.${displayedCount !== g.rows.length ? ` ${displayedCount} rows in this view.` : ''}
      </p>
      ${g.result.period ? html`<p>${g.result.period.interpretation} (${g.result.period.timezone})</p>` : nothing}
      ${g.result.filters.length ? html`<p>Filtered result (${g.result.filters.length} applied conditions).</p>` : nothing}
      ${precision.kind === 'approximate' ? this.renderApproximation(precision) : nothing}`;
  }

  private renderApproximation(precision: Extract<Result['precision'], { kind: 'approximate' }>): unknown {
    let uncertainty: string;
    if (precision.uncertainty.kind === 'unquantified') uncertainty = precision.uncertainty.reason;
    else uncertainty = precision.uncertainty.interpretation;
    return html`<p>Approximate values: ${precision.method}. ${uncertainty}</p>`;
  }

  private renderAxisNotice(g: PlotGeometry, graphic: boolean): unknown {
    if (!graphic || g.axes === undefined) return nothing;
    const hasLongLabel = [...g.axes.x.ticks, ...g.axes.y.ticks].some((tick) => tick.label.length > 10);
    return hasLongLabel ? html`<p>Axis labels are shortened. Exact values are listed below.</p>` : nothing;
  }

  private renderGraphic(g: PlotGeometry, label: string, scope: string): unknown {
    const axes = g.axes;
    if (axes === undefined) return nothing;
    const axisLeft = g.axisLeft ?? 64;
    return html`<div part="viewport" style=${`width:${g.width}px;height:${g.height}px`}>
      ${this.renderer === 'canvas' ? html`<canvas part="canvas" aria-hidden="true"></canvas>` : nothing}
      <svg
        viewBox=${`0 0 ${g.width} ${g.height}`}
        width=${g.width}
        height=${g.height}
        role="img"
        aria-label=${`${label}. ${scope}. Values and selection are available in the data table below.`}
      >
        ${this.renderer === 'svg' ? svgPlotMarks(g) : nothing}
        <path d=${`M${axisLeft},24V${g.height - 48}H${g.width - 24}`} fill="none" stroke="currentColor"></path>
        ${axes.x.ticks.map((tick) => svg`<text x=${tick.position} y=${g.height - 30} text-anchor="middle" aria-label=${tick.label}>${tickText(tick.label)}</text>`)}
        ${axes.y.ticks.map((tick) => svg`<text x=${axisLeft - 6} y=${tick.position} text-anchor="end" aria-label=${tick.label}>${tickText(tick.label)}</text>`)}
        <text x=${g.width / 2} y=${g.height - 8} text-anchor="middle">${axes.xLabel}</text>
        <text x=${axisLeft} y="14">${axes.yLabel}</text>
      </svg>
    </div>`;
  }

  private renderData(
    g: PlotGeometry,
    label: string,
    valueLabel: string,
    displayed: readonly PlotGeometry['rows'][number][],
    pageRows: readonly PlotGeometry['rows'][number][],
    page: number,
  ): unknown {
    return html`${this.renderLegend(g)}${this.renderTable(g, label, valueLabel, pageRows)}${this.renderPager(displayed.length, page)}`;
  }

  private renderLegend(g: PlotGeometry): unknown {
    if (!g.legend.some((entry) => entry.label)) return nothing;
    return html`<ul aria-label="Series">
      ${g.legend.map((entry) => html`<li><span aria-hidden="true" style=${`color:${seriesColor(g, entry.id)}`}>${seriesSymbol(g, entry.id)}</span> ${entry.label}</li>`)}
    </ul>`;
  }

  private renderTable(
    g: PlotGeometry,
    label: string,
    valueLabel: string,
    rows: readonly PlotGeometry['rows'][number][],
  ): unknown {
    return html`<div part="data">
      <table>
        <caption>
          ${label}: ${valueLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col">Select</th>
            ${g.result.fields.map((field) => html`<th scope="col">${field.label}${field.type.unit ? ` (${field.type.unit.symbol})` : ''}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => this.renderTableRow(g, row))}
        </tbody>
      </table>
    </div>`;
  }

  private renderTableRow(g: PlotGeometry, row: PlotGeometry['rows'][number]): unknown {
    const identityLabel = g.result.identity.map((key) => exactLabel(row.values[key]!)).join(', ');
    return html`<tr>
      <td>
        <button
          type="button"
          aria-pressed=${this.selectionPressed(row.identity, g.result) ? 'true' : 'false'}
          aria-label=${`Select ${identityLabel}`}
          @click=${() => this.select(row.identity, g.result)}
        >
          Select
        </button>
      </td>
      ${g.result.fields.map((field) => html`<td>${exactLabel(row.values[field.id]!)}</td>`)}
    </tr>`;
  }

  private selectionPressed(identity: string, result: Result): boolean {
    if (this.selectedIdentity !== identity) return false;
    if (this.selectedResult !== undefined) return this.refKey(this.selectedResult) === this.refKey(result.ref);
    return this.singleResult;
  }

  private renderPager(displayedCount: number, page: number): unknown {
    if (displayedCount <= 25) return nothing;
    return html`<nav aria-label="Plot data pages">
      <button type="button" ?disabled=${page === 0} @click=${() => this.movePage(page - 1)}>Previous</button>
      <span>Rows ${page * 25 + 1}–${Math.min((page + 1) * 25, displayedCount)} of ${displayedCount} displayed</span>
      <button type="button" ?disabled=${(page + 1) * 25 >= displayedCount} @click=${() => this.movePage(page + 1)}>
        Next
      </button>
    </nav>`;
  }

  private movePage(page: number): void {
    this.page = page;
  }
}
