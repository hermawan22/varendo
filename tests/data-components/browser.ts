import { VarendoCardCollectionElement } from '../../packages/web/src/data/card-collection.js';
import { VarendoDeltaElement } from '../../packages/web/src/data/delta.js';
import { VarendoDetailElement } from '../../packages/web/src/data/detail.js';
import { VarendoFilterBuilderElement } from '../../packages/web/src/data/filter-builder.js';
import { VarendoKeyValueElement } from '../../packages/web/src/data/key-value.js';
import { VarendoMetricElement } from '../../packages/web/src/data/metric.js';
import { VarendoRecordListElement } from '../../packages/web/src/data/record-list.js';
import { VarendoSelectionSummaryElement } from '../../packages/web/src/data/selection-summary.js';
import { VarendoTableElement } from '../../packages/web/src/elements/varendo-table.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['varendo-metric', VarendoMetricElement],
  ['varendo-delta', VarendoDeltaElement],
  ['varendo-key-value', VarendoKeyValueElement],
  ['varendo-detail', VarendoDetailElement],
  ['varendo-record-list', VarendoRecordListElement],
  ['varendo-card-collection', VarendoCardCollectionElement],
  ['varendo-table', VarendoTableElement],
  ['varendo-filter-builder', VarendoFilterBuilderElement],
  ['varendo-selection-summary', VarendoSelectionSummaryElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const rows = [
  { id: 'a', name: 'Ada', amount: { decimal: '100000000000000000.01' } },
  { id: 'b', name: 'Lin', amount: { decimal: '2.50' } },
] as const;
const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount' },
] as const;
const fixture = document.querySelector<HTMLElement>('#fixture')!;

const table = document.createElement('varendo-table') as VarendoTableElement;
table.id = 'table';
table.caption = 'People';
table.columns = columns;
table.rows = rows;
table.identity = ['id'];
table.selection = 'multiple';
table.totalRows = 100;
table.scope = { loaded: 2, filteredTotal: 100, kind: 'filtered' };
fixture.append(table);
const grid = document.createElement('varendo-table') as VarendoTableElement;
grid.id = 'grid';
grid.mode = 'grid';
grid.columns = columns;
grid.rows = rows;
grid.identity = ['id'];
grid.virtualized = true;
grid.virtualStart = 0;
grid.virtualCount = 1;
grid.overscan = 0;
grid.totalRows = 100;
grid.scope = { loaded: 2, filteredTotal: 100, kind: 'filtered' };
fixture.append(grid);
const filter = document.createElement('varendo-filter-builder') as VarendoFilterBuilderElement;
filter.id = 'filter';
filter.fields = [{ id: 'name', label: 'Name', type: 'text' }];
fixture.append(filter);
const cards = document.createElement('varendo-card-collection') as VarendoCardCollectionElement;
cards.id = 'cards';
cards.columns = columns;
cards.rows = rows;
cards.identity = ['id'];
cards.hasMore = true;
fixture.append(cards);
const metric = document.createElement('varendo-metric') as VarendoMetricElement;
metric.id = 'metric';
metric.label = 'Revenue';
metric.value = { decimal: '100000000000000000.01' };
metric.unit = 'USD';
metric.scope = { label: 'Current month' };
fixture.append(metric);
const delta = document.createElement('varendo-delta') as VarendoDeltaElement;
delta.id = 'delta';
delta.current = 0.62;
delta.baseline = 0.5;
delta.mode = 'percentage-point';
fixture.append(delta);
const keyValue = document.createElement('varendo-key-value') as VarendoKeyValueElement;
keyValue.id = 'key-value';
keyValue.items = [{ key: 'owner', label: 'Owner', value: 'Ada' }];
fixture.append(keyValue);
const detail = document.createElement('varendo-detail') as VarendoDetailElement;
detail.id = 'detail';
detail.fields = columns;
detail.identity = ['id'];
detail.record = rows[0];
fixture.append(detail);
const list = document.createElement('varendo-record-list') as VarendoRecordListElement;
list.id = 'list';
list.columns = columns;
list.rows = rows;
list.identity = ['id'];
list.selection = 'single';
fixture.append(list);
const summary = document.createElement('varendo-selection-summary') as VarendoSelectionSummaryElement;
summary.id = 'summary';
summary.entity = 'person';
summary.selectedKeys = ['string:1:a'];
fixture.append(summary);

const events: { readonly type: string; readonly detail: unknown }[] = [];
fixture.addEventListener('varendo-record-list-selection', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('varendo-table-selection', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('varendo-table-window', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('varendo-filter-change', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('varendo-data-load-more', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
(window as unknown as { dataFixture: { events: typeof events } }).dataFixture = { events };
