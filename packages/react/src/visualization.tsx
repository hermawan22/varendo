import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoMatrixElement,
  AeliqoTimelineElement,
  AeliqoCalendarGridElement,
  type AeliqoVisualizationSelectionEvent,
} from '@varendo/web/visualization';
export const AeliqoMatrix = createComponent({
  react: React,
  tagName: 'aeliqo-matrix',
  elementClass: AeliqoMatrixElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoMatrix',
});
export const AeliqoTimeline = createComponent({
  react: React,
  tagName: 'aeliqo-timeline',
  elementClass: AeliqoTimelineElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoTimeline',
});
export const AeliqoCalendarGrid = createComponent({
  react: React,
  tagName: 'aeliqo-calendar-grid',
  elementClass: AeliqoCalendarGridElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoCalendarGrid',
});
import {
  AeliqoTrendElement,
  AeliqoBarElement,
  AeliqoAreaElement,
  AeliqoScatterElement,
  AeliqoHistogramElement,
  AeliqoHeatmapElement,
} from '@varendo/web/visualization';
export const AeliqoTrend = createComponent({
  react: React,
  tagName: 'aeliqo-trend',
  elementClass: AeliqoTrendElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoTrend',
});
export const AeliqoBar = createComponent({
  react: React,
  tagName: 'aeliqo-bar',
  elementClass: AeliqoBarElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoBar',
});
export const AeliqoArea = createComponent({
  react: React,
  tagName: 'aeliqo-area',
  elementClass: AeliqoAreaElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoArea',
});
export const AeliqoScatter = createComponent({
  react: React,
  tagName: 'aeliqo-scatter',
  elementClass: AeliqoScatterElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoScatter',
});
export const AeliqoHistogram = createComponent({
  react: React,
  tagName: 'aeliqo-histogram',
  elementClass: AeliqoHistogramElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoHistogram',
});
export const AeliqoHeatmap = createComponent({
  react: React,
  tagName: 'aeliqo-heatmap',
  elementClass: AeliqoHeatmapElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoHeatmap',
});
import { AeliqoTreeElement, AeliqoTreemapElement, AeliqoRelationshipElement } from '@varendo/web/visualization';
export const AeliqoTree = createComponent({
  react: React,
  tagName: 'aeliqo-tree',
  elementClass: AeliqoTreeElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoTree',
});
export const AeliqoTreemap = createComponent({
  react: React,
  tagName: 'aeliqo-treemap',
  elementClass: AeliqoTreemapElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoTreemap',
});
export const AeliqoRelationship = createComponent({
  react: React,
  tagName: 'aeliqo-relationship',
  elementClass: AeliqoRelationshipElement,
  events: { onSelectionChange: 'aeliqo-visualization-select' as EventName<AeliqoVisualizationSelectionEvent> },
  displayName: 'AeliqoRelationship',
});
