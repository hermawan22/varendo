import type {
  PresentationPlan,
  Result,
  ResultRef,
  Task,
  VersionRef,
  VisualizationSpec,
} from '../../packages/core/src/contracts/index.js';
import type {
  PresentationContext,
  PresentationNode,
  PresentationValues,
} from '../../packages/core/src/presentation/index.js';
import {
  AELIQO_CONFIG_SCHEMAS,
  AELIQO_OPERATION_REFS,
  AELIQO_PRESENTATION_REFS,
  createAeliqoPresentationRegistry,
  createSelectionIdentityMapping,
} from '../../packages/web/src/region/registry.js';
import { AELIQO_DATA_REFS, type AeliqoDataBinding } from '../../packages/web/src/region/data-registry.js';
import { AELIQO_INPUT_REFS } from '../../packages/web/src/input/manifest.js';
import type { AeliqoInputBinding } from '../../packages/web/src/region/input-registry.js';
import {
  AELIQO_VISUALIZATION_CONFIG_SCHEMAS,
  AELIQO_VISUALIZATION_REFS,
  type AeliqoVisualizationBinding,
} from '../../packages/web/src/region/visualization-registry.js';
import type { AeliqoCompoundRecipeInput } from '../../packages/web/src/compound/types.js';

export const peopleRef: ResultRef = {
  id: 'compound-people',
  revision: '1',
  outputId: 'people',
  queryDigest: 'people-query',
  scopeDigest: 'people-scope',
};

export const peopleResult: Result = {
  version: '1',
  ref: peopleRef,
  taskId: 'compound-presentation',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
    {
      id: 'amount',
      label: 'Amount',
      type: { value: 'decimal', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
      role: 'measure',
    },
    { id: 'department', label: 'Department', type: { value: 'text', nullable: false }, role: 'dimension' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 2, population: { kind: 'exact', value: 2, populationDigest: 'people-population' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'people-population' },
  consistency: { kind: 'snapshot', snapshotId: 'people-snapshot', sourceRevisions: { people: '1' } },
  evidence: { kind: 'observed', source: { id: 'people-source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};

export const peopleRows = [
  { id: 'a', name: 'Ada', amount: { decimal: '12.50' }, department: 'Sales' },
  { id: 'b', name: 'Bea', amount: { decimal: '7.00' }, department: 'Design' },
] as const;

export const temporalRef: ResultRef = {
  id: 'compound-temporal',
  revision: '1',
  outputId: 'trend',
  queryDigest: 'trend-query',
  scopeDigest: 'trend-scope',
};

export const temporalResult: Result = {
  version: '1',
  ref: temporalRef,
  taskId: 'compound-investigation',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    {
      id: 'date',
      label: 'Date',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } },
      role: 'time',
    },
    {
      id: 'amount',
      label: 'Amount',
      type: { value: 'decimal', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
      role: 'measure',
    },
  ],
  identity: ['id'],
  rowGrain: ['id', 'date'],
  counts: { loaded: 2, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Bounded investigation fixture' },
  consistency: { kind: 'snapshot', snapshotId: 'trend-snapshot', sourceRevisions: { people: '1' } },
  evidence: { kind: 'observed', source: { id: 'people-source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};

export const temporalRows = [
  { id: 'a', date: '2026-09-08', amount: { decimal: '12.50' } },
  { id: 'b', date: '2026-09-09', amount: { decimal: '7.00' } },
] as const;

export const trendSpec: VisualizationSpec = {
  version: '1',
  view: 'trend',
  plot: {
    version: '1',
    root: {
      kind: 'unit',
      mark: 'line',
      result: temporalRef,
      missing: 'gap',
      encoding: { x: { field: 'date', scale: 'temporal' }, y: { field: 'amount', scale: 'linear' } },
    },
  },
};

export const timelineSpec: VisualizationSpec = {
  version: '1',
  view: 'timeline',
  result: temporalRef,
  start: 'date',
};

export const matrixSpec: VisualizationSpec = {
  version: '1',
  view: 'matrix',
  result: peopleRef,
  columns: ['id', 'name', 'amount'],
};

const dataBindings: readonly AeliqoDataBinding[] = [
  { result: peopleResult, rows: peopleRows },
  { result: temporalResult, rows: temporalRows },
];

const visualizationBindings: readonly AeliqoVisualizationBinding[] = [
  { result: peopleResult, context: { results: [peopleResult] }, datasets: [{ result: peopleRef, rows: peopleRows }] },
  {
    result: temporalResult,
    context: { results: [temporalResult] },
    datasets: [{ result: temporalRef, rows: temporalRows }],
  },
];

const textType = { value: 'text', nullable: false } as const;
const searchBinding: AeliqoInputBinding = {
  id: 'people-search',
  ref: AELIQO_INPUT_REFS.searchField,
  config: { label: 'Search people', placeholder: 'Find a person' },
  draft: { entity: 'person', key: 'search', field: 'query', entityRevision: '1', type: textType },
};
export const saveAction = { id: 'person.save', revision: '1' } as const;
const formBinding: AeliqoInputBinding = {
  id: 'person-form',
  ref: AELIQO_INPUT_REFS.form,
  config: { label: 'Save person' },
  action: { action: saveAction, input: { source: 'compound-semantic' } },
};

export const inputBindings = { revision: 'inputs-1', inputs: [searchBinding, formBinding] };

export const selectionMapping = createSelectionIdentityMapping('person', peopleResult.identity, peopleResult.rowGrain);

export function registry() {
  const made = createAeliqoPresentationRegistry(
    {
      data: dataBindings,
      inputs: inputBindings,
      visualizations: visualizationBindings,
      resolveEntity: () => 'person',
    },
    [selectionMapping],
  );
  if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
  return made.value;
}

const preconditionBase = {
  scopeDigest: 'scope',
  policyRevision: 'policy-1',
  taskRevision: 'task-1',
  regionRevision: 'region-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-1',
  functionRegistryDigest: 'functions-1',
};

const environment = {
  inlineSize: { state: 'unknown' as const },
  blockSize: { state: 'unknown' as const },
  textScale: { state: 'unknown' as const },
  pointer: 'unknown' as const,
  hover: 'unknown' as const,
  keyboard: 'unknown' as const,
  locale: 'en-US',
  direction: 'ltr' as const,
  reducedMotion: false,
  forcedColors: false,
};

const allReps = [
  AELIQO_PRESENTATION_REFS.stack,
  AELIQO_DATA_REFS.metric,
  AELIQO_DATA_REFS.detail,
  AELIQO_DATA_REFS.recordList,
  AELIQO_DATA_REFS.table,
  AELIQO_DATA_REFS.filterBuilder,
  AELIQO_VISUALIZATION_REFS.trend,
  AELIQO_VISUALIZATION_REFS.timeline,
  AELIQO_VISUALIZATION_REFS.matrix,
  AELIQO_INPUT_REFS.searchField,
  AELIQO_INPUT_REFS.form,
];

export function presentationContext(
  results: readonly Result[],
  needs: readonly Task['needs'][number][],
  allowed = allReps,
): PresentationContext {
  const current = {
    ...preconditionBase,
    scopeDigest: results[0]?.ref.scopeDigest ?? 'scope',
    results: results.map((result) => result.ref),
  };
  return {
    task: {
      version: '1',
      id: 'task-1',
      revision: 'task-1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'functions-1',
      regionId: 'region-1',
      goal: 'Present authorized compound data',
      needs,
      assumptions: [],
      kind: 'presentation',
      inputs: results.map((result) => result.ref),
    },
    experience: {
      version: '1',
      id: 'experience-1',
      revision: 'experience-1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: allowed.map((ref) => ref.id),
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 16, maxExpansions: 16 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results,
    current,
    environment,
    rendererCapabilities: allowed,
  };
}

export function formContext(): PresentationContext {
  const current = { ...preconditionBase, results: [] as readonly ResultRef[] };
  const needs = [{ id: 'save', operation: saveAction, fields: [], required: true }] as const;
  const allowed = [AELIQO_PRESENTATION_REFS.stack, AELIQO_INPUT_REFS.form];
  return {
    task: {
      version: '1',
      id: 'task-1',
      revision: 'task-1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'functions-1',
      regionId: 'region-1',
      goal: 'Edit an authorized person',
      needs,
      assumptions: [],
      kind: 'form',
      schema: { id: 'person.form', revision: '1' },
      action: saveAction,
    },
    experience: {
      version: '1',
      id: 'experience-1',
      revision: 'experience-1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: allowed.map((ref) => ref.id),
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 8 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [],
    current,
    environment,
    rendererCapabilities: allowed,
  };
}

function node(
  id: string,
  representation: VersionRef,
  role: string,
  values: PresentationValues,
  result?: ResultRef,
): PresentationNode {
  return {
    id,
    role,
    representation,
    ...(result === undefined ? {} : { result }),
    config: { schema: { id: `${representation.id}.config`, revision: '1' }, values },
    children: [],
  };
}

export function dataNode(
  id: string,
  representation: VersionRef,
  role: string,
  values: PresentationValues = {},
  result: ResultRef = peopleRef,
): PresentationNode {
  return node(id, representation, role, values, result);
}

export function visualizationNode(
  id: string,
  representation: VersionRef,
  spec: VisualizationSpec,
  result: ResultRef = peopleRef,
): PresentationNode {
  return node(id, representation, 'visualization', { visualization: spec }, result);
}

export function inputNode(id: string, representation: VersionRef, role: 'input' | 'structure'): PresentationNode {
  return node(id, representation, role, {
    bindingRef: id === 'search' ? searchBinding.id : formBinding.id,
    bindingRevision: inputBindings.revision,
  });
}

export function recipeInput(
  id: string,
  parts: readonly PresentationNode[],
  context: PresentationContext,
  coverage: PresentationPlan['coverage'],
  links: PresentationPlan['links'] = [],
): AeliqoCompoundRecipeInput {
  return {
    id,
    revision: '1',
    preconditions: context.current,
    parts,
    links,
    coverage,
    validation: { context, registry: registry() },
  };
}

export function readNeed(fields: readonly string[] = ['id', 'name', 'amount', 'department']) {
  return {
    id: 'read',
    operation: AELIQO_OPERATION_REFS.read,
    fields: [...fields],
    outputId: peopleRef.outputId,
    required: true,
  } as const;
}

export function temporalReadNeed() {
  return {
    id: 'read',
    operation: AELIQO_OPERATION_REFS.read,
    fields: ['id', 'date', 'amount'],
    outputId: temporalRef.outputId,
    required: true,
  } as const;
}

export function explorerInput(): AeliqoCompoundRecipeInput {
  const needs = [
    readNeed(),
    {
      id: 'filter',
      operation: AELIQO_OPERATION_REFS.filter,
      fields: ['name'],
      outputId: peopleRef.outputId,
      required: true,
    },
    {
      id: 'selection',
      operation: AELIQO_OPERATION_REFS.selection,
      fields: ['id'],
      outputId: peopleRef.outputId,
      required: true,
    },
  ] as const;
  const context = presentationContext([peopleResult], needs, [
    AELIQO_PRESENTATION_REFS.stack,
    AELIQO_DATA_REFS.filterBuilder,
    AELIQO_DATA_REFS.recordList,
    AELIQO_DATA_REFS.detail,
    AELIQO_DATA_REFS.table,
  ]);
  const parts = [
    dataNode('filter', AELIQO_DATA_REFS.filterBuilder, 'filterBuilder', {
      field: 'name',
      outputId: peopleRef.outputId,
    }),
    dataNode('record-list', AELIQO_DATA_REFS.recordList, 'recordList', { selection: 'single' }),
    dataNode('detail', AELIQO_DATA_REFS.detail, 'detail', {
      fields: ['id', 'name', 'amount', 'department'],
      identityValues: { id: 'a' },
    }),
    dataNode('table', AELIQO_DATA_REFS.table, 'table', { selection: 'single' }),
  ];
  const links: PresentationPlan['links'] = [
    {
      id: 'record-list-to-table-selection',
      source: { node: 'record-list', port: 'selection' },
      target: { node: 'table', port: 'selection' },
      mapping: selectionMapping.ref,
      propagation: 'identity-equivalence',
    },
  ];
  const coverage: PresentationPlan['coverage'] = [
    { needId: 'read', nodeIds: ['record-list', 'detail'], operations: [AELIQO_OPERATION_REFS.read] },
    { needId: 'filter', nodeIds: ['filter'], operations: [AELIQO_OPERATION_REFS.filter] },
    { needId: 'selection', nodeIds: ['record-list', 'table'], operations: [AELIQO_OPERATION_REFS.selection] },
  ];
  return recipeInput('explorer', parts, context, coverage, links);
}

export const dataSchemas = AELIQO_CONFIG_SCHEMAS;
export const visualizationSchemas = AELIQO_VISUALIZATION_CONFIG_SCHEMAS;
export type { AeliqoCompoundRecipeInput };
