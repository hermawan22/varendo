import type { Result, VersionRef } from '@varendo/core';
import type { AeliqoAuthorizedDataBindings } from './data-presentation.js';
import type { AeliqoAuthorizedVisualizationBindings } from './visualization-registry.js';
import type { AeliqoFoundationBindings } from './foundation-registry.js';
import type { AeliqoInputBindings } from './input-registry-types.js';
import type { AeliqoNavigationFeedbackBindings } from './navigation-feedback-types.js';

export const MAX_ITEMS = 128;
export const MAX_LABEL = 160;

/** Trusted application-owned context used to bind wire proposals to data semantics. */
export interface AeliqoPresentationRegistryOptions {
  /** Reviewed static content/action/route bindings; changes require a new Experience revision. */
  readonly foundation?: AeliqoFoundationBindings;
  readonly inputs?: AeliqoInputBindings;
  readonly navigationFeedback?: AeliqoNavigationFeedbackBindings;
  /** Exact authorized materializations used to validate data-view field scope. */
  readonly data?: AeliqoAuthorizedDataBindings;
  readonly visualizations?: AeliqoAuthorizedVisualizationBindings;
  /** Resolve the entity represented by an authorized result. Never take this from presentation config. */
  readonly resolveEntity?: (result: Result) => string | undefined;
}

export const AELIQO_PRESENTATION_REFS = Object.freeze({
  stack: { id: 'layout.stack', revision: '1' },
  table: { id: 'data.table', revision: '1' },
  trend: { id: 'data.trend', revision: '1' },
  filter: { id: 'control.filter', revision: '1' },
} satisfies Record<string, VersionRef>);

export const AELIQO_CONFIG_SCHEMAS = Object.freeze({
  stack: { id: 'layout.stack.config', revision: '1' },
  table: { id: 'data.table.config', revision: '1' },
  trend: { id: 'data.trend.config', revision: '1' },
  filter: { id: 'control.filter.config', revision: '1' },
} satisfies Record<string, VersionRef>);

export const AELIQO_OPERATION_REFS = Object.freeze({
  read: { id: 'data.read', revision: '1' },
  selection: { id: 'interaction.selection', revision: '1' },
  filter: { id: 'data.filter', revision: '1' },
  range: { id: 'data.range', revision: '1' },
  compare: { id: 'data.compare', revision: '1' },
  analyze: { id: 'data.analyze', revision: '1' },
} satisfies Record<string, VersionRef>);
