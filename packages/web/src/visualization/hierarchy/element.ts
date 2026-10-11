import { html, svg } from 'lit';
import { resultCaption } from '../scope-caption.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Result, ResultRef, Scalar } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import { AeliqoFoundationElement } from '../../foundation/base.js';
import { compileHierarchyVisualization } from './geometry.js';
import type { HierarchyGeometry, HierarchyVisualizationGeometry, RelationshipGeometry } from './geometry.js';
import type { AeliqoVisualizationSelectionDetail, VisualizationDataset, VisualizationInputs } from '../types.js';
import { aeliqoHierarchyStyles } from './styles.js';

function scalarLabel(value: Scalar): string {
  if (value === null) return 'Missing';
  if (typeof value === 'object') return value.decimal;
  return String(value);
}

export abstract class AeliqoHierarchyElementBase extends AeliqoFoundationElement {
  static readonly shadowRootOptions: ShadowRootInit = { mode: 'open', delegatesFocus: false };
  static readonly properties = {
    page: { state: true },
    visualization: { attribute: false },
    context: { attribute: false },
    datasets: { attribute: false },
    label: { type: String },
    width: { type: Number },
    height: { type: Number },
    maxMarks: { type: Number, attribute: 'max-marks' },
    selectionEnabled: { type: Boolean, attribute: false },
    selectedIdentity: { type: String, attribute: 'selected-identity' },
  };
  static readonly styles = aeliqoHierarchyStyles;

  visualization: VisualizationInputs['visualization'];
  context: VisualizationBindingContext = { results: [] };
  datasets: readonly VisualizationDataset[] = [];
  label = 'Data visualization';
  width = 640;
  height = 360;
  maxMarks = 20_000;
  selectionEnabled = true;
  selectedIdentity = '';
  private page = 0;
  private scope = '';
  private focused: HTMLElement | SVGElement | undefined;
  protected abstract readonly expectedView: 'tree' | 'treemap' | 'relationship';
  protected geometry: ReturnType<typeof compileHierarchyVisualization> | undefined;

  protected override willUpdate(changed: Map<string, unknown>): void {
    this.captureFocus();
    if (this.visualizationInputsChanged(changed)) this.refreshGeometry();
  }

  private captureFocus(): void {
    const active = this.shadowRoot?.activeElement;
    const elementType = globalThis.Element ?? Object;
    this.focused = active instanceof elementType ? (active as HTMLElement | SVGElement) : undefined;
  }

  private visualizationInputsChanged(changed: Map<string, unknown>): boolean {
    return ['visualization', 'context', 'datasets', 'width', 'height', 'maxMarks'].some((name) => changed.has(name));
  }

  private refreshGeometry(): void {
    const geometry = this.compileForExpectedView();
    this.geometry = geometry;
    const scope = geometry.ok ? JSON.stringify(geometry.value.result.ref) : '';
    this.clearStaleSelection(geometry, scope);
    this.updatePage(geometry, scope);
    this.clearMissingSelection(geometry);
  }

  private compileForExpectedView(): ReturnType<typeof compileHierarchyVisualization> {
    if (this.visualization?.view === this.expectedView) return compileHierarchyVisualization(this.inputs());
    return {
      ok: false,
      diagnostics: [
        {
          code: 'visualization.view',
          message: `This surface requires a ${this.expectedView} specification.`,
          retryable: false,
        },
      ],
    };
  }

  private clearStaleSelection(geometry: ReturnType<typeof compileHierarchyVisualization>, scope: string): void {
    if (!geometry.ok || (this.scope !== '' && scope !== this.scope)) this.selectedIdentity = '';
  }

  private updatePage(geometry: ReturnType<typeof compileHierarchyVisualization>, scope: string): void {
    if (scope !== this.scope) this.page = 0;
    this.scope = scope;
    if (!geometry.ok) {
      this.page = 0;
      return;
    }
    const lastPage = Math.max(0, Math.ceil(geometry.value.rows.length / 25) - 1);
    this.page = Math.min(this.page, lastPage);
  }

  private clearMissingSelection(geometry: ReturnType<typeof compileHierarchyVisualization>): void {
    if (!geometry.ok || this.selectedIdentity === '') return;
    const found = geometry.value.rows.some((row) => row.identity === this.selectedIdentity);
    if (!found) this.selectedIdentity = '';
  }

  protected override updated(): void {
    const focused = this.focused;
    this.focused = undefined;
    if (
      focused?.isConnected &&
      (this.ownerDocument.activeElement === this.ownerDocument.body ||
        (this.getRootNode() as Document | ShadowRoot).activeElement === this) &&
      !this.shadowRoot?.activeElement
    )
      focused.focus({ preventScroll: true });
  }

  protected inputs(): VisualizationInputs {
    return {
      visualization: this.visualization,
      context: this.context,
      datasets: this.datasets,
      label: this.label,
      width: this.width,
      height: this.height,
      maxMarks: this.maxMarks,
    };
  }

  protected abstract selectionEventName(): string;

  private select(identity: string, result: ResultRef): void {
    if (!this.selectionEnabled) return;
    const detail: AeliqoVisualizationSelectionDetail = Object.freeze({ source: 'user', identity, result });
    const event = new CustomEvent<AeliqoVisualizationSelectionDetail>(this.selectionEventName(), {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail,
    });
    if (this.dispatchEvent(event)) this.selectedIdentity = identity;
  }

  private keySelect(event: KeyboardEvent, identity: string, result: ResultRef): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.select(identity, result);
  }

  protected override render() {
    const geometry = this.geometry;
    if (geometry === undefined) return html`<p role="status">Preparing visualization.</p>`;
    if (!geometry.ok)
      return html`<p role="status">
        ${geometry.diagnostics[0]?.message ?? 'The visualization could not be materialized.'}
      </p>`;
    return this.renderGeometry(geometry.value);
  }

  private scopeText(result: Result): string {
    return resultCaption(result, result.counts.loaded) + '.';
  }

  private renderGeometry(geometry: HierarchyVisualizationGeometry) {
    return html`<figure part="figure">
      <figcaption>${this.label}</figcaption>
      <p part="scope">${this.scopeText(geometry.result)}</p>
      ${this.renderMetadata(geometry)} ${this.renderGraphic(geometry)}
      ${geometry.kind === 'relationship' ? this.renderRelationshipTable(geometry) : this.renderHierarchyTable(geometry)}
      <p class="sr-only">The loaded data is available in the table. Selection buttons are keyboard accessible.</p>
    </figure>`;
  }

  private renderMetadata(geometry: HierarchyVisualizationGeometry) {
    const warnings = geometry.result.warnings.map((warning) => html`<p>${warning.message}</p>`);
    return html`${this.renderPeriod(geometry.result)} ${this.renderFilters(geometry.result)}
    ${this.renderPrecision(geometry.result)} ${warnings}`;
  }

  private renderPeriod(result: Result) {
    if (result.period === undefined) return '';
    return html`<p>${result.period.interpretation} (${result.period.timezone})</p>`;
  }

  private renderFilters(result: Result) {
    if (result.filters.length === 0) return '';
    return html`<p>Filtered result (${result.filters.length} applied conditions).</p>`;
  }

  private renderPrecision(result: Result) {
    if (result.precision.kind !== 'approximate') return '';
    const uncertainty = result.precision.uncertainty;
    const detail = uncertainty.kind === 'unquantified' ? uncertainty.reason : uncertainty.interpretation;
    return html`<p>Approximate values: ${result.precision.method}. ${detail}</p>`;
  }

  private renderGraphic(geometry: HierarchyVisualizationGeometry) {
    if (geometry.state === 'data-only')
      return html`<p role="status">${geometry.reason ?? 'The graphic is unavailable.'}</p>`;
    if (geometry.kind === 'relationship') return this.renderRelationshipGraphic(geometry);
    return this.renderHierarchyGraphic(geometry);
  }

  private renderHierarchyGraphic(geometry: HierarchyGeometry) {
    const byId = new Map(geometry.nodes.map((node) => [node.identity, node]));
    const viewLabel = geometry.kind === 'tree' ? 'Hierarchy' : 'Treemap';
    return html`<div part="viewport" tabindex="0" role="region" aria-label=${this.label + ': scrollable graphic'}>
      <svg
        part="graphic"
        width=${geometry.width}
        height=${geometry.height}
        viewBox=${'0 0 ' + geometry.width + ' ' + geometry.height}
        role="group"
        aria-label=${this.label + '. ' + viewLabel + '. Loaded values are available in the data table.'}
      >
        ${this.renderTreeEdges(geometry, byId)}
        ${repeat(
          geometry.nodes.filter((node) => node.width > 0 && node.height > 0),
          (node) => node.identity,
          (node) => this.renderHierarchyNode(geometry, node),
        )}
      </svg>
    </div>`;
  }

  private renderTreeEdges(geometry: HierarchyGeometry, byId: ReadonlyMap<string, HierarchyGeometry['nodes'][number]>) {
    if (geometry.kind !== 'tree') return '';
    return geometry.nodes.map((node) => this.renderTreeEdge(node, byId));
  }

  private renderTreeEdge(
    node: HierarchyGeometry['nodes'][number],
    byId: ReadonlyMap<string, HierarchyGeometry['nodes'][number]>,
  ) {
    if (node.parentIdentity === undefined) return '';
    const parent = byId.get(node.parentIdentity);
    if (parent === undefined) return '';
    return svg`<line
      x1=${parent.x + parent.width / 2}
      y1=${parent.y + parent.height}
      x2=${node.x + node.width / 2}
      y2=${node.y}
      stroke="currentColor"
      stroke-opacity=".45"
    ></line>`;
  }

  private renderHierarchyNode(geometry: HierarchyGeometry, node: HierarchyGeometry['nodes'][number]) {
    const rect = this.renderHierarchyRect(geometry, node);
    const label = this.renderHierarchyLabel(geometry, node);
    return svg`${rect}${label}`;
  }

  private renderHierarchyRect(geometry: HierarchyGeometry, node: HierarchyGeometry['nodes'][number]) {
    const selected = this.selectedIdentity === node.rowIdentity;
    const tabindex = this.selectionEnabled ? '0' : '-1';
    const disabled = this.selectionEnabled ? 'false' : 'true';
    return svg`<rect
      part="node"
      x=${node.x}
      y=${node.y}
      width=${node.width}
      height=${node.height}
      rx="4"
      fill=${this.nodeFill(geometry, node)}
      fill-opacity=${this.nodeFillOpacity(geometry, node)}
      stroke="currentColor"
      stroke-opacity=".6"
      tabindex=${tabindex}
      role="button"
      aria-disabled=${disabled}
      aria-label=${node.label.trim() || node.rowIdentity}
      aria-pressed=${selected ? 'true' : 'false'}
      @click=${() => this.select(node.rowIdentity, geometry.result.ref)}
      @keydown=${(event: KeyboardEvent) => this.keySelect(event, node.rowIdentity, geometry.result.ref)}
    ></rect>`;
  }

  private nodeFill(geometry: HierarchyGeometry, node: HierarchyGeometry['nodes'][number]): string {
    if (geometry.kind === 'tree' || !node.leaf) return 'var(--aeliqo-color-surface-raised, #e2e8f0)';
    return 'var(--aeliqo-color-accent, #6366f1)';
  }

  private nodeFillOpacity(geometry: HierarchyGeometry, node: HierarchyGeometry['nodes'][number]): string {
    if (geometry.kind === 'treemap' && !node.leaf) return '.22';
    return '1';
  }

  private renderHierarchyLabel(geometry: HierarchyGeometry, node: HierarchyGeometry['nodes'][number]) {
    if (node.width <= 54 || node.height <= 20) return '';
    if (geometry.kind === 'treemap' && !node.leaf) return '';
    const threshold = Math.floor(node.width / 12);
    const text = node.label.length > threshold ? node.label.slice(0, Math.max(1, threshold - 1)) + '…' : node.label;
    const className = geometry.kind === 'tree' ? 'tree-label' : 'treemap-label';
    return svg`<text
      class=${className}
      x=${node.x + 6}
      y=${node.y + 4}
      dominant-baseline="text-before-edge"
    >${text}</text>`;
  }

  private renderHierarchyTable(geometry: HierarchyGeometry) {
    const result = geometry.result;
    const precision = result.precision.kind === 'exact' ? 'Exact' : 'Approximate';
    const label =
      geometry.kind === 'treemap'
        ? `${precision} loaded hierarchy data (${geometry.leafValuePolicy} area policy)`
        : `${precision} loaded hierarchy data`;
    return html`<div part="data" tabindex="0" role="region" aria-label=${`${this.label}: scrollable data`}>
        <table>
          <caption>
            ${label}
          </caption>
          <thead>
            <tr>
              <th scope="col">Select</th>
              ${result.fields.map((field) => html`<th scope="col">${field.label}${field.type.unit ? ` (${field.type.unit.symbol})` : ''}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${repeat(
              geometry.rows.slice(this.page * 25, this.page * 25 + 25),
              (row) => row.identity,
              (row) =>
                html`<tr aria-selected=${this.selectedIdentity === row.identity ? 'true' : 'false'}>
                  <td data-label="Select">
                    <button
                      type="button"
                      ?disabled=${!this.selectionEnabled}
                      aria-pressed=${this.selectedIdentity === row.identity ? 'true' : 'false'}
                      aria-label=${`Select row ${row.identity}`}
                      @click=${() => this.select(row.identity, result.ref)}
                      @keydown=${(event: KeyboardEvent) => this.keySelect(event, row.identity, result.ref)}
                    >
                      Select
                    </button>
                  </td>
                  ${result.fields.map((field) => html`<td data-label=${field.label}>${scalarLabel(row.values[field.id]!)}</td>`)}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${this.pagination(geometry.rows.length)}`;
  }

  private pagination(count: number) {
    const page = Math.min(this.page, Math.max(0, Math.ceil(count / 25) - 1));
    return count > 25
      ? html`<nav aria-label="Visualization data pages">
          <button
            type="button"
            ?disabled=${page === 0}
            @click=${() => {
              this.page = page - 1;
            }}
          >
            Previous</button
          ><span>Rows ${page * 25 + 1}–${Math.min((page + 1) * 25, count)} of ${count}</span
          ><button
            type="button"
            ?disabled=${(page + 1) * 25 >= count}
            @click=${() => {
              this.page = page + 1;
            }}
          >
            Next
          </button>
        </nav>`
      : '';
  }

  private renderRelationshipGraphic(geometry: RelationshipGeometry) {
    const selected = this.selectedIdentity;
    const byId = new Map(geometry.nodes.map((node) => [node.identity, node]));
    return html`<div part="viewport" tabindex="0" role="region" aria-label=${`${this.label}: scrollable graphic`}>
      <svg
        part="graphic"
        width=${geometry.width}
        height=${geometry.height}
        viewBox=${`0 0 ${geometry.width} ${geometry.height}`}
        role="group"
        aria-label=${`${this.label}. Relationship graph. Loaded values are available in the data table.`}
      >
        ${repeat(
          geometry.edges,
          (edge) => edge.identity,
          (edge) => {
            const source = byId.get(edge.source)!;
            const target = byId.get(edge.target)!;
            return svg`<line part="edge" x1=${source.x} y1=${source.y} x2=${target.x} y2=${target.y} stroke="currentColor" stroke-opacity=".5" tabindex=${this.selectionEnabled ? '0' : '-1'} role="button" aria-disabled=${this.selectionEnabled ? 'false' : 'true'} aria-label=${edge.label?.trim() || `${edge.sourceLabel} → ${edge.targetLabel}`} aria-pressed=${selected === edge.identity ? 'true' : 'false'} @click=${() => this.select(edge.identity, geometry.result.ref)} @keydown=${(event: KeyboardEvent) => this.keySelect(event, edge.identity, geometry.result.ref)}></line>`;
          },
        )}
        ${geometry.nodes.map((node) => svg`<circle cx=${node.x} cy=${node.y} r="9" fill=${node.namespace === 'source' ? 'var(--aeliqo-color-accent, #6366f1)' : 'var(--aeliqo-color-positive, #0f766e)'} stroke="currentColor"></circle><text class="relationship-node-label" x=${node.x + (node.namespace === 'source' ? -14 : 14)} y=${node.y + 5} text-anchor=${node.namespace === 'source' ? 'end' : 'start'}>${node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label}</text>`)}
        <text class="relationship-column-label" x=${geometry.width * 0.25} y="18" text-anchor="middle">Source</text>
        <text class="relationship-column-label" x=${geometry.width * 0.75} y="18" text-anchor="middle">Target</text>
      </svg>
    </div>`;
  }

  private renderRelationshipTable(geometry: RelationshipGeometry) {
    const result = geometry.result;
    const source = geometry.bound.spec.view === 'relationship' ? geometry.bound.spec.source.join(', ') : 'source';
    const target = geometry.bound.spec.view === 'relationship' ? geometry.bound.spec.target.join(', ') : 'target';
    return html`<div part="data" tabindex="0" role="region" aria-label=${`${this.label}: scrollable data`}>
        <table>
          <caption>
            ${result.precision.kind === 'exact' ? 'Exact' : 'Approximate'} loaded relationship data
            (${geometry.cardinality}; ${source} → ${target})
          </caption>
          <thead>
            <tr>
              <th scope="col">Select</th>
              ${result.fields.map((field) => html`<th scope="col">${field.label}${field.type.unit ? ` (${field.type.unit.symbol})` : ''}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${repeat(
              geometry.rows.slice(this.page * 25, this.page * 25 + 25),
              (row) => row.identity,
              (row) =>
                html`<tr aria-selected=${this.selectedIdentity === row.identity ? 'true' : 'false'}>
                  <td data-label="Select">
                    <button
                      type="button"
                      ?disabled=${!this.selectionEnabled}
                      aria-pressed=${this.selectedIdentity === row.identity ? 'true' : 'false'}
                      aria-label=${`Select relationship ${row.identity}`}
                      @click=${() => this.select(row.identity, result.ref)}
                      @keydown=${(event: KeyboardEvent) => this.keySelect(event, row.identity, result.ref)}
                    >
                      Select
                    </button>
                  </td>
                  ${result.fields.map((field) => html`<td data-label=${field.label}>${scalarLabel(row.values[field.id]!)}</td>`)}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${this.pagination(geometry.rows.length)}`;
  }
}

export class AeliqoTreeElement extends AeliqoHierarchyElementBase {
  protected readonly expectedView = 'tree' as const;
  protected selectionEventName(): string {
    return 'aeliqo-visualization-select';
  }
}

export class AeliqoTreemapElement extends AeliqoHierarchyElementBase {
  protected readonly expectedView = 'treemap' as const;
  protected selectionEventName(): string {
    return 'aeliqo-visualization-select';
  }
}

export class AeliqoRelationshipElement extends AeliqoHierarchyElementBase {
  protected readonly expectedView = 'relationship' as const;
  protected selectionEventName(): string {
    return 'aeliqo-visualization-select';
  }
}
