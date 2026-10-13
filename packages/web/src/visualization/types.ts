import type { ResultRef, Scalar, VisualizationSpec } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import type { PlotDataset } from '../plot/composition.js';
export type VisualizationDataset = PlotDataset;
export interface VisualizationRow {
  readonly identity: string;
  readonly values: Readonly<Record<string, Scalar>>;
}
/** Shared direct-input shape. Context and payloads are supplied by the authorized host. */
export interface VisualizationInputs {
  readonly visualization: VisualizationSpec | undefined;
  readonly context: VisualizationBindingContext;
  readonly datasets: readonly VisualizationDataset[];
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly maxMarks: number;
}
export interface VarendoVisualizationSelectionDetail {
  readonly source: 'user';
  readonly identity: string;
  readonly result: ResultRef;
}
export type VarendoVisualizationSelectionEvent = CustomEvent<VarendoVisualizationSelectionDetail>;
