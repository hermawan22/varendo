import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoExplorerElement,
  VarendoComparisonElement,
  VarendoBreakdownElement,
  VarendoInvestigationElement,
  VarendoSearchResultsElement,
  VarendoRecordEditorElement,
  VarendoFormFlowElement,
  VarendoQualityPanelElement,
} from '@varendo/web/compound';
import type {
  VarendoBreakdownGroupDetail,
  VarendoComparisonSetDetail,
  VarendoFormFlowCommitDetail,
  VarendoFormFlowStepDetail,
  VarendoRecordEditorCancelDetail,
  VarendoRecordEditorSaveDetail,
} from '@varendo/web/compound';
import type { VarendoFilterChangeDetail, VarendoSelectionDetail } from '@varendo/web/data';
export const VarendoExplorer = createComponent({
  react: React,
  tagName: 'varendo-explorer',
  elementClass: VarendoExplorerElement,
  events: {
    onFilterChange: 'varendo-explorer-filter' as EventName<CustomEvent<VarendoFilterChangeDetail>>,
    onSelectionChange: 'varendo-explorer-selection' as EventName<CustomEvent<VarendoSelectionDetail>>,
  },
  displayName: 'VarendoExplorer',
});
export const VarendoComparison = createComponent({
  react: React,
  tagName: 'varendo-comparison',
  elementClass: VarendoComparisonElement,
  events: { onCompareSetChange: 'varendo-comparison-set' as EventName<CustomEvent<VarendoComparisonSetDetail>> },
  displayName: 'VarendoComparison',
});
export const VarendoBreakdown = createComponent({
  react: React,
  tagName: 'varendo-breakdown',
  elementClass: VarendoBreakdownElement,
  events: { onGroupChange: 'varendo-breakdown-group' as EventName<CustomEvent<VarendoBreakdownGroupDetail>> },
  displayName: 'VarendoBreakdown',
});
export const VarendoInvestigation = createComponent({
  react: React,
  tagName: 'varendo-investigation',
  elementClass: VarendoInvestigationElement,
  events: {},
  displayName: 'VarendoInvestigation',
});
export const VarendoSearchResults = createComponent({
  react: React,
  tagName: 'varendo-search-results',
  elementClass: VarendoSearchResultsElement,
  events: { onSelectionChange: 'varendo-search-results-selection' as EventName<CustomEvent<VarendoSelectionDetail>> },
  displayName: 'VarendoSearchResults',
});
export const VarendoRecordEditor = createComponent({
  react: React,
  tagName: 'varendo-record-editor',
  elementClass: VarendoRecordEditorElement,
  events: {
    onSave: 'varendo-record-editor-save' as EventName<CustomEvent<VarendoRecordEditorSaveDetail>>,
    onCancel: 'varendo-record-editor-cancel' as EventName<CustomEvent<VarendoRecordEditorCancelDetail>>,
  },
  displayName: 'VarendoRecordEditor',
});
export const VarendoFormFlow = createComponent({
  react: React,
  tagName: 'varendo-form-flow',
  elementClass: VarendoFormFlowElement,
  events: {
    onStepChange: 'varendo-form-flow-step' as EventName<CustomEvent<VarendoFormFlowStepDetail>>,
    onCommit: 'varendo-form-flow-commit' as EventName<CustomEvent<VarendoFormFlowCommitDetail>>,
  },
  displayName: 'VarendoFormFlow',
});
export const VarendoQualityPanel = createComponent({
  react: React,
  tagName: 'varendo-quality-panel',
  elementClass: VarendoQualityPanelElement,
  events: {},
  displayName: 'VarendoQualityPanel',
});
