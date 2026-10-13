import { registerVarendoElements } from '@varendo/web';
import { compoundExamples } from './compound.js';
import { dataExamples } from './data.js';
import { feedbackExamples } from './feedback.js';
import { foundationExamples } from './foundation.js';
import { inputExamples } from './input.js';
import { navigationExamples } from './navigation.js';
import { visualizationExamples } from './visualization.js';
import type {
  CatalogExampleDefinition,
  CatalogExampleId,
  CatalogExampleMetadata,
  CatalogExampleMount,
} from './types.js';

export * from './fixture.js';
export * from './types.js';
export {
  compoundExamples,
  dataExamples,
  feedbackExamples,
  foundationExamples,
  inputExamples,
  navigationExamples,
  visualizationExamples,
};

export const CATALOG_EXAMPLE_IDS = [
  'button',
  'icon-button',
  'link',
  'text',
  'heading',
  'badge',
  'avatar',
  'separator',
  'surface',
  'stack',
  'grid',
  'split-pane',
  'scroll-area',
  'text-field',
  'text-area',
  'number-field',
  'checkbox',
  'radio-group',
  'switch',
  'select',
  'combobox',
  'date-field',
  'date-range',
  'slider',
  'search-field',
  'file-input',
  'field-group',
  'form',
  'tabs',
  'breadcrumb',
  'pagination',
  'menu',
  'tree-nav',
  'tooltip',
  'popover',
  'dialog',
  'drawer',
  'toast',
  'alert',
  'progress',
  'skeleton',
  'empty-state',
  'metric',
  'delta',
  'key-value',
  'detail',
  'record-list',
  'card-collection',
  'table',
  'filter-builder',
  'selection-summary',
  'trend',
  'bar',
  'area',
  'scatter',
  'histogram',
  'heatmap',
  'matrix',
  'relationship',
  'tree',
  'treemap',
  'timeline',
  'calendar-grid',
  'explorer',
  'comparison',
  'breakdown',
  'investigation',
  'search-results',
  'record-editor',
  'form-flow',
  'quality-panel',
] as const satisfies readonly CatalogExampleId[];

const definitions: readonly CatalogExampleDefinition[] = [
  ...foundationExamples,
  ...inputExamples,
  ...navigationExamples,
  ...feedbackExamples,
  ...dataExamples,
  ...visualizationExamples,
  ...compoundExamples,
];

const byId = new Map<CatalogExampleId, CatalogExampleDefinition>(
  definitions.map((definition) => [definition.metadata.id, definition]),
);

if (
  definitions.length !== CATALOG_EXAMPLE_IDS.length ||
  new Set(definitions.map((definition) => definition.metadata.id)).size !== CATALOG_EXAMPLE_IDS.length
) {
  throw new Error('Catalog examples must contain exactly one executable entry for every public component.');
}
for (const id of CATALOG_EXAMPLE_IDS) {
  if (!byId.has(id)) throw new Error(`Missing catalog example: ${id}`);
}

export const catalogExamples: readonly CatalogExampleMetadata[] = CATALOG_EXAMPLE_IDS.map(
  (id) => byId.get(id)!.metadata,
);

/** Lookup an executable example without mounting it. */
export function getCatalogExample(id: CatalogExampleId): CatalogExampleDefinition {
  const definition = byId.get(id);
  if (definition === undefined) throw new Error(`Unknown catalog example: ${id}`);
  return definition;
}

/** Mount one real web component example into an application-owned container. */
export function catalogExample(id: CatalogExampleId, container: HTMLElement): ReturnType<CatalogExampleMount> {
  registerVarendoElements();
  return getCatalogExample(id).mount(container);
}

/** Mount every active catalog example; useful for the catalog gallery and browser smoke test. */
export function mountCatalogExamples(container: HTMLElement): () => void {
  const cleanups = CATALOG_EXAMPLE_IDS.map((id) => catalogExample(id, container));
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
