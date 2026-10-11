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
    { id: 'x', label: 'X', type: { value: 'float', nullable: false }, role: 'measure' },
    { id: 'y', label: 'Y', type: { value: 'decimal', nullable: false }, role: 'measure' },
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
const unit = {
  kind: 'unit',
  mark: 'point',
  result: ref,
  encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
  missing: 'gap',
};
const output = await renderAeliqo(
  html`<aeliqo-plot
    .unit=${unit}
    .result=${result}
    .rows=${[{ id: 'a', x: 1, y: { decimal: '9007199254740993.001' } }]}
  ></aeliqo-plot>`,
);
assert(output.includes('9007199254740993.001'));
assert(output.includes('<circle'));
assert(output.includes('Coverage unknown (Bounded supplied rows)'));
const next = await renderAeliqo(html`<aeliqo-plot></aeliqo-plot>`);
assert(next.includes('No result is available'));
assert(!next.includes('9007199254740993.001'));
console.log('Plot SSR exact values, SVG marks and request isolation passed.');
const composition = await renderAeliqo(
  html`<aeliqo-plot
    .spec=${{ version: '1', root: { kind: 'facet', field: 'id', scales: 'shared-compatible', child: { kind: 'layer', scales: 'shared-compatible', children: [unit, unit] } } }}
    .results=${[result]}
    .datasets=${[{ result: ref, rows: [{ id: 'a', x: 1, y: { decimal: '9007199254740993.001' } }] }]}
  ></aeliqo-plot>`,
);
assert(composition.includes('part="facet"'));
assert(composition.includes('part="layer"'));
assert.equal((composition.match(/<circle/g) || []).length, 2);
assert.equal((composition.match(/<table>/g) || []).length, 2);
assert(composition.includes('9007199254740993.001'));
console.log('Plot composition SSR facets, layered marks and exact data passed.');
