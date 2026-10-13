import {
  VarendoBreakdownElement,
  VarendoComparisonElement,
  VarendoExplorerElement,
  VarendoFormFlowElement,
  VarendoInvestigationElement,
  VarendoQualityPanelElement,
  VarendoRecordEditorElement,
  VarendoSearchResultsElement,
} from '@varendo/web/compound';
import { VarendoDateRangeElement, VarendoTextFieldElement } from '@varendo/web/inputs';
import {
  catalogColumns,
  catalogFields,
  catalogRef,
  catalogRows,
  catalogScope,
  catalogVisualizationContext,
  catalogVisualizationDataset,
  catalogVisualizationSpecs,
  cleanupCatalogRoot,
  createCatalogElement,
  createCatalogRoot,
} from './fixture.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';
import { catalogMountSource, catalogSource } from './source.js';

const sourceImports = `import {
  VarendoBreakdownElement,
  VarendoComparisonElement,
  VarendoExplorerElement,
  VarendoFormFlowElement,
  VarendoInvestigationElement,
  VarendoQualityPanelElement,
  VarendoRecordEditorElement,
  VarendoSearchResultsElement,
  } from "@varendo/web/compound";`;
const sourceInputImports = `import {VarendoDateRangeElement, VarendoTextFieldElement} from "@varendo/web/inputs";`;
const sourceTypeImports = `import type {ResultRef, Scalar} from "@varendo/core";
import type {VisualizationBindingContext, VisualizationSpec} from "@varendo/core/visualization";
import type {VarendoDataColumn, VarendoDataScope, VarendoFieldOption} from "@varendo/web/data";
import type {VisualizationDataset} from "@varendo/web/visualization";`;

const sourceSetup = `${sourceInputImports}
${sourceTypeImports}

const catalogRef: ResultRef = {
  id: "varendo-catalog-example",
  revision: "1",
  outputId: "people",
  queryDigest: "catalog-query",
  scopeDigest: "catalog-scope",
};
const catalogRows: readonly Readonly<Record<string, Scalar>>[] = [
  {id: "ada", name: "Ada Lovelace", team: "Research", date: "2026-09-08", amount: 120},
  {id: "lin", name: "Lin Chen", team: "Product", date: "2026-09-09", amount: 96},
  {id: "grace", name: "Grace Hopper", team: "Research", date: "2026-09-10", amount: 144},
];
const catalogColumns: readonly VarendoDataColumn[] = [
  {key: "id", label: "ID", type: "text", sortable: true},
  {key: "name", label: "Name", type: "text", sortable: true},
  {key: "team", label: "Team", type: "text"},
  {key: "date", label: "Date", type: "date", sortable: true},
  {key: "amount", label: "Amount", type: "integer", align: "end"},
];
const catalogFields: readonly VarendoFieldOption[] = [
  {id: "name", label: "Name", type: "text"},
  {id: "team", label: "Team", type: "text"},
  {id: "amount", label: "Amount", type: "integer"},
];
const catalogScope: VarendoDataScope = {loaded: catalogRows.length, filteredTotal: catalogRows.length, populationDigest: catalogRef.scopeDigest, kind: "filtered", label: "Authorized people"};
const catalogVisualizationContext: VisualizationBindingContext = {results: []};
const catalogVisualizationDataset: VisualizationDataset = {result: catalogRef, rows: catalogRows};
const catalogVisualizationSpecs: Readonly<Record<"trend", VisualizationSpec>> = {trend: {version: "1", view: "trend", plot: {version: "1", root: {kind: "unit", mark: "line", result: catalogRef, missing: "gap", encoding: {x: {field: "date", scale: "temporal"}, y: {field: "amount", scale: "linear"}}}}}};`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  explorer: {
    fixture: 'A people explorer combining authorized filters, a single-select record collection, and selected detail.',
    props: [
      'fields',
      'predicate',
      'rows',
      'columns',
      'identity',
      'entity',
      'selectedKey',
      'detailRecord',
      'result',
      'scope',
      'selection',
      'status',
    ],
    propsNotes:
      'Filter and selection requests retain result lineage and scope; persistence, navigation, and query execution remain with the host.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Arrow keys in child controls', 'Enter or Space', 'focus follows stable identity'],
    events: ['varendo-explorer-filter', 'varendo-explorer-selection'],
    expectedOutcome:
      'The three panels share one scope and stable identity while emitting typed filter and selection requests.',
  },
  comparison: {
    fixture: 'A two-person comparison with amount metrics in one authorized scope.',
    props: ['compareSet', 'compareKeys', 'metrics', 'entity', 'result', 'scope', 'compatible', 'status'],
    propsNotes:
      'Comparison keys and compatible metric meanings are host supplied; the component does not infer a causal difference.',
    states: ['ready', 'partial', 'stale', 'error', 'invalid'],
    keyboard: ['Tab', 'Arrow keys across comparison controls', 'Enter or Space'],
    events: ['varendo-comparison-set'],
    expectedOutcome: 'The selected comparison set stays bounded and emits a typed set request with scope lineage.',
  },
  breakdown: {
    fixture: 'Two authorized team groups with exact record counts and selectable group rows.',
    props: ['groups', 'rows', 'columns', 'identity', 'entity', 'result', 'scope', 'selectedGroup', 'status'],
    propsNotes: 'Group keys and values are supplied by the host; group selection does not expand result scope.',
    states: ['ready', 'empty', 'partial', 'loading', 'stale', 'error'],
    keyboard: ['Tab', 'Arrow keys', 'Enter or Space'],
    events: ['varendo-breakdown-group'],
    expectedOutcome: 'The breakdown preserves group identity and emits a host request when a group is selected.',
  },
  investigation: {
    fixture: 'A people investigation with baseline, trend evidence, and selected record detail.',
    props: [
      'trend',
      'trendContext',
      'trendDatasets',
      'events',
      'eventContext',
      'eventDatasets',
      'baseline',
      'detailRecord',
      'detailFields',
      'result',
      'scope',
      'status',
    ],
    propsNotes:
      'Trend and event specs remain evidence in the selected scope; associations are not upgraded to causal claims.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Arrow keys in child visualizations', 'Enter selects evidence'],
    events: ['Child varendo-visualization-select events'],
    expectedOutcome:
      'The investigation aligns baseline, evidence visualizations, and detail without changing their lineage.',
  },
  'search-results': {
    fixture: 'A research query result with revision metadata and one selected record.',
    props: [
      'query',
      'queryRevision',
      'resultRevision',
      'rows',
      'columns',
      'identity',
      'selectedKey',
      'result',
      'scope',
      'count',
      'detailRecord',
      'status',
    ],
    propsNotes: 'Query and result revisions expose stale results explicitly; selection remains an identity request.',
    states: ['ready', 'stale', 'empty', 'loading', 'partial', 'error'],
    keyboard: ['Tab', 'Enter', 'Space', 'focus follows stable identity'],
    events: ['varendo-search-results-selection'],
    expectedOutcome: 'The result window labels stale revisions and emits selection requests only for supplied rows.',
  },
  'record-editor': {
    fixture: 'An Ada record editor with name and reporting-period fields plus explicit entity revision.',
    props: [
      'entity',
      'entityKey',
      'entityRevision',
      'action',
      'status',
      'disabled',
      'invalid',
      'saveLabel',
      'cancelLabel',
    ],
    propsNotes:
      'The entity key and revision are required evidence for save/cancel requests; the host authorizes the resulting action.',
    states: ['ready', 'invalid', 'pending', 'error', 'disabled'],
    keyboard: [
      'Tab follows slotted field order',
      'Enter on save',
      'Escape or cancel preserves draft',
      'IME composition',
    ],
    events: ['varendo-record-editor-save', 'varendo-record-editor-cancel'],
    expectedOutcome:
      'The editor validates its fields and emits a versioned save or cancel proposal without persisting it.',
  },
  'form-flow': {
    fixture: 'A two-step identity/review flow with a slotted field for each step.',
    props: ['steps', 'activeStep', 'draft', 'validation', 'status', 'nextLabel', 'backLabel', 'commitLabel'],
    propsNotes:
      'Draft and validation are host-visible; step transitions and commit are typed requests with preserved focus.',
    states: ['ready', 'invalid', 'pending', 'error', 'disabled'],
    keyboard: [
      'Tab follows current step',
      'Enter on next/commit',
      'Arrow keys within controls',
      'focus moves to new step',
    ],
    events: ['varendo-form-flow-step', 'varendo-form-flow-commit'],
    expectedOutcome: 'The flow preserves drafts and focus while emitting step or commit proposals after validation.',
  },
  'quality-panel': {
    fixture: 'A quality panel reporting source, freshness, completeness, provenance, and one unsupported claim.',
    props: ['source', 'freshness', 'completeness', 'provenance', 'unsupportedClaims', 'state', 'status'],
    propsNotes:
      'Quality metadata is host evidence; unsupported claims remain visible as cautions and are never presented as facts.',
    states: ['ready', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Tab reaches any host-provided links', 'Not otherwise interactive'],
    events: ['None; read-only evidence surface'],
    expectedOutcome: 'The panel makes freshness, completeness, provenance, and unsupported claims explicit.',
  },
};

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'compound',
    description: 'A semantic compound coordinating owned primitives around a typed task outcome.',
    fixture:
      'A host-owned compound with shared rows, scope, result lineage, and slotted form controls where the contract calls for them.',
    props: ['rows', 'scope', 'result', 'status', 'host-owned actions', 'slotted fields where applicable'],
    propsNotes:
      'Compounds coordinate primitives and emit typed requests; application code owns persistence, navigation, and execution.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error', 'invalid'],
    keyboard: [
      'Tab',
      'Arrow keys within child controls',
      'Enter or Space commits the focused host action',
      'focus and draft are preserved across steps',
    ],
    events: [
      'compound-specific typed interaction events',
      'varendo-record-editor-save',
      'varendo-form-flow-step',
      'varendo-form-flow-commit',
    ],
    expectedOutcome:
      'The compound shares one scope and result lineage across its child primitives while leaving business actions with the host.',
    ...componentNotes[id],
    source: catalogSource({ imports: sourceImports, setup: sourceSetup, mount: catalogMountSource(id) }),
    result: catalogRef,
  },
  mount(container) {
    const root = createCatalogRoot(container);
    fn(root);
    return cleanupCatalogRoot(root);
  },
});

export const compoundExamples: readonly CatalogExampleDefinition[] = [
  mount('explorer', (root) => {
    const element = createCatalogElement<VarendoExplorerElement>('varendo-explorer', root, VarendoExplorerElement);
    element.fields = catalogFields;
    element.rows = catalogRows;
    element.columns = catalogColumns;
    element.identity = ['id'];
    element.entity = 'person';
    element.selectedKey = 'string:3:ada';
    element.detailRecord = catalogRows[0];
    element.detailFields = catalogColumns;
    element.result = catalogRef;
    element.scope = catalogScope;
    element.selection = 'single';
  }),
  mount('comparison', (root) => {
    const element = createCatalogElement<VarendoComparisonElement>(
      'varendo-comparison',
      root,
      VarendoComparisonElement,
    );
    element.compareSet = [
      { key: 'ada', label: 'Ada' },
      { key: 'grace', label: 'Grace' },
    ];
    element.compareKeys = ['ada', 'grace'];
    element.entity = 'person';
    element.metrics = [
      { id: 'amount', label: 'Amount', unit: 'records', values: { ada: 120, grace: 144 } },
      { id: 'team', label: 'Team', values: { ada: 'Research', grace: 'Research' } },
    ];
    element.result = catalogRef;
    element.scope = catalogScope;
  }),
  mount('breakdown', (root) => {
    const element = createCatalogElement<VarendoBreakdownElement>('varendo-breakdown', root, VarendoBreakdownElement);
    element.groups = [
      { key: 'research', label: 'Research', value: 264, unit: 'records', recordCount: 2 },
      { key: 'product', label: 'Product', value: 96, unit: 'records', recordCount: 1 },
    ];
    element.rows = catalogRows;
    element.columns = catalogColumns;
    element.identity = ['id'];
    element.entity = 'person';
    element.result = catalogRef;
    element.scope = catalogScope;
  }),
  mount('investigation', (root) => {
    const element = createCatalogElement<VarendoInvestigationElement>(
      'varendo-investigation',
      root,
      VarendoInvestigationElement,
    );
    element.entity = 'person';
    element.result = catalogRef;
    element.scope = catalogScope;
    element.baseline = 100;
    element.detailRecord = catalogRows[0];
    element.detailFields = catalogColumns;
    element.trend = catalogVisualizationSpecs.trend;
    element.trendContext = catalogVisualizationContext;
    element.trendDatasets = [catalogVisualizationDataset];
  }),
  mount('search-results', (root) => {
    const element = createCatalogElement<VarendoSearchResultsElement>(
      'varendo-search-results',
      root,
      VarendoSearchResultsElement,
    );
    element.query = 'research';
    element.queryRevision = 'query-2';
    element.resultRevision = catalogRef.revision;
    element.rows = catalogRows;
    element.columns = catalogColumns;
    element.identity = ['id'];
    element.selectedKey = 'string:3:ada';
    element.entity = 'person';
    element.result = catalogRef;
    element.scope = catalogScope;
    element.count = catalogRows.length;
    element.detailRecord = catalogRows[0];
    element.detailFields = catalogColumns;
  }),
  mount('record-editor', (root) => {
    const element = createCatalogElement<VarendoRecordEditorElement>(
      'varendo-record-editor',
      root,
      VarendoRecordEditorElement,
    );
    element.entity = 'person';
    element.entityKey = 'string:3:ada';
    element.entityRevision = 'person-revision-1';
    const name = document.createElement('varendo-text-field') as VarendoTextFieldElement;
    name.label = 'Name';
    name.name = 'name';
    name.value = 'Ada Lovelace';
    const period = document.createElement('varendo-date-range') as VarendoDateRangeElement;
    period.label = 'Review period';
    period.name = 'period';
    period.start = '2026-09-01';
    period.end = '2026-09-30';
    element.append(name, period);
  }),
  mount('form-flow', (root) => {
    const element = createCatalogElement<VarendoFormFlowElement>('varendo-form-flow', root, VarendoFormFlowElement);
    element.steps = [
      { id: 'identity', label: 'Identity', fieldNames: ['name'] },
      { id: 'review', label: 'Review', fieldNames: ['period'] },
    ];
    element.activeStep = 'identity';
    element.draft = { name: 'Ada Lovelace' };
    const identity = document.createElement('div');
    identity.slot = 'step-identity';
    const name = document.createElement('varendo-text-field') as VarendoTextFieldElement;
    name.label = 'Name';
    name.name = 'name';
    name.value = 'Ada Lovelace';
    identity.append(name);
    const review = document.createElement('div');
    review.slot = 'step-review';
    review.textContent = 'Review the authorized values before commit.';
    element.append(identity, review);
  }),
  mount('quality-panel', (root) => {
    const element = createCatalogElement<VarendoQualityPanelElement>(
      'varendo-quality-panel',
      root,
      VarendoQualityPanelElement,
    );
    element.source = 'People registry';
    element.freshness = '2026-09-09 09:00 UTC';
    element.completeness = '3 of 3 rows loaded';
    element.provenance = ['Authorized local snapshot', 'Query: catalog-query'];
    element.unsupportedClaims = ['This view does not establish causation.'];
    element.state = {
      source: element.source,
      freshness: element.freshness,
      completeness: element.completeness,
      provenance: element.provenance,
      unsupportedClaims: element.unsupportedClaims,
    };
  }),
];
