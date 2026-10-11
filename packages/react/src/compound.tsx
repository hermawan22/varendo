import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoExplorerElement,
  AeliqoComparisonElement,
  AeliqoBreakdownElement,
  AeliqoInvestigationElement,
  AeliqoSearchResultsElement,
  AeliqoRecordEditorElement,
  AeliqoFormFlowElement,
  AeliqoQualityPanelElement,
} from '@varendo/web/compound';
import type {
  AeliqoBreakdownGroupDetail,
  AeliqoComparisonSetDetail,
  AeliqoFormFlowCommitDetail,
  AeliqoFormFlowStepDetail,
  AeliqoRecordEditorCancelDetail,
  AeliqoRecordEditorSaveDetail,
} from '@varendo/web/compound';
import type { AeliqoFilterChangeDetail, AeliqoSelectionDetail } from '@varendo/web/data';
export const AeliqoExplorer = createComponent({
  react: React,
  tagName: 'aeliqo-explorer',
  elementClass: AeliqoExplorerElement,
  events: {
    onFilterChange: 'aeliqo-explorer-filter' as EventName<CustomEvent<AeliqoFilterChangeDetail>>,
    onSelectionChange: 'aeliqo-explorer-selection' as EventName<CustomEvent<AeliqoSelectionDetail>>,
  },
  displayName: 'AeliqoExplorer',
});
export const AeliqoComparison = createComponent({
  react: React,
  tagName: 'aeliqo-comparison',
  elementClass: AeliqoComparisonElement,
  events: { onCompareSetChange: 'aeliqo-comparison-set' as EventName<CustomEvent<AeliqoComparisonSetDetail>> },
  displayName: 'AeliqoComparison',
});
export const AeliqoBreakdown = createComponent({
  react: React,
  tagName: 'aeliqo-breakdown',
  elementClass: AeliqoBreakdownElement,
  events: { onGroupChange: 'aeliqo-breakdown-group' as EventName<CustomEvent<AeliqoBreakdownGroupDetail>> },
  displayName: 'AeliqoBreakdown',
});
export const AeliqoInvestigation = createComponent({
  react: React,
  tagName: 'aeliqo-investigation',
  elementClass: AeliqoInvestigationElement,
  events: {},
  displayName: 'AeliqoInvestigation',
});
export const AeliqoSearchResults = createComponent({
  react: React,
  tagName: 'aeliqo-search-results',
  elementClass: AeliqoSearchResultsElement,
  events: { onSelectionChange: 'aeliqo-search-results-selection' as EventName<CustomEvent<AeliqoSelectionDetail>> },
  displayName: 'AeliqoSearchResults',
});
export const AeliqoRecordEditor = createComponent({
  react: React,
  tagName: 'aeliqo-record-editor',
  elementClass: AeliqoRecordEditorElement,
  events: {
    onSave: 'aeliqo-record-editor-save' as EventName<CustomEvent<AeliqoRecordEditorSaveDetail>>,
    onCancel: 'aeliqo-record-editor-cancel' as EventName<CustomEvent<AeliqoRecordEditorCancelDetail>>,
  },
  displayName: 'AeliqoRecordEditor',
});
export const AeliqoFormFlow = createComponent({
  react: React,
  tagName: 'aeliqo-form-flow',
  elementClass: AeliqoFormFlowElement,
  events: {
    onStepChange: 'aeliqo-form-flow-step' as EventName<CustomEvent<AeliqoFormFlowStepDetail>>,
    onCommit: 'aeliqo-form-flow-commit' as EventName<CustomEvent<AeliqoFormFlowCommitDetail>>,
  },
  displayName: 'AeliqoFormFlow',
});
export const AeliqoQualityPanel = createComponent({
  react: React,
  tagName: 'aeliqo-quality-panel',
  elementClass: AeliqoQualityPanelElement,
  events: {},
  displayName: 'AeliqoQualityPanel',
});
