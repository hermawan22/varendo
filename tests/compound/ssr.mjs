import assert from 'node:assert/strict';
import { html } from 'lit';
import { renderVarendo } from '../../packages/web/dist/server.js';
import { defineCompoundElements } from '../../packages/web/dist/compound/index.js';

defineCompoundElements();
const ref = { id: 'compound-ssr', revision: '1', outputId: 'rows', queryDigest: 'query', scopeDigest: 'scope' };
const rows = [{ id: 'a', name: 'Ada', amount: { decimal: '9007199254740993.001' } }];
const columns = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount' },
];
const scope = { loaded: 1, filteredTotal: 1, kind: 'filtered', label: 'Authorized snapshot' };

const output = await renderVarendo(html`
  <varendo-explorer
    .fields=${[{ id: 'name', label: 'Name', type: 'text' }]}
    .rows=${rows}
    .columns=${columns}
    .identity=${['id']}
    entity="person"
    .result=${ref}
    .scope=${scope}
    .detailRecord=${rows[0]}
    .detailFields=${columns}
  ></varendo-explorer>
  <varendo-breakdown
    .groups=${[{ key: 'north', label: 'North', value: { decimal: '0.25' }, displayValue: '25%' }]}
    .result=${ref}
  ></varendo-breakdown>
  <varendo-form-flow
    .steps=${[
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
    ]}
    active-step="one"
    ><p slot="step-one">Draft</p></varendo-form-flow
  >
`);

assert.match(output, /<varendo-explorer[\s>]/);
assert.match(output, /<varendo-breakdown[\s>]/);
assert.match(output, /<varendo-form-flow[\s>]/);
assert.match(output, /shadowrootmode="open"/);
assert.match(output, /9007199254740993\.001/);
assert.match(output, /25%/);
assert.match(output, /Draft/);
console.log('Compound SSR emits registered shadow roots, exact host values and deterministic slotted flow content.');
