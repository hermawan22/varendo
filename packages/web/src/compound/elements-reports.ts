import { css, html, nothing } from 'lit';
import type { ResultRef, Scalar, VisualizationSpec } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import { VarendoCompoundElement, varendoCompoundThemeStyles } from './base.js';
import type { VarendoCompoundStatus } from './types.js';
import type { VarendoDataColumn, VarendoDataRecord, VarendoDataScope, VarendoSelectionDetail } from '../data/types.js';
import type { VisualizationDataset } from '../visualization/types.js';
import { event, status } from './shared.js';

export class VarendoInvestigationElement extends VarendoCompoundElement {
  static readonly properties = {
    trendContext: { attribute: false },
    trendDatasets: { attribute: false },
    eventContext: { attribute: false },
    eventDatasets: { attribute: false },
    trend: { attribute: false },
    baseline: { attribute: false },
    events: { attribute: false },
    detailRecord: { attribute: false },
    detailFields: { attribute: false },
    result: { attribute: false },
    eventResult: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    label: { type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='trend'] {
        grid-column: 1 / -1;
      }
      [part='caution'] {
        border-inline-start: 0.25rem solid var(--varendo-color-warning, #b54708);
        overflow-wrap: anywhere;
        padding-inline-start: var(--varendo-space-12, 0.75rem);
      }
      [part='caution'] > span {
        display: block;
        unicode-bidi: plaintext;
      }
    `,
  ];
  trendContext: VisualizationBindingContext = { results: [] };
  trendDatasets: readonly VisualizationDataset[] = [];
  eventContext: VisualizationBindingContext = { results: [] };
  eventDatasets: readonly VisualizationDataset[] = [];
  trend: VisualizationSpec | undefined;
  baseline: Scalar | undefined;
  events: VisualizationSpec | undefined;
  detailRecord: VarendoDataRecord | undefined;
  detailFields: readonly VarendoDataColumn[] = [];
  result: ResultRef | undefined;
  eventResult: ResultRef | undefined;
  identity: readonly string[] = [];
  entity = 'record';
  scope: VarendoDataScope | undefined;
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Investigation';
  label = 'Trend';
  protected override render() {
    const current = status(this.status);
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        ${this.scope ? html`<span part="scope">${this.scopeLabel(this.scope)}</span>` : nothing}
      </div>
      <div part="grid">
        <section part="trend" aria-label="Trend">
          <h3>${this.label}</h3>
          ${this.trend ? html`<varendo-trend .visualization=${this.trend} .context=${this.trendContext} .datasets=${this.trendDatasets}></varendo-trend>` : html`<p part="hint">No trend is available.</p>`}
        </section>
        <section part="baseline" aria-label="Baseline">
          <h3>Baseline</h3>
          <varendo-metric label="Baseline" .value=${this.baseline}></varendo-metric>
        </section>
        <section part="events" aria-label="Event timeline">
          <h3>Event timeline</h3>
          ${this.events ? html`<varendo-timeline .visualization=${this.events} .context=${this.eventContext} .datasets=${this.eventDatasets}></varendo-timeline>` : html`<p part="hint">No events are available.</p>`}
        </section>
        <section part="detail">
          <h3>Detail</h3>
          <varendo-detail
            .title=${'Investigation detail'}
            .record=${this.detailRecord}
            .fields=${this.detailFields}
            .identity=${this.identity}
            .entity=${this.entity}
            .scope=${this.scope}
            .status=${current}
          ></varendo-detail>
        </section>
      </div>
      <p part="caution">
        <span>Associations are displayed as evidence in the selected scope. They do not establish causal claims.</span>
      </p>
      ${current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
    </section>`;
  }
}

export class VarendoSearchResultsElement extends VarendoCompoundElement {
  static readonly styles = [...varendoCompoundThemeStyles];
  static readonly properties = {
    detailRecord: { attribute: false },
    detailFields: { attribute: false },
    query: { type: String },
    queryRevision: { attribute: 'query-revision', type: String },
    resultRevision: { attribute: 'result-revision', type: String },
    rows: { attribute: false },
    columns: { attribute: false },
    identity: { attribute: false },
    result: { attribute: false },
    scope: { attribute: false },
    selectedKey: { attribute: 'selected-key', type: String },
    entity: { type: String },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    count: { type: Number },
  };
  detailRecord: VarendoDataRecord | undefined;
  detailFields: readonly VarendoDataColumn[] = [];
  query = '';
  queryRevision = '';
  resultRevision = '';
  rows: readonly VarendoDataRecord[] = [];
  columns: readonly VarendoDataColumn[] = [];
  identity: readonly string[] = [];
  result: ResultRef | undefined;
  scope: VarendoDataScope | undefined;
  selectedKey = '';
  entity = 'result';
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Search results';
  count: number | undefined;
  protected override render() {
    const stale = this.queryRevision.length > 0 && this.queryRevision !== this.resultRevision;
    const current = stale ? 'stale' : status(this.status);
    const total = this.count ?? this.scope?.filteredTotal;
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        <span part="query">${this.query ? 'Results for “' + this.query + '”' : 'Enter a search query'}</span>
      </div>
      ${this.renderResults(stale, total, current)}
      ${!stale && current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
    </section>`;
  }

  private renderResults(stale: boolean, total: number | undefined, current: ReturnType<typeof status>) {
    if (stale)
      return html`<p part="status" role="status">Results are out of date for this query. Refresh to view them.</p>`;
    const selectedKeys = this.selectedKey ? [this.selectedKey] : [];
    const countText = total === undefined ? 'Matching count unavailable' : total.toLocaleString() + ' matching results';
    return html`<p part="scope">${countText}</p>
      <varendo-card-collection
        .rows=${this.rows}
        .columns=${this.columns}
        .identity=${this.identity}
        .entity=${this.entity}
        .selectedKeys=${selectedKeys}
        .result=${this.result}
        .scope=${this.scope}
        selection="single"
        @varendo-card-selection=${this.forwardSelection}
      ></varendo-card-collection>
      ${this.renderDetail(current)}`;
  }

  private renderDetail(current: ReturnType<typeof status>) {
    if (this.detailRecord === undefined) return nothing;
    const fields = this.detailFields.length > 0 ? this.detailFields : this.columns;
    return html`<varendo-detail
      part="detail"
      .record=${this.detailRecord}
      .fields=${fields}
      .identity=${this.identity}
      .entity=${this.entity}
      .scope=${this.scope}
      .status=${current}
    ></varendo-detail>`;
  }
  private readonly forwardSelection = (raw: Event): void => {
    const detail = (raw as CustomEvent<VarendoSelectionDetail>).detail;
    if (detail) this.dispatchEvent(event('varendo-search-results-selection', detail));
  };
}
