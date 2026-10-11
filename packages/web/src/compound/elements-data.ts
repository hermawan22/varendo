import { css, html, nothing } from 'lit';
import type { ResultRef } from '@varendo/core';
import { stableDataRecordKey, stableDataValueKey } from '../data/shared.js';
import type {
  AeliqoBreakdownGroup,
  AeliqoBreakdownGroupDetail,
  AeliqoComparisonMetric,
  AeliqoComparisonSetDetail,
  AeliqoCompoundStatus,
} from './types.js';
import type {
  AeliqoDataColumn,
  AeliqoDataRecord,
  AeliqoDataScope,
  AeliqoFieldOption,
  AeliqoFilterPredicate,
  AeliqoFilterChangeDetail,
  AeliqoSelectionDetail,
} from '../data/types.js';
import type { AeliqoTableColumn, AeliqoTableRow } from '../types.js';
import { AeliqoCompoundElement, aeliqoCompoundThemeStyles } from './base.js';
import {
  MAX_BREAKDOWN_GROUPS,
  MAX_COMPARISON_KEYS,
  MAX_COMPARISON_METRICS,
  bounded,
  event,
  status,
  tableCell,
} from './shared.js';

export class AeliqoExplorerElement extends AeliqoCompoundElement {
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
    ...aeliqoCompoundThemeStyles,
    css`
      [part='panels'] {
        display: grid;
        gap: var(--aeliqo-space-24, 1.5rem);
        grid-template-columns: minmax(12rem, 0.7fr) minmax(16rem, 1.3fr);
      }
      @media (max-width: 48rem) {
        [part='panels'] {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
  fields: readonly AeliqoFieldOption[] = [];
  predicate: AeliqoFilterPredicate | undefined;
  rows: readonly AeliqoDataRecord[] = [];
  columns: readonly AeliqoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  selectedKey = '';
  detailRecord: AeliqoDataRecord | undefined;
  detailFields: readonly AeliqoDataColumn[] = [];
  result: ResultRef | undefined;
  scope: AeliqoDataScope | undefined;
  status: AeliqoCompoundStatus = 'ready';
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
          <aeliqo-filter-builder
            .fields=${this.fields}
            .predicate=${this.predicate}
            .entity=${this.entity}
            .status=${current}
            @aeliqo-filter-change=${this.forwardFilter}
          ></aeliqo-filter-builder>
        </section>
        <section part="collection" aria-label=${this.collectionLabel}>
          <h3>${this.collectionLabel}</h3>
          <aeliqo-record-list
            .rows=${this.rows}
            .columns=${this.columns}
            .identity=${this.identity}
            .entity=${this.entity}
            .selectedKeys=${this.selectedKey ? [this.selectedKey] : []}
            .result=${this.result}
            .scope=${this.scope}
            .selection=${this.selection}
            .status=${current}
            @aeliqo-record-list-selection=${this.forwardSelection}
          ></aeliqo-record-list>
        </section>
        <section part="detail">
          <h3>${this.detailLabel}</h3>
          <aeliqo-detail
            .title=${this.detailLabel}
            .record=${detail}
            .fields=${this.detailFields.length ? this.detailFields : this.columns}
            .identity=${this.identity}
            .entity=${this.entity}
            .scope=${this.scope}
            .status=${current}
          ></aeliqo-detail>
        </section>
      </div>
      ${statusText ? html`<p part="status" role="status">${statusText}</p>` : nothing}
    </section>`;
  }
  private rowKey(row: AeliqoDataRecord): string | undefined {
    return stableDataRecordKey(row, this.identity);
  }
  private readonly forwardFilter = (raw: Event): void => {
    const detail = (raw as CustomEvent<AeliqoFilterChangeDetail>).detail;
    if (detail) this.dispatchEvent(event('aeliqo-explorer-filter', detail));
  };
  private readonly forwardSelection = (raw: Event): void => {
    const detail = (raw as CustomEvent<AeliqoSelectionDetail>).detail;
    if (detail) this.dispatchEvent(event('aeliqo-explorer-selection', detail));
  };
}

export class AeliqoComparisonElement extends AeliqoCompoundElement {
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
    ...aeliqoCompoundThemeStyles,
    css`
      [part='table'] {
        max-inline-size: 100%;
        overflow-x: auto;
      }
    `,
  ];
  compareKeys: readonly string[] = [];
  compareSet: readonly { readonly key: string; readonly label?: string }[] = [];
  metrics: readonly AeliqoComparisonMetric[] = [];
  entity = 'record';
  status: AeliqoCompoundStatus = 'ready';
  message = '';
  title = 'Comparison';
  result: ResultRef | undefined;
  scope: AeliqoDataScope | undefined;
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
    const columns: readonly AeliqoTableColumn[] = [
      { key: 'metric', label: 'Metric' },
      ...keys.map((key) => ({ key: `comparison:${key}`, label: labels.get(key) ?? key })),
    ];
    const rows: readonly AeliqoTableRow[] = metrics.map((metric) => ({
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
                <aeliqo-table
                  .caption=${`${this.title}: ${keys.length} ${this.entity}${keys.length === 1 ? '' : 's'}`}
                  .columns=${columns}
                  .rows=${rows}
                  .identity=${['metricId']}
                  .result=${this.result}
                  .scope=${this.scope}
                  status=${current}
                ></aeliqo-table>
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
      event<AeliqoComparisonSetDetail>('aeliqo-comparison-set', {
        source: 'user',
        entity: this.entity,
        keys: next,
        ...(this.result === undefined ? {} : { result: this.result }),
        ...(this.scope === undefined ? {} : { scope: this.scope }),
      }),
    );
  };
}

export class AeliqoBreakdownElement extends AeliqoCompoundElement {
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
    ...aeliqoCompoundThemeStyles,
    css`
      [part='table'] {
        max-inline-size: 100%;
        overflow-x: auto;
      }
    `,
  ];
  groups: readonly AeliqoBreakdownGroup[] = [];
  rows: readonly AeliqoDataRecord[] = [];
  columns: readonly AeliqoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  groupLabel = 'Group';
  metricLabel = 'Metric';
  result: ResultRef | undefined;
  scope: AeliqoDataScope | undefined;
  status: AeliqoCompoundStatus = 'ready';
  message = '';
  title = 'Breakdown';
  selectedGroup = '';
  protected override render() {
    const current = status(this.status);
    const groups = bounded(this.groups, MAX_BREAKDOWN_GROUPS);
    const tableColumns: readonly AeliqoTableColumn[] = [
      { key: 'group', label: this.groupLabel },
      { key: 'metric', label: this.metricLabel },
      { key: 'records', label: 'Records' },
    ];
    const tableRows: readonly AeliqoTableRow[] = groups.map((group) => ({
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
          <aeliqo-table
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
            @aeliqo-table-selection=${this.forwardGroupSelection}
          ></aeliqo-table>
        </div>
        ${this.groups.length > groups.length ? html`<p part="hint">Showing a bounded group window.</p>` : nothing}
        ${
          this.selectedGroup
            ? html`<section part="detail" aria-label="Contributing records">
                <h3>Contributing records</h3>
                <aeliqo-record-list
                  .rows=${this.rows}
                  .columns=${this.columns}
                  .identity=${this.identity}
                  .entity=${this.entity}
                  .result=${this.result}
                  .scope=${this.scope}
                  selection="none"
                ></aeliqo-record-list>
              </section>`
            : nothing
        }
        ${current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
      </section>
    `;
  }
  private readonly forwardGroupSelection = (raw: Event): void => {
    const detail = (raw as CustomEvent<AeliqoSelectionDetail>).detail;
    if (!detail || detail.mode !== 'ids' || detail.keys.length === 0) return;
    const group = this.groups.find((candidate) => stableDataValueKey(candidate.key) === detail.keys[0]);
    if (group === undefined) return;
    this.dispatchEvent(
      event<AeliqoBreakdownGroupDetail>('aeliqo-breakdown-group', {
        source: 'user',
        key: group.key,
        entity: this.entity,
        ...(this.result === undefined ? {} : { result: this.result }),
        ...(this.scope === undefined ? {} : { scope: this.scope }),
      }),
    );
  };
}
