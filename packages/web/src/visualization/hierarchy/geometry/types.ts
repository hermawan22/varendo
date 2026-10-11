import type { BoundVisualization } from '@varendo/core/visualization';
import type { Catalog, Result } from '@varendo/core';
import type { VisualizationRow } from '../../types.js';

export interface HierarchyGeometryOptions {
  readonly width?: number;
  readonly height?: number;
  readonly maxMarks?: number;
  readonly maxDepth?: number;
}

export interface HierarchyNodeGeometry {
  readonly identity: string;
  readonly rowIdentity: string;
  readonly label: string;
  readonly parentIdentity?: string;
  readonly depth: number;
  readonly children: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value?: number;
  readonly leaf: boolean;
}

export interface HierarchyGeometry {
  readonly kind: 'tree' | 'treemap';
  readonly state: 'geometry' | 'data-only';
  readonly reason?: string;
  readonly bound: BoundVisualization;
  readonly result: Result;
  readonly rows: readonly VisualizationRow[];
  readonly nodes: readonly HierarchyNodeGeometry[];
  readonly width: number;
  readonly height: number;
  readonly maxDepth: number;
  readonly leafValuePolicy?: 'leaf-only';
}

export interface RelationshipNodeGeometry {
  readonly identity: string;
  readonly namespace: 'source' | 'target';
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface RelationshipEdgeGeometry {
  readonly identity: string;
  readonly source: string;
  readonly target: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly label?: string;
}

export interface RelationshipGeometry {
  readonly kind: 'relationship';
  readonly state: 'geometry' | 'data-only';
  readonly reason?: string;
  readonly bound: BoundVisualization;
  readonly result: Result;
  readonly rows: readonly VisualizationRow[];
  readonly nodes: readonly RelationshipNodeGeometry[];
  readonly edges: readonly RelationshipEdgeGeometry[];
  readonly width: number;
  readonly height: number;
  readonly cardinality: Catalog['relationships'][number]['cardinality'];
}

export type HierarchyVisualizationGeometry = HierarchyGeometry | RelationshipGeometry;
