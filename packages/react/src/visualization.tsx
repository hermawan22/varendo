import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoMatrixElement,
  VarendoTimelineElement,
  VarendoCalendarGridElement,
  type VarendoVisualizationSelectionEvent,
} from '@varendo/web/visualization';
export const VarendoMatrix = createComponent({
  react: React,
  tagName: 'varendo-matrix',
  elementClass: VarendoMatrixElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoMatrix',
});
export const VarendoTimeline = createComponent({
  react: React,
  tagName: 'varendo-timeline',
  elementClass: VarendoTimelineElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoTimeline',
});
export const VarendoCalendarGrid = createComponent({
  react: React,
  tagName: 'varendo-calendar-grid',
  elementClass: VarendoCalendarGridElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoCalendarGrid',
});
import {
  VarendoTrendElement,
  VarendoBarElement,
  VarendoAreaElement,
  VarendoScatterElement,
  VarendoHistogramElement,
  VarendoHeatmapElement,
} from '@varendo/web/visualization';
export const VarendoTrend = createComponent({
  react: React,
  tagName: 'varendo-trend',
  elementClass: VarendoTrendElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoTrend',
});
export const VarendoBar = createComponent({
  react: React,
  tagName: 'varendo-bar',
  elementClass: VarendoBarElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoBar',
});
export const VarendoArea = createComponent({
  react: React,
  tagName: 'varendo-area',
  elementClass: VarendoAreaElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoArea',
});
export const VarendoScatter = createComponent({
  react: React,
  tagName: 'varendo-scatter',
  elementClass: VarendoScatterElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoScatter',
});
export const VarendoHistogram = createComponent({
  react: React,
  tagName: 'varendo-histogram',
  elementClass: VarendoHistogramElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoHistogram',
});
export const VarendoHeatmap = createComponent({
  react: React,
  tagName: 'varendo-heatmap',
  elementClass: VarendoHeatmapElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoHeatmap',
});
import { VarendoTreeElement, VarendoTreemapElement, VarendoRelationshipElement } from '@varendo/web/visualization';
export const VarendoTree = createComponent({
  react: React,
  tagName: 'varendo-tree',
  elementClass: VarendoTreeElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoTree',
});
export const VarendoTreemap = createComponent({
  react: React,
  tagName: 'varendo-treemap',
  elementClass: VarendoTreemapElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoTreemap',
});
export const VarendoRelationship = createComponent({
  react: React,
  tagName: 'varendo-relationship',
  elementClass: VarendoRelationshipElement,
  events: { onSelectionChange: 'varendo-visualization-select' as EventName<VarendoVisualizationSelectionEvent> },
  displayName: 'VarendoRelationship',
});
