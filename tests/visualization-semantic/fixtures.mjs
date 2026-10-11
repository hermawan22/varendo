import {
  ref as cartRef,
  result as cartResult,
  rows as cartRows,
  specs as cartSpecs,
  catalog as cartCatalog,
} from '../visualization/cartesian-fixtures.mjs';

const temporalRef = {
  id: 'semantic-temporal',
  revision: '1',
  sourceLineage: 'fixture-source',
  outputId: 'rows',
  queryDigest: 'query',
  scopeDigest: 'scope',
};
const temporalResult = {
  version: '1',
  ref: temporalRef,
  taskId: 'task',
  identity: ['id'],
  rowGrain: ['id', 'date'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
    {
      id: 'date',
      label: 'Date',
      role: 'time',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } },
    },
  ],
  counts: { loaded: 2, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Loaded rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot' },
  evidence: { kind: 'computed', queryDigest: 'query', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const temporalRows = [
  { id: 'a', date: '2026-09-08' },
  { id: 'b', date: '2026-09-09' },
];

const nodeRef = {
  id: 'semantic-hierarchy',
  revision: '1',
  outputId: 'rows',
  queryDigest: 'query',
  scopeDigest: 'scope',
};
const nodeResult = {
  version: '1',
  ref: nodeRef,
  taskId: 'task',
  identity: ['id'],
  rowGrain: ['id'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
    { id: 'parent', label: 'Parent', role: 'attribute', type: { value: 'text', nullable: true } },
    { id: 'label', label: 'Label', role: 'attribute', type: { value: 'text', nullable: false } },
    {
      id: 'amount',
      label: 'Amount',
      role: 'measure',
      type: { value: 'integer', nullable: false },
      derivation: { id: 'amount', revision: '1' },
    },
  ],
  counts: { loaded: 2, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Loaded rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot' },
  evidence: { kind: 'computed', queryDigest: 'query', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const nodeRows = [
  { id: 'root', parent: null, label: 'Root', amount: 3 },
  { id: 'child', parent: 'root', label: 'Child', amount: 2 },
];
const meaning = {
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
const nodeCatalog = {
  version: '1',
  revision: 'catalog',
  functionRegistryDigest: 'functions',
  entities: [{ id: 'nodes', label: 'Nodes', identity: ['id'], rowGrain: ['id'], fields: [nodeResult.fields[0]] }],
  relationships: [],
  meanings: [meaning],
  capabilities: [],
};

const edgeRef = { id: 'semantic-edges', revision: '1', outputId: 'rows', queryDigest: 'query', scopeDigest: 'scope' };
const edgeResult = {
  ...nodeResult,
  ref: edgeRef,
  identity: ['edge'],
  rowGrain: ['edge'],
  fields: [
    { id: 'edge', label: 'Edge', role: 'identity', type: { value: 'text', nullable: false } },
    { id: 'source', label: 'Source', role: 'dimension', type: { value: 'text', nullable: false } },
    { id: 'target', label: 'Target', role: 'dimension', type: { value: 'text', nullable: false } },
  ],
  counts: { loaded: 1, population: { kind: 'unknown' } },
};
const edgeRows = [{ edge: 'e1', source: 's1', target: 't1' }];
const relation = {
  id: 'edge-relation',
  revision: '1',
  sourceEntity: 'sources',
  targetEntity: 'targets',
  keys: [{ sourceField: 'id', targetField: 'id' }],
  cardinality: 'many-to-one',
  optional: false,
  joinPolicy: 'validated',
};
const entity = (id) => ({
  id,
  label: id,
  identity: ['id'],
  rowGrain: ['id'],
  fields: [{ id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } }],
});
const edgeCatalog = {
  version: '1',
  revision: 'catalog',
  functionRegistryDigest: 'functions',
  entities: [entity('sources'), entity('targets')],
  relationships: [relation],
  meanings: [],
  capabilities: [],
};

const refs = Object.freeze({
  stack: { id: 'layout.stack', revision: '1' },
  trend: { id: 'visualization.trend', revision: '1' },
  bar: { id: 'visualization.bar', revision: '1' },
  area: { id: 'visualization.area', revision: '1' },
  scatter: { id: 'visualization.scatter', revision: '1' },
  histogram: { id: 'visualization.histogram', revision: '1' },
  heatmap: { id: 'visualization.heatmap', revision: '1' },
  matrix: { id: 'visualization.matrix', revision: '1' },
  timeline: { id: 'visualization.timeline', revision: '1' },
  'calendar-grid': { id: 'visualization.calendar-grid', revision: '1' },
  tree: { id: 'visualization.tree', revision: '1' },
  treemap: { id: 'visualization.treemap', revision: '1' },
  relationship: { id: 'visualization.relationship', revision: '1' },
});
const schemas = Object.freeze(
  Object.fromEntries(Object.entries(refs).map(([view, ref]) => [view, { id: `${ref.id}.config`, revision: '1' }])),
);
const allRefs = [cartRef, temporalRef, nodeRef, edgeRef];
const preconditions = {
  scopeDigest: 'scope',
  policyRevision: 'policy-1',
  taskRevision: 'task-1',
  regionRevision: 'region-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-1',
  functionRegistryDigest: 'functions',
  results: allRefs,
};

const specs = {
  ...cartSpecs,
  matrix: { version: '1', view: 'matrix', result: temporalRef, columns: ['id', 'date'] },
  timeline: { version: '1', view: 'timeline', result: temporalRef, start: 'date' },
  'calendar-grid': { version: '1', view: 'calendar-grid', result: temporalRef, date: 'date' },
  tree: { version: '1', view: 'tree', result: nodeRef, node: ['id'], parent: ['parent'], label: 'label' },
  treemap: {
    version: '1',
    view: 'treemap',
    result: nodeRef,
    node: ['id'],
    parent: ['parent'],
    label: 'label',
    value: 'amount',
    meaning: { id: 'amount', revision: '1' },
  },
  relationship: {
    version: '1',
    view: 'relationship',
    result: edgeRef,
    source: ['source'],
    target: ['target'],
    relationship: { id: relation.id, revision: relation.revision },
  },
};

const visualizations = [
  {
    result: cartResult,
    context: {
      results: [cartResult],
      catalog: cartCatalog,
      histograms: [{ result: cartRef, bins: specs.histogram.bins }],
    },
    datasets: [{ result: cartRef, rows: cartRows }],
  },
  {
    result: temporalResult,
    context: { results: [temporalResult] },
    datasets: [{ result: temporalRef, rows: temporalRows }],
  },
  {
    result: nodeResult,
    context: { results: [nodeResult], catalog: nodeCatalog },
    datasets: [{ result: nodeRef, rows: nodeRows }],
  },
  {
    result: edgeResult,
    context: {
      results: [edgeResult],
      catalog: edgeCatalog,
      relationships: [
        {
          result: edgeRef,
          relationship: { id: relation.id, revision: relation.revision },
          source: ['source'],
          target: ['target'],
        },
      ],
    },
    datasets: [{ result: edgeRef, rows: edgeRows }],
  },
];

const resultForView = (view) =>
  view === 'matrix' || view === 'timeline' || view === 'calendar-grid'
    ? temporalResult
    : view === 'tree' || view === 'treemap'
      ? nodeResult
      : view === 'relationship'
        ? edgeResult
        : cartResult;
const refForView = (view) => resultForView(view).ref;
const views = [
  'trend',
  'bar',
  'area',
  'scatter',
  'histogram',
  'heatmap',
  'matrix',
  'timeline',
  'calendar-grid',
  'tree',
  'treemap',
  'relationship',
];

export function visualizationPlan() {
  const leaves = views.map((view) => ({
    id: `visualization-${view}`,
    role: 'visualization',
    representation: refs[view],
    result: refForView(view),
    config: { schema: schemas[view], values: { visualization: specs[view] } },
    children: [],
  }));
  return {
    id: 'plan-visualization-semantic',
    revision: 'plan-1',
    rootId: 'root',
    preconditions,
    nodes: [
      {
        id: 'root',
        role: 'structure',
        representation: refs.stack,
        config: { schema: { id: 'layout.stack.config', revision: '1' }, values: {} },
        children: leaves.map((node) => node.id),
      },
      ...leaves,
    ],
    links: [],
    coverage: [],
    stateTransfer: [],
    diagnostics: [],
  };
}

export function visualizationContext() {
  const representations = [refs.stack, ...views.map((view) => refs[view])];
  return {
    task: {
      version: '1',
      id: 'task-visualization-semantic',
      revision: 'task-1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'functions',
      regionId: 'region-1',
      goal: 'Render all authorized visualizations',
      needs: [],
      assumptions: [],
      kind: 'presentation',
      inputs: allRefs,
    },
    experience: {
      version: '1',
      id: 'experience-visualization-semantic',
      revision: 'experience-1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: representations.map((ref) => ref.id),
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 32, maxExpansions: 16 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [cartResult, temporalResult, nodeResult, edgeResult],
    current: preconditions,
    environment: {
      inlineSize: { state: 'unknown' },
      blockSize: { state: 'unknown' },
      textScale: { state: 'unknown' },
      pointer: 'unknown',
      hover: 'unknown',
      keyboard: 'unknown',
      locale: 'en-US',
      direction: 'ltr',
      reducedMotion: false,
      forcedColors: false,
    },
    rendererCapabilities: representations,
  };
}

export function visualizationRegistryOptions(readOnly = false) {
  return readOnly ? { visualizations } : { visualizations, resolveEntity: () => 'rows' };
}

export function regionResults() {
  return visualizations.map((binding) => ({
    ref: binding.result.ref,
    rows: binding.datasets[0].rows,
    visualizationContext: binding.context,
  }));
}

export {
  cartRef,
  cartResult,
  cartRows,
  temporalRef,
  temporalResult,
  temporalRows,
  nodeRef,
  nodeResult,
  nodeRows,
  edgeRef,
  edgeResult,
  edgeRows,
  refs,
  schemas,
  specs,
  visualizations,
  allRefs,
};
