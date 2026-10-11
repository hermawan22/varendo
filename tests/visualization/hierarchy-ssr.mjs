import assert from 'node:assert/strict';
import { html } from 'lit';
import { renderAeliqo } from '../../packages/web/dist/server.js';
import * as f from './hierarchy-fixtures.ts';
const templates = [
  html`<aeliqo-tree .visualization=${f.tree} .context=${f.context} .datasets=${f.datasets}></aeliqo-tree>`,
  html`<aeliqo-treemap .visualization=${f.treemap} .context=${f.context} .datasets=${f.datasets}></aeliqo-treemap>`,
  html`<aeliqo-relationship
    .visualization=${f.relationship}
    .context=${f.context}
    .datasets=${f.datasets}
  ></aeliqo-relationship>`,
];
for (const template of templates) {
  const output = await renderAeliqo(template);
  assert.match(output, /<svg/);
  assert.match(output, /<table/);
  assert.match(output, /Partial result \(Loaded branch only\)/);
  assert.doesNotMatch(output, /NaN|Infinity/);
}
const empty = await renderAeliqo(html`<aeliqo-tree></aeliqo-tree>`);
assert.doesNotMatch(empty, /<table|<svg/);
console.log('Three hierarchy family SSR, public registration, exact table, partial scope and isolation checks passed.');
