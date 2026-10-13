import type { Result, VersionRef } from '@varendo/core';
import type { VarendoAuthorizedDataBindings } from './data-presentation.js';
import type { VarendoAuthorizedVisualizationBindings } from './visualization-registry.js';
import type { VarendoFoundationBindings } from './foundation-registry.js';
import type { VarendoInputBindings } from './input-registry-types.js';
import type { VarendoNavigationFeedbackBindings } from './navigation-feedback-types.js';

export const MAX_ITEMS = 128;
export const MAX_LABEL = 160;

/** Trusted application-owned context used to bind wire proposals to data semantics. */
export interface VarendoPresentationRegistryOptions {
  /** Reviewed static content/action/route bindings; changes require a new Experience revision. */
  readonly foundation?: VarendoFoundationBindings;
  readonly inputs?: VarendoInputBindings;
  readonly navigationFeedback?: VarendoNavigationFeedbackBindings;
  /** Exact authorized materializations used to validate data-view field scope. */
  readonly data?: VarendoAuthorizedDataBindings;
  readonly visualizations?: VarendoAuthorizedVisualizationBindings;
  /** Resolve the entity represented by an authorized result. Never take this from presentation config. */
  readonly resolveEntity?: (result: Result) => string | undefined;
}

export const VARENDO_PRESENTATION_REFS = Object.freeze({
  stack: { id: 'layout.stack', revision: '1' },
  table: { id: 'data.table', revision: '1' },
  trend: { id: 'data.trend', revision: '1' },
  filter: { id: 'control.filter', revision: '1' },
} satisfies Record<string, VersionRef>);

export const VARENDO_CONFIG_SCHEMAS = Object.freeze({
  stack: { id: 'layout.stack.config', revision: '1' },
  table: { id: 'data.table.config', revision: '1' },
  trend: { id: 'data.trend.config', revision: '1' },
  filter: { id: 'control.filter.config', revision: '1' },
} satisfies Record<string, VersionRef>);

export const VARENDO_OPERATION_REFS = Object.freeze({
  read: { id: 'data.read', revision: '1' },
  selection: { id: 'interaction.selection', revision: '1' },
  filter: { id: 'data.filter', revision: '1' },
  range: { id: 'data.range', revision: '1' },
  compare: { id: 'data.compare', revision: '1' },
  analyze: { id: 'data.analyze', revision: '1' },
} satisfies Record<string, VersionRef>);
