import type { Result, ResultRef, Catalog, VisualizationSpec, Scalar } from '../../packages/core/src/index.js';
import type { VisualizationBindingContext } from '../../packages/core/src/contracts/visualization/index.js';
export const ref: ResultRef = {
  id: 'hierarchy',
  revision: '1',
  outputId: 'rows',
  queryDigest: 'q',
  scopeDigest: 'scope',
};
const text = { value: 'text', nullable: false } as const;
export const result: Result = {
  version: '1',
  ref,
  taskId: 'task',
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: text },
    { id: 'parent', label: 'Parent', role: 'attribute', type: { ...text, nullable: true } },
    { id: 'label', label: 'Label', role: 'attribute', type: text },
    {
      id: 'amount',
      label: 'Amount',
      role: 'measure',
      type: { value: 'integer', nullable: false },
      derivation: { id: 'amount', revision: '1' },
    },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 3, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'partial', populationDigest: 'population', reason: 'Loaded branch only' },
  consistency: { kind: 'unknown', reason: 'Host snapshot unknown' },
  evidence: { kind: 'computed', queryDigest: 'q', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
export const rows = [
  { id: 'root', parent: null, label: 'Root', amount: 3 },
  { id: 'child-a', parent: 'root', label: 'Child A', amount: 2 },
  { id: 'child-b', parent: 'root', label: 'Child B', amount: 1 },
];
const entity = (id: string): Catalog['entities'][number] => ({
  id,
  label: id,
  identity: ['id'],
  rowGrain: ['id'],
  fields: [{ id: 'id', label: 'ID', role: 'identity', type: text }],
});
const relation: Catalog['relationships'][number] = {
  id: 'edges',
  revision: '1',
  sourceEntity: 'sources',
  targetEntity: 'targets',
  keys: [{ sourceField: 'id', targetField: 'id' }],
  cardinality: 'many-to-one',
  optional: false,
  joinPolicy: 'validated',
};
export const catalog: Catalog = {
  version: '1',
  revision: 'catalog',
  functionRegistryDigest: 'functions',
  entities: [entity('sources'), entity('targets')],
  relationships: [relation],
  capabilities: [],
  meanings: [
    {
      id: 'amount',
      revision: '1',
      label: 'Amount',
      explanation: 'Additive amount',
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
    },
  ],
};
export const tree: VisualizationSpec = {
  version: '1',
  view: 'tree',
  result: ref,
  node: ['id'],
  parent: ['parent'],
  label: 'label',
};
export const treemap: VisualizationSpec = {
  ...tree,
  view: 'treemap',
  value: 'amount',
  meaning: { id: 'amount', revision: '1' },
};
export const edgeResult: Result = {
  ...result,
  ref: { ...ref, id: 'edges' },
  identity: ['edge'],
  rowGrain: ['edge'],
  counts: { ...result.counts, loaded: 2 },
  fields: [
    { id: 'edge', label: 'Edge', role: 'identity', type: text },
    { id: 'source', label: 'Source', role: 'dimension', type: text },
    { id: 'target', label: 'Target', role: 'dimension', type: text },
  ],
};
export const edgeRows = [
  { edge: 'e1', source: 's1', target: 't1' },
  { edge: 'e2', source: 's2', target: 't1' },
];
export const relationship: VisualizationSpec = {
  version: '1',
  view: 'relationship',
  result: edgeResult.ref,
  source: ['source'],
  target: ['target'],
  relationship: { id: 'edges', revision: '1' },
};
export const context: VisualizationBindingContext = {
  results: [result, edgeResult],
  catalog,
  relationships: [
    { result: edgeResult.ref, relationship: { id: 'edges', revision: '1' }, source: ['source'], target: ['target'] },
  ],
};
export const datasets = [
  { result: ref, rows },
  { result: edgeResult.ref, rows: edgeRows },
];
