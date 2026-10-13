import type { CatalogExampleId } from './types.js';

export const VISUALIZATION_MOUNT_SOURCES = {
  trend: String.raw`((root) => configure(createCatalogElement<VarendoTrendElement>("varendo-trend", root), catalogVisualizationSpecs.trend, catalogVisualizationContext))`,
  bar: String.raw`((root) => configure(createCatalogElement<VarendoBarElement>("varendo-bar", root), catalogVisualizationSpecs.bar, catalogVisualizationContext))`,
  area: String.raw`((root) => configure(createCatalogElement<VarendoAreaElement>("varendo-area", root), catalogVisualizationSpecs.area, catalogVisualizationContext))`,
  scatter: String.raw`((root) => configure(createCatalogElement<VarendoScatterElement>("varendo-scatter", root), catalogVisualizationSpecs.scatter, catalogVisualizationContext))`,
  histogram: String.raw`((root) => configure(createCatalogElement<VarendoHistogramElement>("varendo-histogram", root), histogramSpec, histogramContext))`,
  heatmap: String.raw`((root) => configure(createCatalogElement<VarendoHeatmapElement>("varendo-heatmap", root), catalogVisualizationSpecs.heatmap, catalogVisualizationContext))`,
  matrix: String.raw`((root) => configure(createCatalogElement<VarendoMatrixElement>("varendo-matrix", root), catalogTemporalSpecs.matrix, catalogVisualizationContext))`,
  relationship: String.raw`((root) => configure(createCatalogElement<VarendoRelationshipElement>("varendo-relationship", root), relationshipSpec, relationshipContext, [relationshipDataset]))`,
  tree: String.raw`((root) => configure(createCatalogElement<VarendoTreeElement>("varendo-tree", root), hierarchySpec, hierarchyContext, [hierarchyDataset]))`,
  treemap: String.raw`((root) => configure(createCatalogElement<VarendoTreemapElement>("varendo-treemap", root), treemapSpec, hierarchyContext, [hierarchyDataset]))`,
  timeline: String.raw`((root) => configure(createCatalogElement<VarendoTimelineElement>("varendo-timeline", root), catalogTemporalSpecs.timeline, catalogVisualizationContext))`,
  'calendar-grid': String.raw`((root) => configure(createCatalogElement<VarendoCalendarGridElement>("varendo-calendar-grid", root), catalogTemporalSpecs["calendar-grid"], catalogVisualizationContext))`,
} satisfies Partial<Record<CatalogExampleId, string>>;
