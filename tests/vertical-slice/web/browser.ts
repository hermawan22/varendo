import { registerAeliqoElements } from '../../../packages/web/src/register.js';
import type { AeliqoRegionElement } from '../../../packages/web/src/region/aeliqo-region.js';
import type { AeliqoRegionResult } from '../../../packages/web/src/region/types.js';
import type { AeliqoTableColumn } from '../../../packages/web/src/types.js';
import type { Result, ResultRef } from '../../../packages/core/src/index.js';
import type { InteractionPort } from '../../../packages/core/src/interaction/index.js';
import type { ValidatedPresentation } from '../../../packages/core/src/presentation/index.js';

registerAeliqoElements();

const region = document.querySelector<AeliqoRegionElement>('#region')!;
const ref: ResultRef = {
  id: 'rows-result',
  revision: '1',
  sourceLineage: 'fixture-source',
  outputId: 'rows',
  queryDigest: 'query',
  scopeDigest: 'scope',
};
const events: unknown[] = [];

type ResolvedNode = ValidatedPresentation['nodes'][number];
type NodeValues = ResolvedNode['config']['values'];
type NodePorts = readonly InteractionPort[];

function result(fields: Result['fields'], loaded: number, identity: readonly string[], revision: string): Result {
  return {
    version: '1',
    ref: { ...ref, revision },
    taskId: 'task',
    fields,
    identity,
    rowGrain: identity,
    counts: { loaded, population: { kind: 'exact', value: loaded, populationDigest: `fixture-${revision}` } },
    precision: { kind: 'exact' },
    coverage: { kind: 'complete', populationDigest: `fixture-${revision}` },
    consistency: { kind: 'snapshot', snapshotId: `fixture-${revision}`, sourceRevisions: { fixture: revision } },
    evidence: { kind: 'observed', source: { id: 'fixture', revision: '1' } },
    filters: [],
    warnings: [],
    lineage: [],
  };
}

function node(
  id: string,
  role: ResolvedNode['node']['role'],
  representation: ResolvedNode['node']['representation']['id'],
  values: NodeValues,
  fields: readonly string[],
  resultDescriptor: Result | undefined,
  ports: NodePorts = [],
): ResolvedNode {
  const representationRef = { id: representation, revision: '1' };
  return {
    node: {
      id,
      role,
      representation: representationRef,
      ...(resultDescriptor === undefined ? {} : { result: resultDescriptor.ref }),
      config: { schema: { id: `${representation}.config`, revision: '1' }, values },
      children: [],
    },
    manifest: representationRef,
    config: { values, fields, ports },
    result: resultDescriptor,
  };
}

function presentation(children: readonly string[], nodes: readonly ResolvedNode[]): ValidatedPresentation {
  const byId = new Map(nodes.map((entry) => [entry.node.id, entry]));
  const layout = node('layout', 'structure', 'layout.stack', { gap: 4 }, [], undefined);
  const layoutNode: ResolvedNode = { ...layout, node: { ...layout.node, children } };
  byId.set('layout', layoutNode);
  const plan: ValidatedPresentation['plan'] = {
    id: 'fixture-plan',
    revision: '1',
    rootId: 'layout',
    preconditions: {
      scopeDigest: 'scope',
      policyRevision: 'policy',
      taskRevision: 'task',
      regionRevision: 'region',
      catalogRevision: 'catalog',
      experienceRevision: 'experience',
      functionRegistryDigest: 'functions',
      results: [
        ...new Map(
          nodes.flatMap((entry) =>
            entry.result ? [[JSON.stringify(entry.result.ref), entry.result.ref] as const] : [],
          ),
        ).values(),
      ],
    },
    nodes: [...byId.values()].map((entry) => entry.node),
    links: [],
    coverage: [],
    stateTransfer: [],
    diagnostics: [],
  };
  const graph: ValidatedPresentation['graph'] = { nodes: [], links: [], mappings: [] };
  const environment: ValidatedPresentation['environment'] = {
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
  };
  return { plan, nodes: [...byId.values()], graph, environment };
}

const textField = {
  id: 'employee.id',
  label: 'Employee ID',
  type: { value: 'text', nullable: false },
  role: 'identity',
} as const satisfies Result['fields'][number];
const departmentField = {
  id: 'department',
  label: 'Department',
  type: { value: 'text', nullable: false },
  role: 'dimension',
} as const satisfies Result['fields'][number];
const weekField = {
  id: 'week',
  label: 'Week',
  type: { value: 'instant', nullable: false },
  role: 'time',
} as const satisfies Result['fields'][number];
const amountField = {
  id: 'absence',
  label: 'Absence',
  type: { value: 'decimal', nullable: true },
  role: 'measure',
} as const satisfies Result['fields'][number];

const selectionRows = [
  { 'employee.id': 'e1', department: 'People' },
  { 'employee.id': 'e2', department: 'Sales' },
];
const selectionResult = result([textField, departmentField], selectionRows.length, ['employee.id'], 'selection');
const tableColumns: readonly AeliqoTableColumn[] = [
  { key: 'employee.id', label: 'Employee ID' },
  { key: 'department', label: 'Department' },
];

const trendRows = [
  { 'employee.id': 'e1', week: '2026-01-01T00:00:00Z', absence: 1 },
  { 'employee.id': 'e1', week: '2026-01-08T00:00:00Z', absence: null },
  { 'employee.id': 'e1', week: '2026-01-15T00:00:00Z', absence: 2 },
  { 'employee.id': 'e2', week: '2026-01-01T00:00:00Z', absence: 0 },
  { 'employee.id': 'e2', week: '2026-01-15T00:00:00Z', absence: 1 },
  { 'employee.id': 'e3', week: '2026-01-01T00:00:00Z', absence: 2 },
  { 'employee.id': 'e3', week: '2026-01-08T00:00:00Z', absence: 2 },
  { 'employee.id': 'e3', week: '2026-01-15T00:00:00Z', absence: 3 },
  { 'employee.id': 'e4', week: '2026-01-01T00:00:00Z', absence: 3 },
  { 'employee.id': 'e4', week: '2026-01-08T00:00:00Z', absence: 2 },
  { 'employee.id': 'e4', week: '2026-01-15T00:00:00Z', absence: 4 },
  { 'employee.id': 'e5', week: '2026-01-01T00:00:00Z', absence: 4 },
  { 'employee.id': 'e5', week: '2026-01-08T00:00:00Z', absence: 3 },
  { 'employee.id': 'e5', week: '2026-02-01T00:00:00Z', absence: 6 },
].map((row) => ({ ...row, absence: row.absence === null ? null : { decimal: String(row.absence) } }));
const trendResult = result([textField, weekField, amountField], trendRows.length, ['employee.id', 'week'], 'trend');
const subMillisecondTrendRows = [
  { 'employee.id': 'e1', week: '2026-01-01T00:00:00.0001Z', absence: 1 },
  { 'employee.id': 'e1', week: '2026-01-01T00:00:00.0009Z', absence: 2 },
].map((row) => ({ ...row, absence: { decimal: String(row.absence) } }));
const subMillisecondResult = result(
  [textField, weekField, amountField],
  subMillisecondTrendRows.length,
  ['employee.id', 'week'],
  'submillisecond',
);

function mountFilters(order: readonly string[] = ['filter-a', 'filter-b']): void {
  const filterA = node(
    'filter-a',
    'filter',
    'control.filter',
    { field: 'department', outputId: 'rows' },
    ['department'],
    selectionResult,
    [{ id: 'filter', direction: 'output', payload: 'filter' }],
  );
  const filterB = node(
    'filter-b',
    'filter',
    'control.filter',
    { field: 'department', outputId: 'rows' },
    ['department'],
    selectionResult,
    [{ id: 'filter', direction: 'output', payload: 'filter' }],
  );
  region.results = [
    { ref: selectionResult.ref, rows: selectionRows, columns: tableColumns } satisfies AeliqoRegionResult,
  ];
  region.presentation = presentation(order, [filterA, filterB]);
}

function mountSelection(): void {
  const table = node(
    'table',
    'table',
    'data.table',
    { selection: 'multiple' },
    ['employee.id', 'department'],
    selectionResult,
    [
      {
        id: 'selection',
        direction: 'inout',
        payload: 'selection',
        entity: 'employees',
        identity: ['employee.id'],
        grain: ['employee.id'],
      },
    ],
  );
  region.results = [
    { ref: selectionResult.ref, rows: selectionRows, columns: tableColumns } satisfies AeliqoRegionResult,
  ];
  region.presentation = presentation(['table'], [table]);
}

function mountTrend(): void {
  const trend = node(
    'trend',
    'trend',
    'data.trend',
    { labelField: 'week', series: [{ field: 'absence', label: 'Absence' }], seriesBy: ['employee.id'] },
    ['week', 'employee.id', 'absence'],
    trendResult,
  );
  region.results = [{ ref: trendResult.ref, rows: trendRows } satisfies AeliqoRegionResult];
  region.presentation = presentation(['trend'], [trend]);
}

function mountSubMillisecondTrend(): void {
  const trend = node(
    'trend',
    'trend',
    'data.trend',
    { labelField: 'week', series: [{ field: 'absence', label: 'Absence' }], seriesBy: ['employee.id'] },
    ['week', 'employee.id', 'absence'],
    subMillisecondResult,
  );
  region.results = [{ ref: subMillisecondResult.ref, rows: subMillisecondTrendRows } satisfies AeliqoRegionResult];
  region.presentation = presentation(['trend'], [trend]);
}

region.onSemanticInteraction = (event) => events.push(event);
Object.assign(window, {
  aeliqoReady: true,
  aeliqoEvents: events,
  mountFilters,
  mountSelection,
  mountTrend,
  mountSubMillisecondTrend,
  reorderFilters: () => mountFilters(['filter-b', 'filter-a']),
});
mountFilters();
