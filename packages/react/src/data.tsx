import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoMetricElement,
  AeliqoDeltaElement,
  AeliqoKeyValueElement,
  AeliqoDetailElement,
  AeliqoRecordListElement,
  AeliqoCardCollectionElement,
  AeliqoSelectionSummaryElement,
  AeliqoFilterBuilderElement,
  AeliqoTableElement,
  type AeliqoDataSelectionEvent,
  type AeliqoDataLoadMoreEvent,
  type AeliqoFilterChangeEvent,
  type AeliqoTableSortEvent,
  type AeliqoTablePageEvent,
  type AeliqoTableWindowEvent,
} from '@varendo/web/data';
import type { AeliqoTableSelectionEvent } from '@varendo/web/events';
export const AeliqoMetric = createComponent({
  react: React,
  tagName: 'aeliqo-metric',
  elementClass: AeliqoMetricElement,
  events: {},
  displayName: 'AeliqoMetric',
});
export const AeliqoDelta = createComponent({
  react: React,
  tagName: 'aeliqo-delta',
  elementClass: AeliqoDeltaElement,
  events: {},
  displayName: 'AeliqoDelta',
});
export const AeliqoKeyValue = createComponent({
  react: React,
  tagName: 'aeliqo-key-value',
  elementClass: AeliqoKeyValueElement,
  events: {},
  displayName: 'AeliqoKeyValue',
});
export const AeliqoDetail = createComponent({
  react: React,
  tagName: 'aeliqo-detail',
  elementClass: AeliqoDetailElement,
  events: {},
  displayName: 'AeliqoDetail',
});
export const AeliqoRecordList = createComponent({
  react: React,
  tagName: 'aeliqo-record-list',
  elementClass: AeliqoRecordListElement,
  events: {
    onSelectionChange: 'aeliqo-record-list-selection' as EventName<AeliqoDataSelectionEvent>,
    onLoadMore: 'aeliqo-data-load-more' as EventName<AeliqoDataLoadMoreEvent>,
  },
  displayName: 'AeliqoRecordList',
});
export const AeliqoCardCollection = createComponent({
  react: React,
  tagName: 'aeliqo-card-collection',
  elementClass: AeliqoCardCollectionElement,
  events: {
    onSelectionChange: 'aeliqo-card-selection' as EventName<AeliqoDataSelectionEvent>,
    onLoadMore: 'aeliqo-data-load-more' as EventName<AeliqoDataLoadMoreEvent>,
  },
  displayName: 'AeliqoCardCollection',
});
export const AeliqoSelectionSummary = createComponent({
  react: React,
  tagName: 'aeliqo-selection-summary',
  elementClass: AeliqoSelectionSummaryElement,
  events: { onClear: 'aeliqo-selection-clear' as EventName<AeliqoDataSelectionEvent> },
  displayName: 'AeliqoSelectionSummary',
});
export const AeliqoFilterBuilder = createComponent({
  react: React,
  tagName: 'aeliqo-filter-builder',
  elementClass: AeliqoFilterBuilderElement,
  events: { onFilterChange: 'aeliqo-filter-change' as EventName<AeliqoFilterChangeEvent> },
  displayName: 'AeliqoFilterBuilder',
});
export const AeliqoTable = createComponent({
  react: React,
  tagName: 'aeliqo-table',
  elementClass: AeliqoTableElement,
  events: {
    onSelectionChange: 'aeliqo-table-selection' as EventName<AeliqoTableSelectionEvent>,
    onSortChange: 'aeliqo-table-sort' as EventName<AeliqoTableSortEvent>,
    onPageChange: 'aeliqo-table-page' as EventName<AeliqoTablePageEvent>,
    onWindowChange: 'aeliqo-table-window' as EventName<AeliqoTableWindowEvent>,
  },
  displayName: 'AeliqoTable',
});
