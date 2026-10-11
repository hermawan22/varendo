import {
  AeliqoCardCollectionElement,
  AeliqoDeltaElement,
  AeliqoDetailElement,
  AeliqoFilterBuilderElement,
  AeliqoKeyValueElement,
  AeliqoMetricElement,
  AeliqoRecordListElement,
  AeliqoSelectionSummaryElement,
  AeliqoTableElement,
  type AeliqoKeyValueItem,
  type AeliqoTableColumn,
  type AeliqoTableRow,
} from '@varendo/web/data';
import {
  catalogColumns,
  catalogFields,
  catalogRef,
  catalogRows,
  catalogScope,
  cleanupCatalogRoot,
  createCatalogElement,
  createCatalogRoot,
} from './fixture.js';
import { catalogMountSource, catalogSource } from './source.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';

const sourceImports = `import {
  AeliqoCardCollectionElement,
  AeliqoDeltaElement,
  AeliqoDetailElement,
  AeliqoFilterBuilderElement,
  AeliqoKeyValueElement,
  AeliqoMetricElement,
  AeliqoRecordListElement,
  AeliqoSelectionSummaryElement,
  AeliqoTableElement,
  type AeliqoKeyValueItem,
  type AeliqoTableColumn,
  type AeliqoTableRow,
  } from "@varendo/web/data";`;
const sourceTypeImports = `import type {ResultRef,
  Scalar,
} from "@varendo/core";
import type {AeliqoDataColumn, AeliqoDataScope, AeliqoFieldOption} from "@varendo/web/data";`;

const sourceSetup = `${sourceTypeImports}

const catalogRef: ResultRef = {
  id: "aeliqo-catalog-example",
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
const catalogColumns: readonly AeliqoDataColumn[] = [
  {key: "id", label: "ID", type: "text", sortable: true},
  {key: "name", label: "Name", type: "text", sortable: true},
  {key: "team", label: "Team", type: "text"},
  {key: "date", label: "Date", type: "date", sortable: true},
  {key: "amount", label: "Amount", type: "integer", align: "end"},
];
const catalogFields: readonly AeliqoFieldOption[] = [
  {id: "name", label: "Name", type: "text"},
  {id: "team", label: "Team", type: "text"},
  {id: "amount", label: "Amount", type: "integer"},
];
const catalogScope: AeliqoDataScope = {
  loaded: catalogRows.length,
  filteredTotal: catalogRows.length,
  populationDigest: catalogRef.scopeDigest,
  kind: "filtered",
  label: "Authorized people",
};
const tableColumns: readonly AeliqoTableColumn[] = catalogColumns.map(({key, label, sortable, align}) => ({key, label, ...(sortable === undefined ? {} : {sortable}), ...(align === undefined ? {} : {align})}));
const tableRows: readonly AeliqoTableRow[] = catalogRows.map((row) => ({id: row.id ?? null, name: row.name ?? null, team: row.team ?? null, date: row.date ?? null, amount: row.amount ?? null}));
const personKeys = ["string:3:ada", "string:5:grace"] as const;`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  metric: {
    fixture: 'One exact count metric scoped to the authorized people result.',
    props: ['label', 'value', 'displayValue', 'unit', 'description', 'scope', 'status', 'format', 'locale'],
    propsNotes:
      'Value and displayValue are host supplied; the component formats and labels without computing a metric.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error'],
    keyboard: ['Not focusable unless a numeric value exposes review focus'],
    events: ['None; read-only presentation'],
    expectedOutcome: 'The exact value and scope are displayed without silently expanding or recalculating the result.',
  },
  delta: {
    fixture: 'One percentage-point comparison between two host-supplied exact values.',
    props: ['label', 'current', 'baseline', 'mode', 'compatible', 'unit', 'scope', 'status'],
    propsNotes:
      'The host supplies compatible values and declares comparison mode; the component does not infer compatibility.',
    states: ['ready', 'partial', 'stale', 'empty', 'error'],
    keyboard: ['Not focusable by default'],
    events: ['None; read-only presentation'],
    expectedOutcome: 'The comparison is labelled as percentage-point change and unavailable inputs remain explicit.',
  },
  'key-value': {
    fixture: 'Two ordered facts showing owner and current authorized scope.',
    props: ['items', 'scope', 'status', 'message'],
    propsNotes:
      'Each item carries a stable key, label, and host-supplied value or display value; links require approved hrefs.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error'],
    keyboard: ['Tab reaches approved item links'],
    events: ['None; links use native navigation'],
    expectedOutcome: 'Facts use definition-list semantics and preserve missing/status meaning.',
  },
  detail: {
    fixture: 'One selected Ada record with explicit identity and declared fields.',
    props: ['record', 'fields', 'identity', 'entity', 'title', 'missingLabel', 'scope', 'status'],
    propsNotes: 'Identity and fields are host supplied; missing values remain visible rather than being omitted.',
    states: ['ready', 'empty', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Focus follows any child links'],
    events: ['None; read-only presentation'],
    expectedOutcome: 'The selected identity, fields, scope, and missing values are shown honestly.',
  },
  'record-list': {
    fixture: 'Three people rendered as a single-select identity list.',
    props: ['rows', 'columns', 'identity', 'entity', 'selection', 'selectedKeys', 'result', 'scope', 'status'],
    propsNotes:
      'selectedKeys is controlled by the host and keys derive from declared identity fields, never visible row indexes.',
    states: ['ready', 'empty', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Enter', 'Space', 'Arrow keys where list navigation applies'],
    events: ['aeliqo-record-list-selection'],
    expectedOutcome: 'Rows remain in the supplied scope and selection requests carry stable identities and lineage.',
  },
  'card-collection': {
    fixture: 'Three people in responsive cards with multi-select and an available load-more boundary.',
    props: [
      'rows',
      'columns',
      'identity',
      'entity',
      'headingKey',
      'selection',
      'selectedKeys',
      'result',
      'scope',
      'hasMore',
      'loadingMore',
      'status',
    ],
    propsNotes: 'The host controls selectedKeys, hasMore, and loadingMore; the component never fetches the next page.',
    states: ['ready', 'empty', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-card-selection', 'aeliqo-data-load-more'],
    expectedOutcome: 'Cards adapt to available width and emit only identity selection or bounded load-more requests.',
  },
  table: {
    fixture: 'A captioned people table with identity selection, sortable columns, and a bounded page.',
    props: [
      'columns',
      'rows',
      'caption',
      'identity',
      'selection',
      'selectedKeys',
      'result',
      'page',
      'pageSize',
      'totalRows',
      'scope',
      'status',
    ],
    propsNotes:
      'Table remains native by default; mode and virtualization are explicit host choices with stable row identity.',
    states: ['ready', 'empty', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Enter', 'Space', 'Arrow keys in grid mode'],
    events: ['aeliqo-table-selection', 'aeliqo-table-sort', 'aeliqo-table-page', 'aeliqo-table-window'],
    expectedOutcome:
      'The table preserves caption, scope, sort/page requests, and selection identity without losing keyboard access.',
  },
  'filter-builder': {
    fixture: 'One unapplied team equals Research clause against authorized people fields.',
    props: [
      'fields',
      'predicate',
      'inherited',
      'entity',
      'scopeLabel',
      'applyLabel',
      'autoApply',
      'clauses',
      'logical',
      'status',
    ],
    propsNotes:
      'Draft clauses are local until Apply; autoApply remains an explicit host choice and does not run a query itself.',
    states: ['ready', 'invalid', 'pending', 'error'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'Escape', 'IME composition'],
    events: ['aeliqo-filter-change'],
    expectedOutcome: 'The builder validates a typed predicate and emits it only after an explicit apply request.',
  },
  'selection-summary': {
    fixture: 'Two selected people with a visible clear-selection action.',
    props: ['selectedKeys', 'selectionScope', 'entity', 'result', 'scope', 'label', 'clearable', 'status'],
    propsNotes:
      'Selection keys or predicate scope stay explicit; clear is a host request and does not mutate data by itself.',
    states: ['ready', 'loading', 'partial', 'stale', 'error'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-selection-clear'],
    expectedOutcome: 'The count and active scope are announced and clearing emits a typed request.',
  },
};

const tableColumns: readonly AeliqoTableColumn[] = catalogColumns.map(({ key, label, sortable, align }) => ({
  key,
  label,
  ...(sortable === undefined ? {} : { sortable }),
  ...(align === undefined ? {} : { align }),
}));
const tableRows: readonly AeliqoTableRow[] = catalogRows.map((row) => ({
  id: row.id ?? null,
  name: row.name ?? null,
  team: row.team ?? null,
  date: row.date ?? null,
  amount: row.amount ?? null,
}));

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'data',
    description: 'A scoped data primitive that preserves identity, precision, and honest loading or partial states.',
    fixture:
      'A bounded authorized Result projection with stable identities, scope disclosure, and exact displayed values.',
    props: ['rows or value', 'identity', 'scope', 'status', 'result'],
    propsNotes: 'Rows and values are supplied by the host; the component does not fetch, infer, or expand scope.',
    states: ['ready', 'loading', 'empty', 'partial', 'stale', 'error'],
    keyboard: [
      'Tab',
      'Arrow keys in interactive grids',
      'Enter or Space for selection',
      'focus follows stable identity',
    ],
    events: ['aeliqo-data-selection', 'aeliqo-filter-change', 'aeliqo-data-load-more', 'aeliqo-table-sort'],
    expectedOutcome:
      'The view renders only the supplied authorized scope and labels any incomplete or unavailable data explicitly.',
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

const personKeys = ['string:3:ada', 'string:5:grace'] as const;

export const dataExamples: readonly CatalogExampleDefinition[] = [
  mount('metric', (root) => {
    const element = createCatalogElement<AeliqoMetricElement>('aeliqo-metric', root, AeliqoMetricElement);
    element.label = 'Authorized people';
    element.value = catalogRows.length;
    element.unit = 'records';
    element.scope = catalogScope;
    element.description = 'Current filtered result';
  }),
  mount('delta', (root) => {
    const element = createCatalogElement<AeliqoDeltaElement>('aeliqo-delta', root, AeliqoDeltaElement);
    element.label = 'Change from last week';
    element.current = 0.62;
    element.baseline = 0.5;
    element.mode = 'percentage-point';
    element.unit = '%';
    element.scope = catalogScope;
  }),
  mount('key-value', (root) => {
    const element = createCatalogElement<AeliqoKeyValueElement>('aeliqo-key-value', root, AeliqoKeyValueElement);
    const items: readonly AeliqoKeyValueItem[] = [
      { key: 'owner', label: 'Owner', value: 'Ada Lovelace' },
      { key: 'scope', label: 'Scope', value: 'Authorized people', description: 'Current report scope' },
    ];
    element.items = items;
    element.scope = catalogScope;
  }),
  mount('detail', (root) => {
    const element = createCatalogElement<AeliqoDetailElement>('aeliqo-detail', root, AeliqoDetailElement);
    element.title = 'Person detail';
    element.record = catalogRows[0];
    element.fields = catalogColumns;
    element.identity = ['id'];
    element.entity = 'person';
    element.scope = catalogScope;
  }),
  mount('record-list', (root) => {
    const element = createCatalogElement<AeliqoRecordListElement>('aeliqo-record-list', root, AeliqoRecordListElement);
    element.title = 'People';
    element.rows = catalogRows;
    element.columns = catalogColumns;
    element.identity = ['id'];
    element.entity = 'person';
    element.selection = 'single';
    element.selectedKeys = [personKeys[0]];
    element.result = catalogRef;
    element.scope = catalogScope;
  }),
  mount('card-collection', (root) => {
    const element = createCatalogElement<AeliqoCardCollectionElement>(
      'aeliqo-card-collection',
      root,
      AeliqoCardCollectionElement,
    );
    element.title = 'People cards';
    element.rows = catalogRows;
    element.columns = catalogColumns;
    element.identity = ['id'];
    element.entity = 'person';
    element.headingKey = 'name';
    element.selection = 'multiple';
    element.hasMore = true;
    element.loadingMore = false;
    element.scope = catalogScope;
  }),
  mount('table', (root) => {
    const element = createCatalogElement<AeliqoTableElement>('aeliqo-table', root, AeliqoTableElement);
    element.caption = 'People';
    element.columns = tableColumns;
    element.rows = tableRows;
    element.identity = ['id'];
    element.entity = 'person';
    element.selection = 'multiple';
    element.selectedKeys = [personKeys[0]];
    element.result = catalogRef;
    element.page = 1;
    element.pageSize = 10;
    element.totalRows = catalogRows.length;
    element.scope = catalogScope;
  }),
  mount('filter-builder', (root) => {
    const element = createCatalogElement<AeliqoFilterBuilderElement>(
      'aeliqo-filter-builder',
      root,
      AeliqoFilterBuilderElement,
    );
    element.fields = catalogFields;
    element.entity = 'person';
    element.scopeLabel = 'Authorized people';
    element.autoApply = false;
    element.clauses = [{ field: 'team', operator: 'eq', value: 'Research' }];
    element.logical = 'and';
  }),
  mount('selection-summary', (root) => {
    const element = createCatalogElement<AeliqoSelectionSummaryElement>(
      'aeliqo-selection-summary',
      root,
      AeliqoSelectionSummaryElement,
    );
    element.label = 'People selected';
    element.entity = 'person';
    element.selectedKeys = [personKeys[0], personKeys[1]];
    element.result = catalogRef;
    element.scope = catalogScope;
    element.clearable = true;
  }),
];
