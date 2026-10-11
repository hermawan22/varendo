import { defineCartesianElements } from '../../packages/web/src/visualization/cartesian/index.js';
import type {
  Catalog,
  MeaningDefinition,
  PlotUnit,
  Result,
  ResultRef,
  VisualizationSpec,
} from '../../packages/core/src/index.js';

defineCartesianElements();
const ref: ResultRef = {
  id: 'cartesian-browser',
  revision: '1',
  outputId: 'rows',
  queryDigest: 'query',
  scopeDigest: 'scope',
};
const meaning: MeaningDefinition = {
  id: 'amount',
  revision: '1',
  label: 'Amount',
  explanation: 'Authorized additive amount',
  output: { value: 'integer', nullable: false },
  implementation: { kind: 'host-capability', capability: { id: 'amount', revision: '1' } },
  dependencies: [],
  functionRegistryDigest: 'functions',
  origin: 'manual',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'reviewed',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'reject',
};
const result: Result = {
  version: '1',
  ref,
  taskId: 'task',
  identity: ['id'],
  rowGrain: ['id', 'date', 'category', 'feature', 'low', 'high'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
    {
      id: 'date',
      label: 'Date',
      role: 'time',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } },
    },
    { id: 'category', label: 'Category', role: 'dimension', type: { value: 'text', nullable: false } },
    { id: 'feature', label: 'Feature', role: 'dimension', type: { value: 'text', nullable: false } },
    { id: 'x', label: 'X', role: 'measure', type: { value: 'integer', nullable: false } },
    {
      id: 'y',
      label: 'Amount',
      role: 'measure',
      type: { value: 'integer', nullable: false },
      derivation: { id: 'amount', revision: '1' },
    },
    { id: 'low', label: 'Start', role: 'dimension', type: { value: 'integer', nullable: false } },
    { id: 'high', label: 'End', role: 'dimension', type: { value: 'integer', nullable: false } },
    { id: 'zero', label: 'Baseline', role: 'measure', type: { value: 'integer', nullable: false } },
    { id: 'color', label: 'Intensity', role: 'measure', type: { value: 'integer', nullable: false } },
  ],
  counts: { loaded: 4, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Observed page only' },
  consistency: { kind: 'snapshot', snapshotId: 'snapshot', sourceRevisions: { source: '1' } },
  evidence: { kind: 'observed', source: { id: 'source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};
const rows = [
  { id: 'a', date: '2025-01-01', category: 'A', feature: 'I', x: 1, y: 2, low: 0, high: 1, zero: 0, color: 2 },
  { id: 'b', date: '2025-01-02', category: 'A', feature: 'II', x: 2, y: 3, low: 1, high: 2, zero: 0, color: 3 },
  { id: 'c', date: '2025-01-03', category: 'B', feature: 'I', x: 3, y: 4, low: 2, high: 3, zero: 0, color: 4 },
  { id: 'd', date: '2025-01-04', category: 'B', feature: 'II', x: 4, y: 5, low: 3, high: 4, zero: 0, color: 5 },
];
const catalog: Catalog = {
  version: '1',
  revision: 'catalog',
  functionRegistryDigest: 'functions',
  entities: [
    {
      id: 'rows',
      label: 'Rows',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [{ id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } }],
    },
  ],
  relationships: [],
  meanings: [meaning],
  capabilities: [],
};
const plot = (mark: PlotUnit['mark'], encoding: PlotUnit['encoding']) => ({
  version: '1' as const,
  root: { kind: 'unit' as const, mark, result: ref, missing: 'gap' as const, encoding },
});
const specs: Record<string, VisualizationSpec> = {
  trend: {
    version: '1',
    view: 'trend',
    plot: plot('line', { x: { field: 'date', scale: 'temporal' }, y: { field: 'y', scale: 'linear' } }),
  },
  bar: {
    version: '1',
    view: 'bar',
    plot: plot('bar', {
      x: { field: 'category', scale: 'ordinal' },
      y: { field: 'y', scale: 'linear', zero: true },
      series: { field: 'feature', scale: 'ordinal' },
    }),
  },
  area: {
    version: '1',
    view: 'area',
    plot: plot('area', {
      x: { field: 'date', scale: 'temporal' },
      y: { field: 'y', scale: 'linear', zero: true },
      series: { field: 'feature', scale: 'ordinal' },
    }),
    meaning: { id: 'amount', revision: '1' },
    stack: 'zero',
  },
  scatter: {
    version: '1',
    view: 'scatter',
    plot: plot('point', { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } }),
  },
  histogram: {
    version: '1',
    view: 'histogram',
    plot: plot('rect', {
      x: { field: 'low', scale: 'linear' },
      x2: { field: 'high', scale: 'linear' },
      y: { field: 'y', scale: 'linear', zero: true },
      y2: { field: 'zero', scale: 'linear', zero: true },
    }),
    bins: { start: 'low', end: 'high', value: 'y', measure: 'count', boundary: 'start-inclusive-end-exclusive' },
  },
  heatmap: {
    version: '1',
    view: 'heatmap',
    plot: plot('cell', {
      x: { field: 'category', scale: 'ordinal' },
      y: { field: 'feature', scale: 'ordinal' },
      color: { field: 'color', scale: 'linear' },
    }),
  },
};
const tags = ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap'] as const;
const mount = document.querySelector('main') ?? document.body;
for (const tag of tags) {
  const element = document.createElement(`aeliqo-${tag}`) as HTMLElement & {
    visualization: VisualizationSpec;
    context: unknown;
    datasets: unknown;
  };
  element.visualization = specs[tag]!;
  element.context = {
    results: [result],
    catalog,
    histograms:
      tag === 'histogram'
        ? [{ result: ref, bins: (specs.histogram as Extract<VisualizationSpec, { view: 'histogram' }>).bins }]
        : [],
  };
  const sourceRows =
    tag === 'area'
      ? rows.map((row, index) => ({
          ...row,
          date: index < 2 ? rows[0]!.date : rows[2]!.date,
          feature: index % 2 === 0 ? 'I' : 'II',
        }))
      : rows;
  element.datasets = [{ result: ref, rows: sourceRows }];
  element.setAttribute('aria-label', `${tag} fixture`);
  mount.append(element);
}
Object.assign(window, { result, rows, specs });
