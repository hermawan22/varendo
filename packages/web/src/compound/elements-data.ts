import { css, html, nothing } from 'lit';
import type { ResultRef } from '@varendo/core';
import { stableDataRecordKey, stableDataValueKey } from '../data/shared.js';
import type {
  VarendoBreakdownGroup,
  VarendoBreakdownGroupDetail,
  VarendoComparisonMetric,
  VarendoComparisonSetDetail,
  VarendoCompoundStatus,
} from './types.js';
import type {
  VarendoDataColumn,
  VarendoDataRecord,
  VarendoDataScope,
  VarendoFieldOption,
  VarendoFilterPredicate,
  VarendoFilterChangeDetail,
  VarendoSelectionDetail,
} from '../data/types.js';
import type { VarendoTableColumn, VarendoTableRow } from '../types.js';
import { VarendoCompoundElement, varendoCompoundThemeStyles } from './base.js';
import {
  MAX_BREAKDOWN_GROUPS,
  MAX_COMPARISON_KEYS,
  MAX_COMPARISON_METRICS,
  bounded,
  event,
  status,
  tableCell,
} from './shared.js';

export class VarendoExplorerElement extends VarendoCompoundElement {
  static readonly properties = {
    fields: { attribute: false },
    predicate: { attribute: false },
    rows: { attribute: false },
    columns: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    selectedKey: { attribute: 'selected-key', type: String },
    detailRecord: { attribute: false },
    detailFields: { attribute: false },
    result: { attribute: false },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    filterLabel: { attribute: 'filter-label', type: String },
    collectionLabel: { attribute: 'collection-label', type: String },
    detailLabel: { attribute: 'detail-label', type: String },
    selection: { type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='panels'] {
        display: grid;
        gap: var(--varendo-space-24, 1.5rem);
        grid-template-columns: minmax(12rem, 0.7fr) minmax(16rem, 1.3fr);
      }
      @media (max-width: 48rem) {
        [part='panels'] {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
  fields: readonly VarendoFieldOption[] = [];
  predicate: VarendoFilterPredicate | undefined;
  rows: readonly VarendoDataRecord[] = [];
  columns: readonly VarendoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  selectedKey = '';
  detailRecord: VarendoDataRecord | undefined;
  detailFields: readonly VarendoDataColumn[] = [];
  result: ResultRef | undefined;
  scope: VarendoDataScope | undefined;
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Explore';
  filterLabel = 'Filter';
  collectionLabel = 'Records';
  detailLabel = 'Selected detail';
  selection: 'none' | 'single' | 'multiple' = 'single';
  protected override render() {
    const current = status(this.status);
    const detail = this.detailRecord ?? this.rows.find((row) => this.rowKey(row) === this.selectedKey);
    const statusText = this.statusTemplate(current, this.message);
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        ${this.scope ? html`<span part="scope">${this.scopeLabel(this.scope)}</span>` : nothing}
      </div>
      <div part="panels">
        <section part="filter" aria-label=${this.filterLabel}>
          <h3>${this.filterLabel}</h3>
          <varendo-filter-builder
            .fields=${this.fields}
            .predicate=${this.predicate}
            .entity=${this.entity}
            .status=${current}
            @varendo-filter-change=${this.forwardFilter}
          ></varendo-filter-builder>
        </section>
        <section part="collection" aria-label=${this.collectionLabel}>
          <h3>${this.collectionLabel}</h3>
          <varendo-record-list
            .rows=${this.rows}
            .columns=${this.columns}
            .identity=${this.identity}
            .entity=${this.entity}
            .selectedKeys=${this.selectedKey ? [this.selectedKey] : []}
            .result=${this.result}
            .scope=${this.scope}
            .selection=${this.selection}
            .status=${current}
            @varendo-record-list-selection=${this.forwardSelection}
          ></varendo-record-list>
        </section>
        <section part="detail">
          <h3>${this.detailLabel}</h3>
          <varendo-detail
            .title=${this.detailLabel}
            .record=${detail}
            .fields=${this.detailFields.length ? this.detailFields : this.columns}
            .identity=${this.identity}
            .entity=${this.entity}
            .scope=${this.scope}
            .status=${current}
          ></varendo-detail>
        </section>
      </div>
      ${statusText ? html`<p part="status" role="status">${statusText}</p>` : nothing}
    </section>`;
  }
  private rowKey(row: VarendoDataRecord): string | undefined {
    return stableDataRecordKey(row, this.identity);
  }
  private readonly forwardFilter = (raw: Event): void => {
    const detail = (raw as CustomEvent<VarendoFilterChangeDetail>).detail;
    if (detail) this.dispatchEvent(event('varendo-explorer-filter', detail));
  };
  private readonly forwardSelection = (raw: Event): void => {
    const detail = (raw as CustomEvent<VarendoSelectionDetail>).detail;
    if (detail) this.dispatchEvent(event('varendo-explorer-selection', detail));
  };
}

export class VarendoComparisonElement extends VarendoCompoundElement {
  static readonly properties = {
    compareKeys: { attribute: false },
    compareSet: { attribute: false },
    metrics: { attribute: false },
    entity: { type: String },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    result: { attribute: false },
    scope: { attribute: false },
    identity: { attribute: false },
    compatible: { type: Boolean },
    selectedKey: { attribute: 'selected-key', type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='table'] {
        max-inline-size: 100%;
        overflow-x: auto;
      }
    `,
  ];
  compareKeys: readonly string[] = [];
  compareSet: readonly { readonly key: string; readonly label?: string }[] = [];
  metrics: readonly VarendoComparisonMetric[] = [];
  entity = 'record';
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Comparison';
  result: ResultRef | undefined;
  scope: VarendoDataScope | undefined;
  identity: readonly string[] = [];
  compatible = true;
  selectedKey = '';
  protected override render() {
    const requestedKeys = this.compareKeys.length
      ? this.compareKeys
      : bounded(this.compareSet, MAX_COMPARISON_KEYS).map((item) => item.key);
    const overflow = (this.compareKeys.length || this.compareSet.length) > MAX_COMPARISON_KEYS;
    const keys = [...new Set(bounded(requestedKeys, MAX_COMPARISON_KEYS))];
    const metrics = bounded(this.metrics, MAX_COMPARISON_METRICS);
    const labels = new Map(
      bounded(this.compareSet, MAX_COMPARISON_KEYS).map((item) => [item.key, item.label ?? item.key]),
    );
    const selectedKeys = new Set(keys);
    const columns: readonly VarendoTableColumn[] = [
      { key: 'metric', label: 'Metric' },
      ...keys.map((key) => ({ key: `comparison:${key}`, label: labels.get(key) ?? key })),
    ];
    const rows: readonly VarendoTableRow[] = metrics.map((metric) => ({
      metricId: metric.id,
      metric: metric.unit ? `${metric.label} (${metric.unit})` : metric.label,
      ...Object.fromEntries(keys.map((key) => [`comparison:${key}`, tableCell(metric.values[key])])),
    }));
    const current = status(this.status);
    const boundedNotice = overflow || this.metrics.length > metrics.length;
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        ${this.scope ? html`<span part="scope">${this.scopeLabel(this.scope)}</span>` : nothing}
      </div>
      ${
        !this.compatible
          ? html`<p part="status" role="alert">
              These metrics cannot be compared because their units or grain are incompatible.
            </p>`
          : html`
              <div part="actions" role="group" aria-label="Compare set">
                ${keys.map((key) => html`<button part="compare-button" type="button" ?disabled=${overflow} aria-pressed=${String(selectedKeys.has(key))} @click=${() => this.requestCompare(key)}>${labels.get(key) ?? key}</button>`)}
              </div>
              <div part="table" role="region" aria-label="Simultaneous comparison">
                <varendo-table
                  .caption=${`${this.title}: ${keys.length} ${this.entity}${keys.length === 1 ? '' : 's'}`}
                  .columns=${columns}
                  .rows=${rows}
                  .identity=${['metricId']}
                  .result=${this.result}
                  .scope=${this.scope}
                  status=${current}
                ></varendo-table>
              </div>
              ${boundedNotice ? html`<p part="hint">Showing a bounded comparison window. Narrow the compare set to edit it.</p>` : nothing}
            `
      }
      ${current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
    </section>`;
  }
  private readonly requestCompare = (key: string): void => {
    if ((this.compareKeys.length || this.compareSet.length) > MAX_COMPARISON_KEYS) return;
    const current = [...new Set(this.compareKeys.length ? this.compareKeys : this.compareSet.map((item) => item.key))];
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    if (next.length === 0) return;
    this.dispatchEvent(
      event<VarendoComparisonSetDetail>('varendo-comparison-set', {
        source: 'user',
        entity: this.entity,
        keys: next,
        ...(this.result === undefined ? {} : { result: this.result }),
        ...(this.scope === undefined ? {} : { scope: this.scope }),
      }),
    );
  };
}

export class VarendoBreakdownElement extends VarendoCompoundElement {
  static readonly properties = {
    groups: { attribute: false },
    rows: { attribute: false },
    columns: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    groupLabel: { attribute: 'group-label', type: String },
    metricLabel: { attribute: 'metric-label', type: String },
    result: { attribute: false },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    selectedGroup: { attribute: 'selected-group', type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='table'] {
        max-inline-size: 100%;
        overflow-x: auto;
      }
    `,
  ];
  groups: readonly VarendoBreakdownGroup[] = [];
  rows: readonly VarendoDataRecord[] = [];
  columns: readonly VarendoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  groupLabel = 'Group';
  metricLabel = 'Metric';
  result: ResultRef | undefined;
  scope: VarendoDataScope | undefined;
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Breakdown';
  selectedGroup = '';
  protected override render() {
    const current = status(this.status);
    const groups = bounded(this.groups, MAX_BREAKDOWN_GROUPS);
    const tableColumns: readonly VarendoTableColumn[] = [
      { key: 'group', label: this.groupLabel },
      { key: 'metric', label: this.metricLabel },
      { key: 'records', label: 'Records' },
    ];
    const tableRows: readonly VarendoTableRow[] = groups.map((group) => ({
      groupKey: group.key,
      group: group.label,
      metric: group.displayValue ?? tableCell(group.value),
      records: group.recordCount === undefined ? 'Not available' : group.recordCount,
    }));
    const selectedKey = this.selectedGroup.length > 0 ? stableDataValueKey(this.selectedGroup) : undefined;
    return html`
      <section part="root" data-status=${current} aria-label=${this.title}>
        <div part="header">
          <h2>${this.title}</h2>
          ${this.scope ? html`<span part="scope">${this.scopeLabel(this.scope)}</span>` : nothing}
        </div>
        <div part="table">
          <varendo-table
            data-reflow="stack"
            .caption=${`${this.title}: grouped ${this.entity} data`}
            .columns=${tableColumns}
            .rows=${tableRows}
            .identity=${['groupKey']}
            .selectedKeys=${selectedKey ? [selectedKey] : []}
            .selection=${'single'}
            .result=${this.result}
            .scope=${this.scope}
            status=${current}
            @varendo-table-selection=${this.forwardGroupSelection}
          ></varendo-table>
        </div>
        ${this.groups.length > groups.length ? html`<p part="hint">Showing a bounded group window.</p>` : nothing}
        ${
          this.selectedGroup
            ? html`<section part="detail" aria-label="Contributing records">
                <h3>Contributing records</h3>
                <varendo-record-list
                  .rows=${this.rows}
                  .columns=${this.columns}
                  .identity=${this.identity}
                  .entity=${this.entity}
                  .result=${this.result}
                  .scope=${this.scope}
                  selection="none"
                ></varendo-record-list>
              </section>`
            : nothing
        }
        ${current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
      </section>
    `;
  }
  private readonly forwardGroupSelection = (raw: Event): void => {
    const detail = (raw as CustomEvent<VarendoSelectionDetail>).detail;
    if (!detail || detail.mode !== 'ids' || detail.keys.length === 0) return;
    const group = this.groups.find((candidate) => stableDataValueKey(candidate.key) === detail.keys[0]);
    if (group === undefined) return;
    this.dispatchEvent(
      event<VarendoBreakdownGroupDetail>('varendo-breakdown-group', {
        source: 'user',
        key: group.key,
        entity: this.entity,
        ...(this.result === undefined ? {} : { result: this.result }),
        ...(this.scope === undefined ? {} : { scope: this.scope }),
      }),
    );
  };
}
