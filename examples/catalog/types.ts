import type { ResultRef } from '@varendo/core';

/** The finite public component names used by the current catalog example. */
export type CatalogExampleId =
  | 'button'
  | 'icon-button'
  | 'link'
  | 'text'
  | 'heading'
  | 'badge'
  | 'avatar'
  | 'separator'
  | 'surface'
  | 'stack'
  | 'grid'
  | 'split-pane'
  | 'scroll-area'
  | 'text-field'
  | 'text-area'
  | 'number-field'
  | 'checkbox'
  | 'radio-group'
  | 'switch'
  | 'select'
  | 'combobox'
  | 'date-field'
  | 'date-range'
  | 'slider'
  | 'search-field'
  | 'file-input'
  | 'field-group'
  | 'form'
  | 'tabs'
  | 'breadcrumb'
  | 'pagination'
  | 'menu'
  | 'tree-nav'
  | 'tooltip'
  | 'popover'
  | 'dialog'
  | 'drawer'
  | 'toast'
  | 'alert'
  | 'progress'
  | 'skeleton'
  | 'empty-state'
  | 'metric'
  | 'delta'
  | 'key-value'
  | 'detail'
  | 'record-list'
  | 'card-collection'
  | 'table'
  | 'filter-builder'
  | 'selection-summary'
  | 'trend'
  | 'bar'
  | 'area'
  | 'scatter'
  | 'histogram'
  | 'heatmap'
  | 'matrix'
  | 'relationship'
  | 'tree'
  | 'treemap'
  | 'timeline'
  | 'calendar-grid'
  | 'explorer'
  | 'comparison'
  | 'breakdown'
  | 'investigation'
  | 'search-results'
  | 'record-editor'
  | 'form-flow'
  | 'quality-panel';

export type CatalogExampleFamily =
  'foundation' | 'input' | 'navigation' | 'feedback' | 'data' | 'visualization' | 'compound';
export type CatalogExampleState =
  'ready' | 'disabled' | 'read-only' | 'invalid' | 'pending' | 'loading' | 'empty' | 'partial' | 'stale' | 'error';

export interface CatalogExampleMetadata {
  readonly id: CatalogExampleId;
  readonly name: string;
  readonly family: CatalogExampleFamily;
  readonly description: string;
  readonly fixture: string;
  readonly props: readonly string[];
  readonly propsNotes: string;
  readonly states: readonly CatalogExampleState[];
  readonly keyboard: readonly string[];
  readonly events: readonly string[];
  readonly expectedOutcome: string;
  /** A copyable source snippet assembled from the exact executable mount function. */
  readonly source: string;
  readonly result?: ResultRef;
}

export type CatalogExampleCleanup = () => void;
export type CatalogExampleMount = (container: HTMLElement) => CatalogExampleCleanup;

export interface CatalogExampleDefinition {
  readonly metadata: CatalogExampleMetadata;
  readonly mount: CatalogExampleMount;
}
