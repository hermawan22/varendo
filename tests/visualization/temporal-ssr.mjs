import assert from 'node:assert/strict';
import { renderAeliqo } from '../../packages/web/dist/server.js';
import { html } from 'lit';
const ref = { id: 'r', revision: '1', outputId: 'out', queryDigest: 'q', scopeDigest: 's' };
const result = {
  version: '1',
  ref,
  taskId: 't',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    {
      id: 'date',
      label: 'Date',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory' } },
      role: 'attribute',
    },
    { id: 'amount', label: 'Amount', type: { value: 'decimal', nullable: false }, role: 'measure' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 1, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Bounded supplied rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot unknown' },
  evidence: { kind: 'computed', queryDigest: 'q', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const context = { results: [result] };
const datasets = [
  { result: ref, rows: [{ id: 'a', date: '2026-09-08', amount: { decimal: '9007199254740993.001' } }] },
];
const matrix = { version: '1', view: 'matrix', result: ref, columns: ['id', 'amount'] };
const timeline = { version: '1', view: 'timeline', result: ref, start: 'date' };
const calendar = { version: '1', view: 'calendar-grid', result: ref, date: 'date' };
const output = await renderAeliqo(
  html`<aeliqo-matrix .visualization=${matrix} .context=${context} .datasets=${datasets}></aeliqo-matrix
    ><aeliqo-timeline .visualization=${timeline} .context=${context} .datasets=${datasets}></aeliqo-timeline
    ><aeliqo-calendar-grid
      .visualization=${calendar}
      .context=${context}
      .datasets=${datasets}
    ></aeliqo-calendar-grid>`,
);
assert.equal((output.match(/9007199254740993.001/g) || []).length, 3);
assert(output.includes('<line'));
assert(output.includes('2026-09-08'));
assert(output.includes('Coverage unknown (Bounded supplied rows)'));
const fresh = await renderAeliqo(
  html`<aeliqo-matrix></aeliqo-matrix><aeliqo-timeline></aeliqo-timeline><aeliqo-calendar-grid></aeliqo-calendar-grid>`,
);
assert(!fresh.includes('9007199254740993.001'));
assert(!fresh.includes('<table'));
console.log('Public registration SSR: Matrix, Timeline, CalendarGrid exact rows and request isolation passed.');
