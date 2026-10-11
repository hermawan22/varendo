import { html, nothing, type TemplateResult } from 'lit';
import type { AeliqoKeyValueItem } from '../data/key-value.js';
import type { AeliqoDataStatus } from '../data/types.js';
import type { AeliqoDataResolvedNode } from './data-registry.js';
import { record, selectionPort, statusFor, text } from './data-renderer-shared.js';
import { configuredPredicate, currentFilter, selectedKeys, selectedSummary } from './data-renderer-state.js';
import {
  dispatchFilter,
  dispatchLoadMore,
  dispatchPage,
  dispatchSelection,
  dispatchSort,
  dispatchWindow,
} from './data-renderer-events.js';
import { hasMore } from './data-renderer-state.js';
import type { AeliqoDataRenderContext } from './data-renderer-types.js';

export type {
  AeliqoDataHostRequest,
  AeliqoDataHostRequestHandler,
  AeliqoDataRenderContext,
} from './data-renderer-types.js';

function metricTemplate(node: AeliqoDataResolvedNode, status: AeliqoDataStatus): TemplateResult {
  const field = node.config.metricField ?? node.config.fields[0] ?? '';
  const descriptor = node.result.fields.find((candidate) => candidate.id === field);
  return html`<aeliqo-metric
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .label=${descriptor?.label ?? field}
    .value=${node.config.selectedRow?.[field]}
    .unit=${descriptor?.type.unit?.symbol ?? ''}
    .scope=${node.scope}
    .status=${status}
  ></aeliqo-metric>`;
}

function deltaTemplate(node: AeliqoDataResolvedNode, status: AeliqoDataStatus): TemplateResult {
  const delta = node.config.delta;
  const current = delta?.currentRow[delta.currentField];
  const baseline = delta?.baselineRow[delta.baselineField];
  const mode = delta?.mode ?? 'absolute';
  const currentField = node.result.fields.find((field) => field.id === delta?.currentField);
  return html`<aeliqo-delta
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .label=${text(node.config.values.label, 'Change')}
    .current=${current}
    .baseline=${baseline}
    .mode=${mode}
    .compatible=${true}
    .unit=${currentField?.type.unit?.symbol ?? ''}
    .scope=${node.scope}
    .status=${status}
  ></aeliqo-delta>`;
}

function keyValueTemplate(node: AeliqoDataResolvedNode, status: AeliqoDataStatus): TemplateResult {
  const row = node.config.selectedRow;
  const rawItems = Array.isArray(node.config.values.items) ? node.config.values.items : [];
  const items: AeliqoKeyValueItem[] = node.config.fields.map((field) => {
    const raw = record(rawItems.find((item) => record(item)?.field === field));
    const descriptor = node.result.fields.find((candidate) => candidate.id === field);
    const item: AeliqoKeyValueItem = {
      key: field,
      label: descriptor?.label ?? field,
      ...(row?.[field] === undefined ? {} : { value: row[field] }),
      ...(raw?.description === undefined ? {} : { description: text(raw.description) }),
      ...(raw?.displayValue === undefined ? {} : { displayValue: text(raw.displayValue) }),
      ...(raw?.href === undefined ? {} : { href: text(raw.href) }),
    };
    return item;
  });
  return html`<aeliqo-key-value
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .items=${items}
    .scope=${node.scope}
    .status=${status}
  ></aeliqo-key-value>`;
}

function detailTemplate(node: AeliqoDataResolvedNode, status: AeliqoDataStatus): TemplateResult {
  const entity = selectionPort(node)?.entity ?? text(node.config.values.entity, 'record');
  return html`<aeliqo-detail
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .record=${node.config.detailRow ?? node.config.selectedRow}
    .fields=${node.columns}
    .identity=${node.config.identity}
    .entity=${entity}
    .title=${text(node.config.values.title, 'Details')}
    .showIdentity=${node.config.values.showIdentity === true}
    .scope=${node.scope}
    .status=${status}
  ></aeliqo-detail>`;
}

function collectionTemplate(
  node: AeliqoDataResolvedNode,
  status: AeliqoDataStatus,
  context: AeliqoDataRenderContext,
  component: 'record-list' | 'card-collection' | 'table',
): TemplateResult {
  const entity = selectionPort(node)?.entity ?? 'record';
  const selected = selectedKeys(node, context.interaction);
  const result = node.result.ref;
  const selection = node.config.selection;
  if (component === 'record-list')
    return html`<aeliqo-record-list
      data-aeliqo-node-id=${node.id}
      data-aeliqo-theme="inherit"
      .rows=${node.rows}
      .columns=${node.columns}
      .identity=${node.config.identity}
      .entity=${entity}
      .selection=${selection}
      .selectedKeys=${selected}
      .result=${result}
      .scope=${node.scope}
      .status=${status}
      @aeliqo-record-list-selection=${(event: Event) => dispatchSelection(node, event, context)}
    ></aeliqo-record-list>`;
  if (component === 'card-collection') {
    const more = hasMore(node);
    return html`<aeliqo-card-collection
      data-aeliqo-node-id=${node.id}
      data-aeliqo-theme="inherit"
      .rows=${node.rows}
      .columns=${node.columns}
      .identity=${node.config.identity}
      .headingKey=${text(node.config.values.headingKey)}
      .entity=${entity}
      .selection=${selection}
      .selectedKeys=${selected}
      .result=${result}
      .scope=${node.scope}
      .status=${status}
      .hasMore=${more}
      .loadingMore=${false}
      @aeliqo-card-selection=${(event: Event) => dispatchSelection(node, event, context)}
      @aeliqo-data-load-more=${(event: Event) => dispatchLoadMore(node, event, context)}
    ></aeliqo-card-collection>`;
  }
  const mode = node.config.values.mode === 'grid' ? 'grid' : 'table';
  const virtualStart =
    Number.isSafeInteger(node.config.values.virtualStart) && (node.config.values.virtualStart as number) >= 0
      ? (node.config.values.virtualStart as number)
      : 0;
  return html`<aeliqo-table
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .columns=${node.columns}
    .rows=${node.rows}
    .identity=${node.config.identity}
    .entity=${entity}
    .selection=${selection}
    .selectedKeys=${selected}
    .result=${result}
    .mode=${mode}
    .virtualized=${node.config.values.virtualized === true}
    .virtualStart=${virtualStart}
    .scope=${node.scope}
    .status=${status}
    .totalRows=${node.scope.filteredTotal ?? node.scope.populationTotal}
    @aeliqo-table-selection=${(event: Event) => dispatchSelection(node, event, context)}
    @aeliqo-table-page=${(event: Event) => dispatchPage(node, event, context)}
    @aeliqo-table-sort=${(event: Event) => dispatchSort(node, event, context)}
    @aeliqo-table-window=${(event: Event) => dispatchWindow(node, event, context)}
  ></aeliqo-table>`;
}

function filterTemplate(
  node: AeliqoDataResolvedNode,
  status: AeliqoDataStatus,
  context: AeliqoDataRenderContext,
): TemplateResult {
  const fields = node.result.fields
    .filter((field) => node.config.fields.includes(field.id))
    .map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type.value,
      nullable: field.type.nullable,
      semanticType: field.type,
    }));
  const current = currentFilter(node, context.interaction);
  const predicate = current === undefined ? configuredPredicate(node, 'predicate') : current.predicate;
  const inherited = configuredPredicate(node, 'inherited');
  return html`<aeliqo-filter-builder
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .fields=${fields}
    .predicate=${predicate}
    .inherited=${inherited}
    .scopeLabel=${text(node.config.values.scopeLabel, 'Current authorized scope')}
    .status=${status}
    @aeliqo-filter-change=${(event: Event) => dispatchFilter(node, event, context)}
  ></aeliqo-filter-builder>`;
}

function selectionTemplate(
  node: AeliqoDataResolvedNode,
  status: AeliqoDataStatus,
  context: AeliqoDataRenderContext,
): TemplateResult {
  const summary = selectedSummary(node, context.interaction);
  const entity = selectionPort(node)?.entity ?? 'record';
  return html`<aeliqo-selection-summary
    data-aeliqo-node-id=${node.id}
    data-aeliqo-theme="inherit"
    .selectedKeys=${summary.keys}
    .selectionScope=${summary.scope}
    .entity=${entity}
    .result=${node.result.ref}
    .scope=${node.scope}
    .status=${status}
    .clearable=${node.config.values.clearable !== false}
    @aeliqo-selection-clear=${(event: Event) => dispatchSelection(node, event, context)}
  ></aeliqo-selection-summary>`;
}

/** Render one already validated data node using the shared owned data elements. */
export function renderAeliqoDataNode(
  node: AeliqoDataResolvedNode,
  context: AeliqoDataRenderContext = {},
): TemplateResult | typeof nothing {
  const status = statusFor(node);
  switch (node.component) {
    case 'metric':
      return metricTemplate(node, status);
    case 'delta':
      return deltaTemplate(node, status);
    case 'keyValue':
      return keyValueTemplate(node, status);
    case 'detail':
      return detailTemplate(node, status);
    case 'recordList':
      return collectionTemplate(node, status, context, 'record-list');
    case 'cardCollection':
      return collectionTemplate(node, status, context, 'card-collection');
    case 'table':
      return collectionTemplate(node, status, context, 'table');
    case 'filterBuilder':
      return filterTemplate(node, status, context);
    case 'selectionSummary':
      return selectionTemplate(node, status, context);
  }
}
