import type { Diagnostic, ResultRef, VisualizationSpec } from '@varendo/core';
import type { BoundVisualization } from '@varendo/core/visualization';
import type { CompiledPlot } from '../../plot/composition.js';

export type CartesianView = Extract<
  VisualizationSpec['view'],
  'trend' | 'bar' | 'area' | 'scatter' | 'histogram' | 'heatmap'
>;

export type CartesianState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'ready'; readonly bound: BoundVisualization; readonly compiled: CompiledPlot };

export interface CartesianRenderContext {
  readonly state: CartesianState;
  readonly expectedView: CartesianView;
  readonly label: string;
  readonly width: number;
  readonly page: number;
  readonly selectionEnabled: boolean;
  readonly isSelected: (identity: string, result: ResultRef) => boolean;
  readonly select: (identity: string, result: ResultRef) => void;
  readonly setPage: (page: number) => void;
}
