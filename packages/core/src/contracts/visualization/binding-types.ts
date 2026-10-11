import type { BoundPlot } from '../plot/index.js';
import type { Catalog, FieldDefinition, MeaningDefinition, Result, ResultRef, VersionRef } from '../types.js';
import type { VisualizationSpec } from './types.js';

/** Trusted host declaration connecting an edge materialization to catalog entities. */
export interface VisualizationRelationshipBinding {
  readonly result: ResultRef;
  readonly relationship: VersionRef;
  readonly source: readonly string[];
  readonly target: readonly string[];
}

export interface VisualizationHistogramBinding {
  readonly result: ResultRef;
  readonly bins: Extract<VisualizationSpec, { readonly view: 'histogram' }>['bins'];
}

export interface VisualizationBindingContext {
  readonly results: readonly Result[];
  /** Authorized application Catalog; schema shape alone never grants access. */
  readonly catalog?: Catalog;
  readonly relationships?: readonly VisualizationRelationshipBinding[];
  readonly histograms?: readonly VisualizationHistogramBinding[];
}

export interface BoundVisualization {
  readonly spec: VisualizationSpec;
  readonly results: readonly Result[];
  readonly plot?: BoundPlot;
  readonly meaning?: MeaningDefinition;
  readonly relationship?: Catalog['relationships'][number];
}

export interface AuthorizedVisualizationContext {
  readonly results: ReadonlyMap<string, Result>;
  readonly catalog: Catalog | undefined;
}

export type VisualizationFieldMap = ReadonlyMap<string, FieldDefinition>;

export type PlotVisualizationSpec = Extract<VisualizationSpec, { readonly plot: unknown }>;

export type ResultVisualizationSpec = Exclude<VisualizationSpec, PlotVisualizationSpec>;
