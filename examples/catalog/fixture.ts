import type { Catalog, MeaningDefinition, PlotUnit, Result, ResultRef, Scalar, VisualizationSpec } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import type { VisualizationDataset } from '@varendo/web/visualization';
import type { AeliqoDataColumn, AeliqoDataScope, AeliqoFieldOption } from '@varendo/web/data';

export const catalogRef: ResultRef = {
  id: 'aeliqo-catalog-example',
  revision: '1',
  outputId: 'people',
  queryDigest: 'catalog-query',
  scopeDigest: 'catalog-scope',
};

const text = { value: 'text', nullable: false } as const;
const integer = { value: 'integer', nullable: false } as const;
const date = { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } } as const;

export const catalogColumns: readonly AeliqoDataColumn[] = [
  { key: 'id', label: 'ID', type: 'text', sortable: true },
  { key: 'name', label: 'Name', type: 'text', sortable: true },
  { key: 'team', label: 'Team', type: 'text' },
  { key: 'date', label: 'Date', type: 'date', sortable: true },
  { key: 'amount', label: 'Amount', type: 'integer', align: 'end' },
];

export const catalogFields: readonly AeliqoFieldOption[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'team', label: 'Team', type: 'text' },
  { id: 'amount', label: 'Amount', type: 'integer' },
];

export const catalogRows: readonly Readonly<Record<string, Scalar>>[] = [
  { id: 'ada', name: 'Ada Lovelace', team: 'Research', date: '2026-09-08', amount: 120, low: 80, high: 100, zero: 0 },
  { id: 'lin', name: 'Lin Chen', team: 'Product', date: '2026-09-09', amount: 96, low: 100, high: 140, zero: 0 },
  {
    id: 'grace',
    name: 'Grace Hopper',
    team: 'Research',
    date: '2026-09-10',
    amount: 144,
    low: 140,
    high: 160,
    zero: 0,
  },
];

export const catalogScope: AeliqoDataScope = {
  loaded: catalogRows.length,
  filteredTotal: catalogRows.length,
  populationDigest: catalogRef.scopeDigest,
  kind: 'filtered',
  label: 'Authorized people',
};

const meaning: MeaningDefinition = {
  id: 'amount',
  revision: '1',
  label: 'Amount',
  explanation: 'Authorized additive amount',
  output: integer,
  implementation: { kind: 'host-capability', capability: { id: 'amount', revision: '1' } },
  dependencies: [],
  functionRegistryDigest: 'catalog-functions',
  origin: 'manual',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'reviewed',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'reject',
};

const peopleEntity: Catalog['entities'][number] = {
  id: 'people',
  label: 'People',
  identity: ['id'],
  rowGrain: ['id'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: text },
    { id: 'name', label: 'Name', role: 'attribute', type: text },
    { id: 'team', label: 'Team', role: 'dimension', type: text },
    { id: 'date', label: 'Date', role: 'time', type: date },
    { id: 'amount', label: 'Amount', role: 'measure', type: integer, derivation: { id: 'amount', revision: '1' } },
    { id: 'low', label: 'Bin start', role: 'dimension', type: integer },
    { id: 'high', label: 'Bin end', role: 'dimension', type: integer },
    { id: 'zero', label: 'Baseline', role: 'measure', type: integer },
  ],
};

export const catalog: Catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'catalog-functions',
  entities: [peopleEntity],
  relationships: [],
  meanings: [meaning],
  capabilities: [],
};

export const catalogResult: Result = {
  version: '1',
  ref: catalogRef,
  taskId: 'catalog-example-task',
  identity: ['id'],
  rowGrain: ['id', 'date', 'team', 'name', 'low', 'high'],
  fields: peopleEntity.fields,
  counts: { loaded: catalogRows.length, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: catalogRef.scopeDigest },
  consistency: { kind: 'snapshot', snapshotId: 'catalog-snapshot', sourceRevisions: { people: '1' } },
  evidence: { kind: 'computed', queryDigest: catalogRef.queryDigest, definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};

export const catalogVisualizationContext: VisualizationBindingContext = {
  results: [catalogResult],
  catalog,
};

export const catalogVisualizationDataset: VisualizationDataset = {
  result: catalogRef,
  rows: catalogRows,
};

const plot = (mark: PlotUnit['mark'], encoding: PlotUnit['encoding']): PlotUnit => ({
  kind: 'unit',
  mark,
  result: catalogRef,
  missing: 'gap',
  encoding,
});

export const catalogVisualizationSpecs: Readonly<
  Record<'trend' | 'bar' | 'area' | 'scatter' | 'histogram' | 'heatmap', VisualizationSpec>
> = {
  trend: {
    version: '1',
    view: 'trend',
    plot: {
      version: '1',
      root: plot('line', { x: { field: 'date', scale: 'temporal' }, y: { field: 'amount', scale: 'linear' } }),
    },
  },
  bar: {
    version: '1',
    view: 'bar',
    plot: {
      version: '1',
      root: plot('bar', {
        x: { field: 'team', scale: 'ordinal' },
        y: { field: 'amount', scale: 'linear', zero: true },
        series: { field: 'name', scale: 'ordinal' },
      }),
    },
  },
  area: {
    version: '1',
    view: 'area',
    plot: {
      version: '1',
      root: plot('area', {
        x: { field: 'date', scale: 'temporal' },
        y: { field: 'amount', scale: 'linear', zero: true },
      }),
    },
    meaning: { id: 'amount', revision: '1' },
    stack: 'none',
  },
  scatter: {
    version: '1',
    view: 'scatter',
    plot: {
      version: '1',
      root: plot('point', { x: { field: 'amount', scale: 'linear' }, y: { field: 'amount', scale: 'linear' } }),
    },
  },
  histogram: {
    version: '1',
    view: 'histogram',
    plot: {
      version: '1',
      root: plot('rect', {
        x: { field: 'low', scale: 'linear' },
        x2: { field: 'high', scale: 'linear' },
        y: { field: 'amount', scale: 'linear', zero: true },
        y2: { field: 'zero', scale: 'linear', zero: true },
      }),
    },
    bins: { start: 'low', end: 'high', value: 'amount', measure: 'count', boundary: 'start-inclusive-end-exclusive' },
  },
  heatmap: {
    version: '1',
    view: 'heatmap',
    plot: {
      version: '1',
      root: plot('cell', {
        x: { field: 'team', scale: 'ordinal' },
        y: { field: 'name', scale: 'ordinal' },
        color: { field: 'amount', scale: 'linear' },
      }),
    },
  },
};

export const catalogTemporalSpecs: Readonly<Record<'matrix' | 'timeline' | 'calendar-grid', VisualizationSpec>> = {
  matrix: { version: '1', view: 'matrix', result: catalogRef, columns: ['name', 'team', 'amount'] },
  timeline: { version: '1', view: 'timeline', result: catalogRef, start: 'date' },
  'calendar-grid': { version: '1', view: 'calendar-grid', result: catalogRef, date: 'date' },
};

export const hierarchyRef: ResultRef = { ...catalogRef, id: 'aeliqo-catalog-hierarchy', outputId: 'nodes' };
export const hierarchyRows: readonly Readonly<Record<string, Scalar>>[] = [
  { id: 'company', parent: null, label: 'Company', amount: 3 },
  { id: 'research', parent: 'company', label: 'Research', amount: 2 },
  { id: 'product', parent: 'company', label: 'Product', amount: 1 },
];
export const hierarchyResult: Result = {
  ...catalogResult,
  ref: hierarchyRef,
  taskId: 'catalog-hierarchy-task',
  identity: ['id'],
  rowGrain: ['id'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: text },
    { id: 'parent', label: 'Parent', role: 'attribute', type: { ...text, nullable: true } },
    { id: 'label', label: 'Label', role: 'attribute', type: text },
    { id: 'amount', label: 'Amount', role: 'measure', type: integer, derivation: { id: 'amount', revision: '1' } },
  ],
  counts: { loaded: hierarchyRows.length, population: { kind: 'unknown' } },
};
export const hierarchySpec: VisualizationSpec = {
  version: '1',
  view: 'tree',
  result: hierarchyRef,
  node: ['id'],
  parent: ['parent'],
  label: 'label',
};
export const treemapSpec: VisualizationSpec = {
  ...hierarchySpec,
  view: 'treemap',
  value: 'amount',
  meaning: { id: 'amount', revision: '1' },
};

export const relationshipRef: ResultRef = { ...catalogRef, id: 'aeliqo-catalog-relationship', outputId: 'edges' };
export const relationshipRows: readonly Readonly<Record<string, Scalar>>[] = [
  { edge: 'e1', source: 'research', target: 'company' },
  { edge: 'e2', source: 'product', target: 'company' },
];
const relationship: Catalog['relationships'][number] = {
  id: 'reports-to',
  revision: '1',
  sourceEntity: 'people',
  targetEntity: 'people',
  keys: [{ sourceField: 'id', targetField: 'id' }],
  cardinality: 'many-to-one',
  optional: false,
  joinPolicy: 'validated',
};
export const relationshipResult: Result = {
  ...hierarchyResult,
  ref: relationshipRef,
  identity: ['edge'],
  rowGrain: ['edge'],
  fields: [
    { id: 'edge', label: 'Edge', role: 'identity', type: text },
    { id: 'source', label: 'Source', role: 'dimension', type: text },
    { id: 'target', label: 'Target', role: 'dimension', type: text },
  ],
  counts: { loaded: relationshipRows.length, population: { kind: 'unknown' } },
};
export const relationshipSpec: VisualizationSpec = {
  version: '1',
  view: 'relationship',
  result: relationshipRef,
  source: ['source'],
  target: ['target'],
  relationship: { id: relationship.id, revision: relationship.revision },
};
export const relationshipContext: VisualizationBindingContext = {
  results: [relationshipResult],
  catalog: { ...catalog, relationships: [relationship] },
  relationships: [
    {
      result: relationshipRef,
      relationship: { id: relationship.id, revision: relationship.revision },
      source: ['source'],
      target: ['target'],
    },
  ],
};
export const relationshipDataset: VisualizationDataset = { result: relationshipRef, rows: relationshipRows };

export const hierarchyContext: VisualizationBindingContext = { results: [hierarchyResult], catalog };
export const hierarchyDataset: VisualizationDataset = { result: hierarchyRef, rows: hierarchyRows };

export function createCatalogElement<T extends HTMLElement>(
  tagName: string,
  container: HTMLElement,
  constructor: CustomElementConstructor & { readonly prototype: T },
): T {
  const registry = container.ownerDocument.defaultView?.customElements;
  if (registry === undefined) throw new Error('A live custom element registry is required for catalog previews.');
  const current = registry.get(tagName) as (CustomElementConstructor & { readonly aeliqoVersion?: string }) | undefined;
  const next = constructor as CustomElementConstructor & { readonly aeliqoVersion?: string };
  if (current === undefined) registry.define(tagName, constructor);
  else if (
    current !== constructor &&
    (next.aeliqoVersion === undefined || current.aeliqoVersion !== next.aeliqoVersion)
  )
    throw new Error(`Cannot register ${tagName}: an incompatible custom element is already defined.`);
  const element = container.ownerDocument.createElement(tagName) as T;
  element.setAttribute('data-aeliqo-theme', 'light');
  container.append(element);
  return element;
}

export function createCatalogRoot(container: HTMLElement): HTMLElement {
  const root = document.createElement('div');
  root.dataset.catalogExampleRoot = 'true';
  root.style.display = 'grid';
  root.style.gap = '12px';
  container.append(root);
  return root;
}

export function cleanupCatalogRoot(root: HTMLElement): () => void {
  return () => root.remove();
}

export function appendSlottedText(root: HTMLElement, slot: string, textContent: string): HTMLSpanElement {
  const content = document.createElement('span');
  content.slot = slot;
  content.textContent = textContent;
  root.append(content);
  return content;
}
