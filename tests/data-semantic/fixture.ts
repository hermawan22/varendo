import type { PresentationPlan, Result, ResultRef, VersionRef } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext, PresentationValues } from '../../packages/core/src/presentation/index.js';
import {
  AELIQO_CONFIG_SCHEMAS,
  AELIQO_PRESENTATION_REFS,
  type AeliqoPresentationRegistryOptions,
} from '../../packages/web/src/region/registry.js';
import { AELIQO_DATA_REFS, type AeliqoDataBinding } from '../../packages/web/src/region/data-registry.js';

export const resultRef = {
  id: 'result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
} as const satisfies ResultRef;

export const result: Result = {
  version: '1',
  ref: resultRef,
  taskId: 'task-data-semantic',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
    {
      id: 'amount',
      label: 'Amount',
      type: { value: 'decimal', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
      role: 'measure',
    },
    {
      id: 'baseline',
      label: 'Baseline',
      type: { value: 'decimal', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
      role: 'measure',
    },
    { id: 'department', label: 'Department', type: { value: 'text', nullable: false }, role: 'dimension' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 2, population: { kind: 'exact', value: 3, populationDigest: 'population-1' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'partial', populationDigest: 'population-1', reason: 'First delivery page' },
  consistency: { kind: 'snapshot', snapshotId: 'snapshot-1', sourceRevisions: { source: '1' } },
  evidence: { kind: 'observed', source: { id: 'source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};

export const rows = [
  { id: 'a', name: 'Ada', amount: { decimal: '12.50' }, baseline: { decimal: '10.00' }, department: 'Sales' },
  { id: 'b', name: 'Bea', amount: { decimal: '7.00' }, baseline: { decimal: '7.00' }, department: 'Design' },
] as const;

export const binding: AeliqoDataBinding = { result, rows };

export const registryOptions = {
  data: [binding],
  resolveEntity: () => 'person',
} satisfies AeliqoPresentationRegistryOptions;

export const dataConfigs: Readonly<Record<string, PresentationValues>> = {
  'data.metric': { field: 'amount', identityValues: { id: 'a' } },
  'data.delta': { currentField: 'amount', baselineField: 'baseline', mode: 'absolute', identityValues: { id: 'a' } },
  'data.key-value': { items: [{ field: 'name' }, { field: 'department' }], identityValues: { id: 'a' } },
  'data.detail': { fields: ['id', 'name', 'amount', 'department'], identityValues: { id: 'a' } },
  'data.record-list': { selection: 'single' },
  'data.card-collection': {},
  'control.filter-builder': { field: 'name', outputId: 'people' },
  'data.selection-summary': { selection: 'none' },
};

export const dataManifestRefs: readonly VersionRef[] = [
  AELIQO_DATA_REFS.metric,
  AELIQO_DATA_REFS.delta,
  AELIQO_DATA_REFS.keyValue,
  AELIQO_DATA_REFS.detail,
  AELIQO_DATA_REFS.recordList,
  AELIQO_DATA_REFS.cardCollection,
  AELIQO_DATA_REFS.filterBuilder,
  AELIQO_DATA_REFS.selectionSummary,
];

const dataRoles: readonly string[] = [
  'metric',
  'delta',
  'keyValue',
  'detail',
  'recordList',
  'cardCollection',
  'filterBuilder',
  'selectionSummary',
];

const preconditions = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: 'task-1',
  regionRevision: 'region-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-1',
  functionRegistryDigest: 'functions-1',
  results: [resultRef],
} as const;

export function dataPresentationPlan(): PresentationPlan {
  const leaves: PresentationPlan['nodes'] = dataManifestRefs.map((representation, index) => ({
    id: [
      'metric',
      'delta',
      'key-value',
      'detail',
      'record-list',
      'card-collection',
      'filter-builder',
      'selection-summary',
    ][index]!,
    role: dataRoles[index]!,
    representation,
    result: resultRef,
    config: {
      schema: {
        'data.metric': { id: 'data.metric.config', revision: '1' },
        'data.delta': { id: 'data.delta.config', revision: '1' },
        'data.key-value': { id: 'data.key-value.config', revision: '1' },
        'data.detail': { id: 'data.detail.config', revision: '1' },
        'data.record-list': { id: 'data.record-list.config', revision: '1' },
        'data.card-collection': { id: 'data.card-collection.config', revision: '1' },
        'control.filter-builder': { id: 'control.filter-builder.config', revision: '1' },
        'data.selection-summary': { id: 'data.selection-summary.config', revision: '1' },
      }[representation.id]!,
      values: dataConfigs[representation.id]!,
    },
    children: [],
  }));
  return {
    id: 'plan-data-semantic',
    revision: 'plan-1',
    rootId: 'root',
    preconditions,
    nodes: [
      {
        id: 'root',
        role: 'structure',
        representation: AELIQO_PRESENTATION_REFS.stack,
        config: { schema: AELIQO_CONFIG_SCHEMAS.stack, values: {} },
        children: leaves.map((node) => node.id),
      },
      ...leaves,
    ],
    links: [],
    coverage: [
      {
        needId: 'read',
        nodeIds: ['metric', 'delta', 'key-value', 'detail', 'record-list', 'card-collection'],
        operations: [{ id: 'data.read', revision: '1' }],
      },
      { needId: 'compare', nodeIds: ['delta'], operations: [{ id: 'data.compare', revision: '1' }] },
      { needId: 'selection', nodeIds: ['record-list'], operations: [{ id: 'interaction.selection', revision: '1' }] },
      { needId: 'filter', nodeIds: ['filter-builder'], operations: [{ id: 'data.filter', revision: '1' }] },
    ],
    stateTransfer: [],
    diagnostics: [],
  };
}

export function dataPresentationContext(): PresentationContext {
  const representations = [AELIQO_PRESENTATION_REFS.stack, ...dataManifestRefs];
  return {
    task: {
      version: '1',
      id: 'task-data-semantic',
      revision: 'task-1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'functions-1',
      regionId: 'region-1',
      goal: 'Present the authorized people result',
      needs: [
        {
          id: 'read',
          operation: { id: 'data.read', revision: '1' },
          fields: ['id', 'name', 'amount', 'baseline', 'department'],
          outputId: 'people',
          required: true,
        },
        {
          id: 'compare',
          operation: { id: 'data.compare', revision: '1' },
          fields: ['amount', 'baseline'],
          outputId: 'people',
          required: true,
        },
        {
          id: 'selection',
          operation: { id: 'interaction.selection', revision: '1' },
          fields: ['id'],
          outputId: 'people',
          required: true,
        },
        {
          id: 'filter',
          operation: { id: 'data.filter', revision: '1' },
          fields: ['name'],
          outputId: 'people',
          required: true,
        },
      ],
      assumptions: [],
      kind: 'presentation',
      inputs: [resultRef],
    },
    experience: {
      version: '1',
      id: 'experience-data-semantic',
      revision: 'experience-1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: representations.map((ref) => ref.id),
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 16, maxExpansions: 16 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [result],
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
