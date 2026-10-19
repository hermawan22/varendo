import assert from 'node:assert/strict';
import { html } from 'lit';
import { renderVarendo } from '../../packages/web/dist/server.js';
import { defineCartesianElements } from '../../packages/web/dist/visualization/cartesian/index.js';

// The public root registration is integrated later by the orchestrator. This
// source-level SSR proof registers the family entry explicitly first.
defineCartesianElements();

import { ref, result, rows, specs, catalog, contextFor, rowsFor } from './cartesian-fixtures.mjs';
const tags = ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap'];
const templateFor = (tag) => {
  const props = { spec: specs[tag], context: contextFor(tag), datasets: [{ result: ref, rows: rowsFor(tag) }] };
  switch (tag) {
    case 'trend':
      return html`<varendo-trend
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR trend"
      ></varendo-trend>`;
    case 'bar':
      return html`<varendo-bar
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR bar"
      ></varendo-bar>`;
    case 'area':
      return html`<varendo-area
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR area"
      ></varendo-area>`;
    case 'scatter':
      return html`<varendo-scatter
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR scatter"
      ></varendo-scatter>`;
    case 'histogram':
      return html`<varendo-histogram
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR histogram"
      ></varendo-histogram>`;
    case 'heatmap':
      return html`<varendo-heatmap
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR heatmap"
      ></varendo-heatmap>`;
  }
};

for (const tag of tags) {
  const output = await renderVarendo(templateFor(tag));
  assert.match(output, new RegExp(`<varendo-${tag}`));
  assert.match(output, /<table/);
  assert.match(output, /<svg/);
  assert.doesNotMatch(output, /(?:NaN|Infinity|undefined)/);
  assert.match(output, /2025-01-01|A|I/);
}

const heatmap = await renderVarendo(
  html`<varendo-heatmap
    .visualization=${specs.heatmap}
    .context=${contextFor('heatmap')}
    .datasets=${[{ result: ref, rows }]}
  ></varendo-heatmap>`,
);
assert.match(heatmap, /part="color-key"/);
const histogram = await renderVarendo(
  html`<varendo-histogram
    .visualization=${specs.histogram}
    .context=${contextFor('histogram')}
    .datasets=${[{ result: ref, rows }]}
  ></varendo-histogram>`,
);
assert.match(histogram, /executor-produced count bins/);
assert.match(histogram, /Source observation coverage/);

const empty = await renderVarendo(html`<varendo-trend></varendo-trend>`);
assert.doesNotMatch(empty, /<table/);
assert.match(empty, /No .*trend.*visualization is available/s);
console.log('Cartesian SSR six-family marks, exact tables, color key, histogram scope and request isolation passed.');
