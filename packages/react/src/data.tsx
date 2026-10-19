import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoMetricElement,
  VarendoDeltaElement,
  VarendoKeyValueElement,
  VarendoDetailElement,
  VarendoRecordListElement,
  VarendoCardCollectionElement,
  VarendoSelectionSummaryElement,
  VarendoFilterBuilderElement,
  VarendoTableElement,
  type VarendoDataSelectionEvent,
  type VarendoDataLoadMoreEvent,
  type VarendoFilterChangeEvent,
  type VarendoTableSortEvent,
  type VarendoTablePageEvent,
  type VarendoTableWindowEvent,
} from '@varendo/web/data';
import type { VarendoTableSelectionEvent } from '@varendo/web/events';
export const VarendoMetric = createComponent({
  react: React,
  tagName: 'varendo-metric',
  elementClass: VarendoMetricElement,
  events: {},
  displayName: 'VarendoMetric',
});
export const VarendoDelta = createComponent({
  react: React,
  tagName: 'varendo-delta',
  elementClass: VarendoDeltaElement,
  events: {},
  displayName: 'VarendoDelta',
});
export const VarendoKeyValue = createComponent({
  react: React,
  tagName: 'varendo-key-value',
  elementClass: VarendoKeyValueElement,
  events: {},
  displayName: 'VarendoKeyValue',
});
export const VarendoDetail = createComponent({
  react: React,
  tagName: 'varendo-detail',
  elementClass: VarendoDetailElement,
  events: {},
  displayName: 'VarendoDetail',
});
export const VarendoRecordList = createComponent({
  react: React,
  tagName: 'varendo-record-list',
  elementClass: VarendoRecordListElement,
  events: {
    onSelectionChange: 'varendo-record-list-selection' as EventName<VarendoDataSelectionEvent>,
    onLoadMore: 'varendo-data-load-more' as EventName<VarendoDataLoadMoreEvent>,
  },
  displayName: 'VarendoRecordList',
});
export const VarendoCardCollection = createComponent({
  react: React,
  tagName: 'varendo-card-collection',
  elementClass: VarendoCardCollectionElement,
  events: {
    onSelectionChange: 'varendo-card-selection' as EventName<VarendoDataSelectionEvent>,
    onLoadMore: 'varendo-data-load-more' as EventName<VarendoDataLoadMoreEvent>,
  },
  displayName: 'VarendoCardCollection',
});
export const VarendoSelectionSummary = createComponent({
  react: React,
  tagName: 'varendo-selection-summary',
  elementClass: VarendoSelectionSummaryElement,
  events: { onClear: 'varendo-selection-clear' as EventName<VarendoDataSelectionEvent> },
  displayName: 'VarendoSelectionSummary',
});
export const VarendoFilterBuilder = createComponent({
  react: React,
  tagName: 'varendo-filter-builder',
  elementClass: VarendoFilterBuilderElement,
  events: { onFilterChange: 'varendo-filter-change' as EventName<VarendoFilterChangeEvent> },
  displayName: 'VarendoFilterBuilder',
});
export const VarendoTable = createComponent({
  react: React,
  tagName: 'varendo-table',
  elementClass: VarendoTableElement,
  events: {
    onSelectionChange: 'varendo-table-selection' as EventName<VarendoTableSelectionEvent>,
    onSortChange: 'varendo-table-sort' as EventName<VarendoTableSortEvent>,
    onPageChange: 'varendo-table-page' as EventName<VarendoTablePageEvent>,
    onWindowChange: 'varendo-table-window' as EventName<VarendoTableWindowEvent>,
  },
  displayName: 'VarendoTable',
});
