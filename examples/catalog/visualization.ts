import {
  VarendoAreaElement,
  VarendoBarElement,
  VarendoCalendarGridElement,
  VarendoHeatmapElement,
  VarendoHistogramElement,
  VarendoMatrixElement,
  VarendoRelationshipElement,
  VarendoScatterElement,
  VarendoTimelineElement,
  VarendoTrendElement,
  VarendoTreeElement,
  VarendoTreemapElement,
} from '@varendo/web/visualization';
import type { VisualizationSpec } from '@varendo/core/visualization';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import type { VisualizationDataset } from '@varendo/web/visualization';
import {
  catalogRef,
  catalogTemporalSpecs,
  catalogVisualizationContext,
  catalogVisualizationDataset,
  catalogVisualizationSpecs,
  createCatalogElement,
  createCatalogRoot,
  cleanupCatalogRoot,
  hierarchyContext,
  hierarchyDataset,
  hierarchySpec,
  relationshipContext,
  relationshipDataset,
  relationshipSpec,
  treemapSpec,
} from './fixture.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';
import { catalogMountSource, catalogSource } from './source.js';
import { visualizationKeyboard } from './visualization-keyboard.js';

const sourceImports = `import {
  VarendoAreaElement,
  VarendoBarElement,
  VarendoCalendarGridElement,
  VarendoHeatmapElement,
  VarendoHistogramElement,
  VarendoMatrixElement,
  VarendoRelationshipElement,
  VarendoScatterElement,
  VarendoTimelineElement,
  VarendoTrendElement,
  VarendoTreeElement,
  VarendoTreemapElement,
  } from "@varendo/web/visualization";
`;

const sourceTypeImports = `import type {Catalog,
  PlotUnit,
  Result,
  ResultRef,
  Scalar,
} from "@varendo/core";
import type {VisualizationBindingContext, VisualizationSpec} from "@varendo/core/visualization";
import type {VisualizationDataset} from "@varendo/web/visualization";`;

const sourceSetup = `${sourceTypeImports}

const catalogRef: ResultRef = {
  id: "varendo-catalog-example",
  revision: "1",
  outputId: "people",
  queryDigest: "catalog-query",
  scopeDigest: "catalog-scope",
};
const rows: readonly Readonly<Record<string, Scalar>>[] = [
  {id: "ada", name: "Ada Lovelace", team: "Research", date: "2026-09-08", amount: 120, low: 80, high: 100, zero: 0},
  {id: "lin", name: "Lin Chen", team: "Product", date: "2026-09-09", amount: 96, low: 100, high: 140, zero: 0},
  {id: "grace", name: "Grace Hopper", team: "Research", date: "2026-09-10", amount: 144, low: 140, high: 160, zero: 0},
];
const text = {value: "text", nullable: false} as const;
const integer = {value: "integer", nullable: false} as const;
const date = {value: "date", nullable: false, temporal: {calendar: "gregory", grain: "day"}} as const;
const meaning = {
  id: "amount",
  revision: "1",
  label: "Amount",
  explanation: "Authorized additive amount",
  output: integer,
  implementation: {kind: "host-capability", capability: {id: "amount", revision: "1"}},
  dependencies: [],
  functionRegistryDigest: "catalog-functions",
  origin: "manual",
  lifecycle: "active",
  scope: "workspace",
  authority: "reviewed",
  aggregation: "additive",
  aggregationDimensions: [],
  missingPolicy: "reject",
} as const;
const peopleEntity: Catalog["entities"][number] = {
  id: "people",
  label: "People",
  identity: ["id"],
  rowGrain: ["id"],
  fields: [
    {id: "id", label: "ID", role: "identity", type: text},
    {id: "name", label: "Name", role: "attribute", type: text},
    {id: "team", label: "Team", role: "dimension", type: text},
    {id: "date", label: "Date", role: "time", type: date},
    {id: "amount", label: "Amount", role: "measure", type: integer, derivation: {id: "amount", revision: "1"}},
    {id: "low", label: "Bin start", role: "dimension", type: integer},
    {id: "high", label: "Bin end", role: "dimension", type: integer},
    {id: "zero", label: "Baseline", role: "measure", type: integer},
  ],
};
const catalog: Catalog = {
  version: "1",
  revision: "catalog-1",
  functionRegistryDigest: "catalog-functions",
  entities: [peopleEntity],
  relationships: [],
  meanings: [meaning],
  capabilities: [],
};
const catalogResult: Result = {
  version: "1",
  ref: catalogRef,
  taskId: "catalog-example-task",
  identity: ["id"],
  rowGrain: ["id", "date", "team", "name", "low", "high"],
  fields: peopleEntity.fields,
  counts: {loaded: rows.length, population: {kind: "unknown"}},
  precision: {kind: "exact"},
  coverage: {kind: "complete", populationDigest: catalogRef.scopeDigest},
  consistency: {kind: "snapshot", snapshotId: "catalog-snapshot", sourceRevisions: {people: "1"}},
  evidence: {kind: "computed", queryDigest: catalogRef.queryDigest, definitions: []},
  filters: [],
  warnings: [],
  lineage: [],
};
const plot = (mark: PlotUnit["mark"], encoding: PlotUnit["encoding"]): PlotUnit => ({kind: "unit", mark, result: catalogRef, missing: "gap", encoding});
const catalogVisualizationSpecs: Readonly<Record<"trend" | "bar" | "area" | "scatter" | "histogram" | "heatmap", VisualizationSpec>> = {
  trend: {version: "1", view: "trend", plot: {version: "1", root: plot("line", {x: {field: "date", scale: "temporal"}, y: {field: "amount", scale: "linear"}})}},
  bar: {version: "1", view: "bar", plot: {version: "1", root: plot("bar", {x: {field: "team", scale: "ordinal"}, y: {field: "amount", scale: "linear", zero: true}, series: {field: "name", scale: "ordinal"}})}},
  area: {version: "1", view: "area", plot: {version: "1", root: plot("area", {x: {field: "date", scale: "temporal"}, y: {field: "amount", scale: "linear", zero: true}})}, meaning: {id: "amount", revision: "1"}, stack: "none"},
  scatter: {version: "1", view: "scatter", plot: {version: "1", root: plot("point", {x: {field: "amount", scale: "linear"}, y: {field: "amount", scale: "linear"}})}},
  histogram: {version: "1", view: "histogram", plot: {version: "1", root: plot("rect", {x: {field: "low", scale: "linear"}, x2: {field: "high", scale: "linear"}, y: {field: "amount", scale: "linear", zero: true}, y2: {field: "zero", scale: "linear", zero: true}})}, bins: {start: "low", end: "high", value: "amount", measure: "count", boundary: "start-inclusive-end-exclusive"}},
  heatmap: {version: "1", view: "heatmap", plot: {version: "1", root: plot("cell", {x: {field: "team", scale: "ordinal"}, y: {field: "name", scale: "ordinal"}, color: {field: "amount", scale: "linear"}})}},
};
const catalogTemporalSpecs: Readonly<Record<"matrix" | "timeline" | "calendar-grid", VisualizationSpec>> = {
  matrix: {version: "1", view: "matrix", result: catalogRef, columns: ["name", "team", "amount"]},
  timeline: {version: "1", view: "timeline", result: catalogRef, start: "date"},
  "calendar-grid": {version: "1", view: "calendar-grid", result: catalogRef, date: "date"},
};
const catalogVisualizationDataset: VisualizationDataset = {result: catalogRef, rows};
const catalogVisualizationContext: VisualizationBindingContext = {results: [catalogResult], catalog};
const histogramSpec = catalogVisualizationSpecs.histogram as Extract<VisualizationSpec, {view: "histogram"}>;
const histogramContext: VisualizationBindingContext = {...catalogVisualizationContext, histograms: [{result: catalogRef, bins: histogramSpec.bins}]};
const hierarchyRef: ResultRef = {...catalogRef, id: "varendo-catalog-hierarchy", outputId: "nodes"};
const hierarchyRows: readonly Readonly<Record<string, Scalar>>[] = [
  {id: "company", parent: null, label: "Company", amount: 3},
  {id: "research", parent: "company", label: "Research", amount: 2},
  {id: "product", parent: "company", label: "Product", amount: 1},
];
const hierarchyResult: Result = {
  ...catalogResult,
  ref: hierarchyRef,
  taskId: "catalog-hierarchy-task",
  identity: ["id"],
  rowGrain: ["id"],
  fields: [
    {id: "id", label: "ID", role: "identity", type: text},
    {id: "parent", label: "Parent", role: "attribute", type: {...text, nullable: true}},
    {id: "label", label: "Label", role: "attribute", type: text},
    {id: "amount", label: "Amount", role: "measure", type: integer, derivation: {id: "amount", revision: "1"}},
  ],
  counts: {loaded: hierarchyRows.length, population: {kind: "unknown"}},
};
const hierarchyDataset: VisualizationDataset = {result: hierarchyRef, rows: hierarchyRows};
const hierarchySpec: VisualizationSpec = {version: "1", view: "tree", result: hierarchyRef, node: ["id"], parent: ["parent"], label: "label"};
const treemapSpec: VisualizationSpec = {...hierarchySpec, view: "treemap", value: "amount", meaning: {id: "amount", revision: "1"}};
const hierarchyContext: VisualizationBindingContext = {results: [hierarchyResult], catalog};
const relationshipRef: ResultRef = {...catalogRef, id: "varendo-catalog-relationship", outputId: "edges"};
const relationshipRows: readonly Readonly<Record<string, Scalar>>[] = [
  {edge: "e1", source: "research", target: "company"},
  {edge: "e2", source: "product", target: "company"},
];
const relationshipResult: Result = {
  ...hierarchyResult,
  ref: relationshipRef,
  identity: ["edge"],
  rowGrain: ["edge"],
  fields: [
    {id: "edge", label: "Edge", role: "identity", type: text},
    {id: "source", label: "Source", role: "dimension", type: text},
    {id: "target", label: "Target", role: "dimension", type: text},
  ],
  counts: {loaded: relationshipRows.length, population: {kind: "unknown"}},
};
const relationship: Catalog["relationships"][number] = {
  id: "reports-to",
  revision: "1",
  sourceEntity: "people",
  targetEntity: "people",
  keys: [{sourceField: "id", targetField: "id"}],
  cardinality: "many-to-one",
  optional: false,
  joinPolicy: "validated",
};
const relationshipDataset: VisualizationDataset = {result: relationshipRef, rows: relationshipRows};
const relationshipSpec: VisualizationSpec = {version: "1", view: "relationship", result: relationshipRef, source: ["source"], target: ["target"], relationship: {id: "reports-to", revision: "1"}};
const relationshipContext: VisualizationBindingContext = {
  results: [relationshipResult],
  catalog: {...catalog, relationships: [relationship]},
  relationships: [{result: relationshipRef, relationship: {id: "reports-to", revision: "1"}, source: ["source"], target: ["target"]}],
};
type CatalogVisualizationElement = HTMLElement & {
  visualization: VisualizationSpec | undefined;
  context: VisualizationBindingContext;
  datasets: readonly VisualizationDataset[];
  label: string;
  width: number;
  height: number;
  maxMarks: number;
  selectionEnabled: boolean;
};
function configure<T extends CatalogVisualizationElement>(element: T, visualization: VisualizationSpec, context: VisualizationBindingContext, datasets: readonly VisualizationDataset[] = [catalogVisualizationDataset]): T {
  element.visualization = visualization;
  element.context = context;
  element.datasets = datasets;
  element.label = "Sample people amounts";
  element.width = 640;
  element.height = 360;
  element.maxMarks = 500;
  element.selectionEnabled = true;
  return element;
}`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  trend: {
    fixture: 'A line trend over the authorized date and amount fields.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'The spec declares temporal x and measure y; dataset rows and Result lineage are supplied by the host.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The trend renders only the supplied Result scope and selection identifies the chosen row.',
  },
  bar: {
    fixture: 'A bar comparison by team with amount and person series.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes:
      'Ordinal dimensions and exact measure encodings come from the typed spec; the component does not aggregate new data.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Bars reflect the supplied team/person encodings and preserve result scope.',
  },
  area: {
    fixture: 'An area view over the authorized date and amount fields with an explicit non-stacked policy.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'The spec states stacking and missing-value policy; rendering never fills or invents missing rows.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The area preserves the declared missing-value treatment and exposes equivalent data access.',
  },
  scatter: {
    fixture: 'A point view comparing amount against amount for the bounded people rows.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'Both axes are explicit measure encodings; no trend or causal claim is inferred from position.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Points are drawn from supplied rows and any selection remains tied to Result identity.',
  },
  histogram: {
    fixture: 'Bounded low/high bins with amount as the exact value and count as the declared measure.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes:
      'Bin boundaries and measure are declared in the spec; the renderer does not silently choose a binning policy.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Bins render according to the declared boundary policy and remain scope-labelled.',
  },
  heatmap: {
    fixture: 'A team by person heatmap colored by exact amount.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'Both ordinal dimensions and the color measure are explicit; color does not replace text labels.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Cells preserve both dimensions and expose an accessible equivalent representation.',
  },
  matrix: {
    fixture: 'A temporal matrix of person, team, and amount columns.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'Column IDs come from the temporal spec and rows remain tied to the supplied result.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The matrix exposes the declared temporal columns without changing grain.',
  },
  timeline: {
    fixture: 'A timeline keyed by the authorized date field.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'The timeline start field is explicit and dates retain calendar semantics from the Result descriptor.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Events are placed on the declared date axis and remain linked to result identities.',
  },
  'calendar-grid': {
    fixture: 'A calendar grid keyed by the authorized date field.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'Calendar placement follows the spec and declared calendar descriptor; missing dates are not invented.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The calendar preserves date meaning and exposes the supplied rows through accessible data.',
  },
  tree: {
    fixture: 'A company-to-team hierarchy with explicit parent and node identity fields.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'Parent and node fields define hierarchy; the renderer does not infer relationships from labels.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The hierarchy preserves parent relationships and emits stable node selections.',
  },
  treemap: {
    fixture: 'A hierarchy treemap sized by the declared amount meaning.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes: 'The amount meaning and hierarchy fields are explicit; area is not treated as an unqualified metric.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'Treemap area follows the declared amount meaning and retains hierarchy scope.',
  },
  relationship: {
    fixture: 'Two explicit reports-to edges with source and target fields.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes:
      'Relationship identity and cardinality come from the catalog context; an edge does not establish causation.',
    states: ['ready', 'partial', 'empty', 'error'],
    keyboard: visualizationKeyboard,
    events: ['varendo-visualization-select'],
    expectedOutcome: 'The graph displays only declared edges and labels them as evidence within the supplied scope.',
  },
};

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'visualization',
    description:
      'A canonical visualization specification bound to an authorized Result and rendered by the shared web element.',
    fixture:
      'A typed VisualizationSpec, matching Result descriptor, and bounded dataset passed directly to the actual renderer.',
    props: ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks', 'selectionEnabled'],
    propsNotes:
      'The spec declares mark and encoding semantics; the host supplies authorized context, result lineage, and row data.',
    states: ['ready', 'partial', 'loading', 'empty', 'error'],
    keyboard: [
      'Tab',
      'Arrow keys move between marks or rows',
      'Enter selects the focused mark',
      'accessible data table remains available',
    ],
    events: ['varendo-visualization-select'],
    expectedOutcome:
      'The actual renderer shows the typed view, preserves Result scope, and exposes an equivalent accessible data representation.',
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

type CatalogVisualizationElement = HTMLElement & {
  visualization: VisualizationSpec | undefined;
  context: VisualizationBindingContext;
  datasets: readonly VisualizationDataset[];
  label: string;
  width: number;
  height: number;
  maxMarks: number;
  selectionEnabled: boolean;
};

function configure<T extends CatalogVisualizationElement>(
  element: T,
  visualization: VisualizationSpec,
  context: VisualizationBindingContext,
  datasets: readonly VisualizationDataset[] = [catalogVisualizationDataset],
): T {
  element.visualization = visualization;
  element.context = context;
  element.datasets = datasets;
  element.label = 'Sample people amounts';
  element.width = 640;
  element.height = 360;
  element.maxMarks = 500;
  element.selectionEnabled = true;
  return element;
}

const histogramSpec = catalogVisualizationSpecs.histogram as Extract<VisualizationSpec, { view: 'histogram' }>;
const histogramContext: VisualizationBindingContext = {
  ...catalogVisualizationContext,
  histograms: [{ result: catalogRef, bins: histogramSpec.bins }],
};

export const visualizationExamples: readonly CatalogExampleDefinition[] = [
  mount('trend', (root) =>
    configure(
      createCatalogElement<VarendoTrendElement>('varendo-trend', root, VarendoTrendElement),
      catalogVisualizationSpecs.trend,
      catalogVisualizationContext,
    ),
  ),
  mount('bar', (root) =>
    configure(
      createCatalogElement<VarendoBarElement>('varendo-bar', root, VarendoBarElement),
      catalogVisualizationSpecs.bar,
      catalogVisualizationContext,
    ),
  ),
  mount('area', (root) =>
    configure(
      createCatalogElement<VarendoAreaElement>('varendo-area', root, VarendoAreaElement),
      catalogVisualizationSpecs.area,
      catalogVisualizationContext,
    ),
  ),
  mount('scatter', (root) =>
    configure(
      createCatalogElement<VarendoScatterElement>('varendo-scatter', root, VarendoScatterElement),
      catalogVisualizationSpecs.scatter,
      catalogVisualizationContext,
    ),
  ),
  mount('histogram', (root) =>
    configure(
      createCatalogElement<VarendoHistogramElement>('varendo-histogram', root, VarendoHistogramElement),
      histogramSpec,
      histogramContext,
    ),
  ),
  mount('heatmap', (root) =>
    configure(
      createCatalogElement<VarendoHeatmapElement>('varendo-heatmap', root, VarendoHeatmapElement),
      catalogVisualizationSpecs.heatmap,
      catalogVisualizationContext,
    ),
  ),
  mount('matrix', (root) =>
    configure(
      createCatalogElement<VarendoMatrixElement>('varendo-matrix', root, VarendoMatrixElement),
      catalogTemporalSpecs.matrix,
      catalogVisualizationContext,
    ),
  ),
  mount('timeline', (root) =>
    configure(
      createCatalogElement<VarendoTimelineElement>('varendo-timeline', root, VarendoTimelineElement),
      catalogTemporalSpecs.timeline,
      catalogVisualizationContext,
    ),
  ),
  mount('calendar-grid', (root) =>
    configure(
      createCatalogElement<VarendoCalendarGridElement>('varendo-calendar-grid', root, VarendoCalendarGridElement),
      catalogTemporalSpecs['calendar-grid'],
      catalogVisualizationContext,
    ),
  ),
  mount('tree', (root) =>
    configure(
      createCatalogElement<VarendoTreeElement>('varendo-tree', root, VarendoTreeElement),
      hierarchySpec,
      hierarchyContext,
      [hierarchyDataset],
    ),
  ),
  mount('treemap', (root) =>
    configure(
      createCatalogElement<VarendoTreemapElement>('varendo-treemap', root, VarendoTreemapElement),
      treemapSpec,
      hierarchyContext,
      [hierarchyDataset],
    ),
  ),
  mount('relationship', (root) =>
    configure(
      createCatalogElement<VarendoRelationshipElement>('varendo-relationship', root, VarendoRelationshipElement),
      relationshipSpec,
      relationshipContext,
      [relationshipDataset],
    ),
  ),
];
