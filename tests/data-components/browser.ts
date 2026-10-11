import { AeliqoCardCollectionElement } from '../../packages/web/src/data/card-collection.js';
import { AeliqoDeltaElement } from '../../packages/web/src/data/delta.js';
import { AeliqoDetailElement } from '../../packages/web/src/data/detail.js';
import { AeliqoFilterBuilderElement } from '../../packages/web/src/data/filter-builder.js';
import { AeliqoKeyValueElement } from '../../packages/web/src/data/key-value.js';
import { AeliqoMetricElement } from '../../packages/web/src/data/metric.js';
import { AeliqoRecordListElement } from '../../packages/web/src/data/record-list.js';
import { AeliqoSelectionSummaryElement } from '../../packages/web/src/data/selection-summary.js';
import { AeliqoTableElement } from '../../packages/web/src/elements/aeliqo-table.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['aeliqo-metric', AeliqoMetricElement],
  ['aeliqo-delta', AeliqoDeltaElement],
  ['aeliqo-key-value', AeliqoKeyValueElement],
  ['aeliqo-detail', AeliqoDetailElement],
  ['aeliqo-record-list', AeliqoRecordListElement],
  ['aeliqo-card-collection', AeliqoCardCollectionElement],
  ['aeliqo-table', AeliqoTableElement],
  ['aeliqo-filter-builder', AeliqoFilterBuilderElement],
  ['aeliqo-selection-summary', AeliqoSelectionSummaryElement],
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

const table = document.createElement('aeliqo-table') as AeliqoTableElement;
table.id = 'table';
table.caption = 'People';
table.columns = columns;
table.rows = rows;
table.identity = ['id'];
table.selection = 'multiple';
table.totalRows = 100;
table.scope = { loaded: 2, filteredTotal: 100, kind: 'filtered' };
fixture.append(table);
const grid = document.createElement('aeliqo-table') as AeliqoTableElement;
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
const filter = document.createElement('aeliqo-filter-builder') as AeliqoFilterBuilderElement;
filter.id = 'filter';
filter.fields = [{ id: 'name', label: 'Name', type: 'text' }];
fixture.append(filter);
const cards = document.createElement('aeliqo-card-collection') as AeliqoCardCollectionElement;
cards.id = 'cards';
cards.columns = columns;
cards.rows = rows;
cards.identity = ['id'];
cards.hasMore = true;
fixture.append(cards);
const metric = document.createElement('aeliqo-metric') as AeliqoMetricElement;
metric.id = 'metric';
metric.label = 'Revenue';
metric.value = { decimal: '100000000000000000.01' };
metric.unit = 'USD';
metric.scope = { label: 'Current month' };
fixture.append(metric);
const delta = document.createElement('aeliqo-delta') as AeliqoDeltaElement;
delta.id = 'delta';
delta.current = 0.62;
delta.baseline = 0.5;
delta.mode = 'percentage-point';
fixture.append(delta);
const keyValue = document.createElement('aeliqo-key-value') as AeliqoKeyValueElement;
keyValue.id = 'key-value';
keyValue.items = [{ key: 'owner', label: 'Owner', value: 'Ada' }];
fixture.append(keyValue);
const detail = document.createElement('aeliqo-detail') as AeliqoDetailElement;
detail.id = 'detail';
detail.fields = columns;
detail.identity = ['id'];
detail.record = rows[0];
fixture.append(detail);
const list = document.createElement('aeliqo-record-list') as AeliqoRecordListElement;
list.id = 'list';
list.columns = columns;
list.rows = rows;
list.identity = ['id'];
list.selection = 'single';
fixture.append(list);
const summary = document.createElement('aeliqo-selection-summary') as AeliqoSelectionSummaryElement;
summary.id = 'summary';
summary.entity = 'person';
summary.selectedKeys = ['string:1:a'];
fixture.append(summary);

const events: { readonly type: string; readonly detail: unknown }[] = [];
fixture.addEventListener('aeliqo-record-list-selection', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('aeliqo-table-selection', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('aeliqo-table-window', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('aeliqo-filter-change', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
fixture.addEventListener('aeliqo-data-load-more', (event) =>
  events.push({ type: event.type, detail: (event as CustomEvent).detail }),
);
(window as unknown as { dataFixture: { events: typeof events } }).dataFixture = { events };
