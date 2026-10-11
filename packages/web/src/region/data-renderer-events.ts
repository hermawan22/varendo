import type { InteractionPayload, ResultRef } from '@varendo/core';
import type {
  AeliqoFilterChangeDetail,
  AeliqoFilterPredicate,
  AeliqoPageRequest,
  AeliqoSortState,
  AeliqoTableWindowDetail,
} from '../data/types.js';
import type { AeliqoDataResolvedNode } from './data-registry.js';
import { allowedKeys } from './data-registry-common.js';
import type { AeliqoDataRenderContext } from './data-renderer-types.js';
import {
  eventDetail,
  eventType,
  exactKeys,
  exactRecord,
  hostOutput,
  port,
  record,
  resultRef,
  sameRef,
  selectionPort,
} from './data-renderer-shared.js';
import { hasMore, validKeys, validScopeDetail, validatePredicate } from './data-renderer-state.js';

const SELECTION_EVENT_TYPES = new Set([
  'aeliqo-record-list-selection',
  'aeliqo-card-selection',
  'aeliqo-table-selection',
  'aeliqo-selection-clear',
]);

interface SelectionEventDetail {
  readonly mode: 'clear' | 'ids';
  readonly entity: string;
  readonly keys: string[];
}

export function dispatchSelection(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (!isSelectionEvent(event)) return;
  const selection = selectionPort(node, true);
  if (selection === undefined) return;
  const detail = selectionEventDetail(node, event, context);
  if (detail === undefined || detail.entity !== selection.entity) return;
  if (detail.mode === 'clear') {
    emitClearSelection(node, selection.id, context);
    return;
  }
  emitIdsSelection(node, selection.id, detail, context);
}

function isSelectionEvent(event: Event): boolean {
  const type = eventType(event);
  return type !== undefined && SELECTION_EVENT_TYPES.has(type);
}

function selectionEventDetail(
  node: AeliqoDataResolvedNode,
  event: Event,
  context: AeliqoDataRenderContext,
): SelectionEventDetail | undefined {
  const detail = rawSelectionDetail(event);
  if (detail === undefined || !validScopeDetail(detail.scope, node)) return undefined;
  if (detail.mode === 'clear') return clearSelectionDetail(detail, node);
  return idsSelectionDetail(detail, node, context);
}

function rawSelectionDetail(event: Event): Record<string, unknown> | undefined {
  const detail = exactRecord(
    eventDetail(event),
    ['mode', 'entity', 'keys', 'result', 'scope'],
    ['mode', 'entity', 'keys'],
  );
  if (detail === undefined) return undefined;
  if (detail.mode !== 'clear' && detail.mode !== 'ids') return undefined;
  if (typeof detail.entity !== 'string' || !Array.isArray(detail.keys) || !exactKeys(detail.keys)) return undefined;
  return detail;
}

function clearSelectionDetail(
  detail: Record<string, unknown>,
  node: AeliqoDataResolvedNode,
): SelectionEventDetail | undefined {
  if ((detail.keys as string[]).length !== 0) return undefined;
  const hasResult = Object.hasOwn(detail, 'result');
  if (hasResult && !sameRef(detail.result as ResultRef, node.result.ref)) return undefined;
  return { mode: 'clear', entity: detail.entity as string, keys: [] };
}

function idsSelectionDetail(
  detail: Record<string, unknown>,
  node: AeliqoDataResolvedNode,
  context: AeliqoDataRenderContext,
): SelectionEventDetail | undefined {
  const result = resultRef(detail.result);
  const keys = detail.keys as string[];
  if (result === undefined || !sameRef(result, node.result.ref)) return undefined;
  if (!validKeys(node, keys, context.interaction, detail.entity as string)) return undefined;
  return { mode: 'ids', entity: detail.entity as string, keys };
}

function emitClearSelection(node: AeliqoDataResolvedNode, portId: string, context: AeliqoDataRenderContext): void {
  hostOutput(context)?.({
    kind: 'selection',
    nodeId: node.id,
    portId,
    payload: { kind: 'selection', selection: { mode: 'clear' } },
  });
}

function emitIdsSelection(
  node: AeliqoDataResolvedNode,
  portId: string,
  detail: SelectionEventDetail,
  context: AeliqoDataRenderContext,
): void {
  hostOutput(context)?.({
    kind: 'selection',
    nodeId: node.id,
    portId,
    payload: {
      kind: 'selection',
      selection: {
        mode: 'ids',
        entity: detail.entity,
        keys: [...detail.keys] as [string, ...string[]],
        result: node.result.ref,
      },
    },
  });
}

export function dispatchFilter(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (eventType(event) !== 'aeliqo-filter-change' || !port(node, 'filter', 'filter')) return;
  const detail = filterChangeDetail(event);
  if (detail === undefined || !validFilterDetail(detail, node)) return;
  const predicates: Extract<InteractionPayload, { readonly kind: 'filter' }>['predicates'] = filterPredicates(detail);
  hostOutput(context)?.({
    kind: 'filter',
    nodeId: node.id,
    portId: 'filter',
    payload: { kind: 'filter', predicates, outputId: node.result.ref.outputId },
  });
}

function filterChangeDetail(event: Event): AeliqoFilterChangeDetail | undefined {
  return exactRecord(eventDetail(event), ['predicate', 'inherited', 'scopeLabel', 'applied'], ['applied']) as
    AeliqoFilterChangeDetail | undefined;
}

function validFilterDetail(detail: AeliqoFilterChangeDetail, node: AeliqoDataResolvedNode): boolean {
  if (detail.applied !== true) return false;
  if (Object.hasOwn(detail, 'scopeLabel') && detail.scopeLabel !== undefined && typeof detail.scopeLabel !== 'string')
    return false;
  if (detail.predicate !== undefined && !validatePredicate(detail.predicate, node)) return false;
  return detail.inherited === undefined || validatePredicate(detail.inherited, node);
}

function filterPredicates(
  detail: AeliqoFilterChangeDetail,
): Extract<InteractionPayload, { readonly kind: 'filter' }>['predicates'] {
  if (detail.predicate !== undefined && detail.inherited !== undefined) {
    return [{ op: 'and', predicates: [detail.inherited, detail.predicate] }];
  }
  const predicate = detail.predicate ?? detail.inherited;
  return predicate === undefined ? [] : [predicate as AeliqoFilterPredicate];
}

export function dispatchPage(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (eventType(event) !== 'aeliqo-table-page' || !port(node, 'page', 'page')) return;
  const request = pageRequest(event, node);
  if (request === undefined) return;
  hostOutput(context)?.({
    kind: 'page',
    nodeId: node.id,
    portId: 'page',
    request: { page: request.page, pageSize: request.pageSize, result: node.result.ref },
  });
}

function pageRequest(event: Event, node: AeliqoDataResolvedNode): AeliqoPageRequest | undefined {
  const detail = exactRecord(eventDetail(event), ['page', 'pageSize', 'result'], ['page', 'pageSize']);
  if (detail === undefined || !validPageValues(detail)) return undefined;
  if (
    Object.hasOwn(detail, 'result') &&
    detail.result !== undefined &&
    !sameRef(detail.result as ResultRef, node.result.ref)
  )
    return undefined;
  return {
    page: detail.page as number,
    pageSize: detail.pageSize as number,
    ...(Object.hasOwn(detail, 'result') && detail.result !== undefined ? { result: detail.result as ResultRef } : {}),
  };
}

function validPageValues(detail: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(detail.page) || (detail.page as number) < 1) return false;
  return Number.isSafeInteger(detail.pageSize) && (detail.pageSize as number) >= 1;
}

export function dispatchSort(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (eventType(event) !== 'aeliqo-table-sort' || !supportsSorting(node)) return;
  const detail = exactRecord(eventDetail(event), ['sort'], ['sort']);
  if (detail === undefined || !validSortValue(detail.sort, node)) return;
  hostOutput(context)?.({
    kind: 'sort',
    nodeId: node.id,
    portId: 'sort',
    request: sortRequest(detail.sort),
  });
}

function supportsSorting(node: AeliqoDataResolvedNode): boolean {
  return node.component === 'table' && node.columns.some((column) => column.sortable === true);
}

function validSortValue(value: unknown, node: AeliqoDataResolvedNode): boolean {
  if (value === undefined) return true;
  const sort = record(value);
  if (sort === undefined || !onlySortKeys(sort)) return false;
  if (typeof sort.field !== 'string' || (sort.direction !== 'asc' && sort.direction !== 'desc')) return false;
  return node.columns.some((column) => column.key === sort.field && column.sortable === true);
}

function onlySortKeys(sort: Record<string, unknown>): boolean {
  return allowedKeys(sort, ['field', 'direction']);
}

function sortRequest(value: unknown): AeliqoSortState | undefined {
  if (value === undefined) return undefined;
  const sort = record(value);
  if (sort === undefined || typeof sort.field !== 'string') return undefined;
  return { field: sort.field, direction: sort.direction as 'asc' | 'desc' };
}

export function dispatchWindow(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (eventType(event) !== 'aeliqo-table-window' || !supportsWindow(node)) return;
  const request = windowRequest(event, node);
  if (request === undefined) return;
  hostOutput(context)?.({ kind: 'window', nodeId: node.id, portId: 'window', request });
}

function supportsWindow(node: AeliqoDataResolvedNode): boolean {
  return node.component === 'table' && node.config.values.virtualized === true && node.config.values.mode === 'grid';
}

function windowRequest(event: Event, node: AeliqoDataResolvedNode): AeliqoTableWindowDetail | undefined {
  const detail = exactRecord(
    eventDetail(event),
    ['start', 'count', 'overscan', 'row', 'column', 'reason', 'result'],
    ['start', 'count', 'overscan', 'row', 'column', 'reason'],
  );
  if (detail === undefined || !validWindowValues(detail)) return undefined;
  if (
    Object.hasOwn(detail, 'result') &&
    detail.result !== undefined &&
    !sameRef(detail.result as ResultRef, node.result.ref)
  )
    return undefined;
  return {
    start: detail.start as number,
    count: detail.count as number,
    overscan: detail.overscan as number,
    row: detail.row as number,
    column: detail.column as number,
    reason: 'keyboard',
    result: node.result.ref,
  };
}

function validWindowValues(detail: Record<string, unknown>): boolean {
  if (detail.reason !== 'keyboard') return false;
  return (
    nonnegativeInteger(detail.start) &&
    positiveInteger(detail.count) &&
    nonnegativeInteger(detail.overscan) &&
    nonnegativeInteger(detail.row) &&
    nonnegativeInteger(detail.column)
  );
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function dispatchLoadMore(node: AeliqoDataResolvedNode, event: Event, context: AeliqoDataRenderContext): void {
  if (eventType(event) !== 'aeliqo-data-load-more' || node.component !== 'cardCollection' || !hasMore(node)) return;
  const detail = exactRecord(eventDetail(event), ['requested'], ['requested']);
  if (detail?.requested !== true) return;
  hostOutput(context)?.({ kind: 'load-more', nodeId: node.id, portId: 'load-more' });
}
