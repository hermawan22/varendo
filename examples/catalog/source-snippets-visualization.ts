import type { CatalogExampleId } from './types.js';

export const VISUALIZATION_MOUNT_SOURCES = {
  trend: String.raw`((root) => configure(createCatalogElement<AeliqoTrendElement>("aeliqo-trend", root), catalogVisualizationSpecs.trend, catalogVisualizationContext))`,
  bar: String.raw`((root) => configure(createCatalogElement<AeliqoBarElement>("aeliqo-bar", root), catalogVisualizationSpecs.bar, catalogVisualizationContext))`,
  area: String.raw`((root) => configure(createCatalogElement<AeliqoAreaElement>("aeliqo-area", root), catalogVisualizationSpecs.area, catalogVisualizationContext))`,
  scatter: String.raw`((root) => configure(createCatalogElement<AeliqoScatterElement>("aeliqo-scatter", root), catalogVisualizationSpecs.scatter, catalogVisualizationContext))`,
  histogram: String.raw`((root) => configure(createCatalogElement<AeliqoHistogramElement>("aeliqo-histogram", root), histogramSpec, histogramContext))`,
  heatmap: String.raw`((root) => configure(createCatalogElement<AeliqoHeatmapElement>("aeliqo-heatmap", root), catalogVisualizationSpecs.heatmap, catalogVisualizationContext))`,
  matrix: String.raw`((root) => configure(createCatalogElement<AeliqoMatrixElement>("aeliqo-matrix", root), catalogTemporalSpecs.matrix, catalogVisualizationContext))`,
  relationship: String.raw`((root) => configure(createCatalogElement<AeliqoRelationshipElement>("aeliqo-relationship", root), relationshipSpec, relationshipContext, [relationshipDataset]))`,
  tree: String.raw`((root) => configure(createCatalogElement<AeliqoTreeElement>("aeliqo-tree", root), hierarchySpec, hierarchyContext, [hierarchyDataset]))`,
  treemap: String.raw`((root) => configure(createCatalogElement<AeliqoTreemapElement>("aeliqo-treemap", root), treemapSpec, hierarchyContext, [hierarchyDataset]))`,
  timeline: String.raw`((root) => configure(createCatalogElement<AeliqoTimelineElement>("aeliqo-timeline", root), catalogTemporalSpecs.timeline, catalogVisualizationContext))`,
  'calendar-grid': String.raw`((root) => configure(createCatalogElement<AeliqoCalendarGridElement>("aeliqo-calendar-grid", root), catalogTemporalSpecs["calendar-grid"], catalogVisualizationContext))`,
} satisfies Partial<Record<CatalogExampleId, string>>;
