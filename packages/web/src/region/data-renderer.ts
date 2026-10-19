import { html, nothing, type TemplateResult } from 'lit';
import type { VarendoKeyValueItem } from '../data/key-value.js';
import type { VarendoDataStatus } from '../data/types.js';
import type { VarendoDataResolvedNode } from './data-registry.js';
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
import type { VarendoDataRenderContext } from './data-renderer-types.js';

export type {
  VarendoDataHostRequest,
  VarendoDataHostRequestHandler,
  VarendoDataRenderContext,
} from './data-renderer-types.js';

function metricTemplate(node: VarendoDataResolvedNode, status: VarendoDataStatus): TemplateResult {
  const field = node.config.metricField ?? node.config.fields[0] ?? '';
  const descriptor = node.result.fields.find((candidate) => candidate.id === field);
  return html`<varendo-metric
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .label=${descriptor?.label ?? field}
    .value=${node.config.selectedRow?.[field]}
    .unit=${descriptor?.type.unit?.symbol ?? ''}
    .scope=${node.scope}
    .status=${status}
  ></varendo-metric>`;
}

function deltaTemplate(node: VarendoDataResolvedNode, status: VarendoDataStatus): TemplateResult {
  const delta = node.config.delta;
  const current = delta?.currentRow[delta.currentField];
  const baseline = delta?.baselineRow[delta.baselineField];
  const mode = delta?.mode ?? 'absolute';
  const currentField = node.result.fields.find((field) => field.id === delta?.currentField);
  return html`<varendo-delta
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .label=${text(node.config.values.label, 'Change')}
    .current=${current}
    .baseline=${baseline}
    .mode=${mode}
    .compatible=${true}
    .unit=${currentField?.type.unit?.symbol ?? ''}
    .scope=${node.scope}
    .status=${status}
  ></varendo-delta>`;
}

function keyValueTemplate(node: VarendoDataResolvedNode, status: VarendoDataStatus): TemplateResult {
  const row = node.config.selectedRow;
  const rawItems = Array.isArray(node.config.values.items) ? node.config.values.items : [];
  const items: VarendoKeyValueItem[] = node.config.fields.map((field) => {
    const raw = record(rawItems.find((item) => record(item)?.field === field));
    const descriptor = node.result.fields.find((candidate) => candidate.id === field);
    const item: VarendoKeyValueItem = {
      key: field,
      label: descriptor?.label ?? field,
      ...(row?.[field] === undefined ? {} : { value: row[field] }),
      ...(raw?.description === undefined ? {} : { description: text(raw.description) }),
      ...(raw?.displayValue === undefined ? {} : { displayValue: text(raw.displayValue) }),
      ...(raw?.href === undefined ? {} : { href: text(raw.href) }),
    };
    return item;
  });
  return html`<varendo-key-value
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .items=${items}
    .scope=${node.scope}
    .status=${status}
  ></varendo-key-value>`;
}

function detailTemplate(node: VarendoDataResolvedNode, status: VarendoDataStatus): TemplateResult {
  const entity = selectionPort(node)?.entity ?? text(node.config.values.entity, 'record');
  return html`<varendo-detail
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .record=${node.config.detailRow ?? node.config.selectedRow}
    .fields=${node.columns}
    .identity=${node.config.identity}
    .entity=${entity}
    .title=${text(node.config.values.title, 'Details')}
    .showIdentity=${node.config.values.showIdentity === true}
    .scope=${node.scope}
    .status=${status}
  ></varendo-detail>`;
}

function collectionTemplate(
  node: VarendoDataResolvedNode,
  status: VarendoDataStatus,
  context: VarendoDataRenderContext,
  component: 'record-list' | 'card-collection' | 'table',
): TemplateResult {
  const entity = selectionPort(node)?.entity ?? 'record';
  const selected = selectedKeys(node, context.interaction);
  const result = node.result.ref;
  const selection = node.config.selection;
  if (component === 'record-list')
    return html`<varendo-record-list
      data-varendo-node-id=${node.id}
      data-varendo-theme="inherit"
      .rows=${node.rows}
      .columns=${node.columns}
      .identity=${node.config.identity}
      .entity=${entity}
      .selection=${selection}
      .selectedKeys=${selected}
      .result=${result}
      .scope=${node.scope}
      .status=${status}
      @varendo-record-list-selection=${(event: Event) => dispatchSelection(node, event, context)}
    ></varendo-record-list>`;
  if (component === 'card-collection') {
    const more = hasMore(node);
    return html`<varendo-card-collection
      data-varendo-node-id=${node.id}
      data-varendo-theme="inherit"
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
      @varendo-card-selection=${(event: Event) => dispatchSelection(node, event, context)}
      @varendo-data-load-more=${(event: Event) => dispatchLoadMore(node, event, context)}
    ></varendo-card-collection>`;
  }
  const mode = node.config.values.mode === 'grid' ? 'grid' : 'table';
  const virtualStart =
    Number.isSafeInteger(node.config.values.virtualStart) && (node.config.values.virtualStart as number) >= 0
      ? (node.config.values.virtualStart as number)
      : 0;
  return html`<varendo-table
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
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
    @varendo-table-selection=${(event: Event) => dispatchSelection(node, event, context)}
    @varendo-table-page=${(event: Event) => dispatchPage(node, event, context)}
    @varendo-table-sort=${(event: Event) => dispatchSort(node, event, context)}
    @varendo-table-window=${(event: Event) => dispatchWindow(node, event, context)}
  ></varendo-table>`;
}

function filterTemplate(
  node: VarendoDataResolvedNode,
  status: VarendoDataStatus,
  context: VarendoDataRenderContext,
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
  return html`<varendo-filter-builder
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .fields=${fields}
    .predicate=${predicate}
    .inherited=${inherited}
    .scopeLabel=${text(node.config.values.scopeLabel, 'Current authorized scope')}
    .status=${status}
    @varendo-filter-change=${(event: Event) => dispatchFilter(node, event, context)}
  ></varendo-filter-builder>`;
}

function selectionTemplate(
  node: VarendoDataResolvedNode,
  status: VarendoDataStatus,
  context: VarendoDataRenderContext,
): TemplateResult {
  const summary = selectedSummary(node, context.interaction);
  const entity = selectionPort(node)?.entity ?? 'record';
  return html`<varendo-selection-summary
    data-varendo-node-id=${node.id}
    data-varendo-theme="inherit"
    .selectedKeys=${summary.keys}
    .selectionScope=${summary.scope}
    .entity=${entity}
    .result=${node.result.ref}
    .scope=${node.scope}
    .status=${status}
    .clearable=${node.config.values.clearable !== false}
    @varendo-selection-clear=${(event: Event) => dispatchSelection(node, event, context)}
  ></varendo-selection-summary>`;
}

/** Render one already validated data node using the shared owned data elements. */
export function renderVarendoDataNode(
  node: VarendoDataResolvedNode,
  context: VarendoDataRenderContext = {},
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
