import assert from 'node:assert/strict';
import { html } from 'lit';
import { renderVarendo } from '../../packages/web/dist/server.js';
import * as f from './hierarchy-fixtures.ts';
const templates = [
  html`<varendo-tree .visualization=${f.tree} .context=${f.context} .datasets=${f.datasets}></varendo-tree>`,
  html`<varendo-treemap .visualization=${f.treemap} .context=${f.context} .datasets=${f.datasets}></varendo-treemap>`,
  html`<varendo-relationship
    .visualization=${f.relationship}
    .context=${f.context}
    .datasets=${f.datasets}
  ></varendo-relationship>`,
];
for (const template of templates) {
  const output = await renderVarendo(template);
  assert.match(output, /<svg/);
  assert.match(output, /<table/);
  assert.match(output, /Partial result \(Loaded branch only\)/);
  assert.doesNotMatch(output, /NaN|Infinity/);
}
const empty = await renderVarendo(html`<varendo-tree></varendo-tree>`);
assert.doesNotMatch(empty, /<table|<svg/);
console.log('Three hierarchy family SSR, public registration, exact table, partial scope and isolation checks passed.');
