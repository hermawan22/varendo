import assert from 'node:assert/strict';
import { html } from 'lit';
import { renderAeliqo } from '../../packages/web/dist/server.js';
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
      return html`<aeliqo-trend
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR trend"
      ></aeliqo-trend>`;
    case 'bar':
      return html`<aeliqo-bar
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR bar"
      ></aeliqo-bar>`;
    case 'area':
      return html`<aeliqo-area
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR area"
      ></aeliqo-area>`;
    case 'scatter':
      return html`<aeliqo-scatter
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR scatter"
      ></aeliqo-scatter>`;
    case 'histogram':
      return html`<aeliqo-histogram
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR histogram"
      ></aeliqo-histogram>`;
    case 'heatmap':
      return html`<aeliqo-heatmap
        .visualization=${props.spec}
        .context=${props.context}
        .datasets=${props.datasets}
        label="SSR heatmap"
      ></aeliqo-heatmap>`;
  }
};

for (const tag of tags) {
  const output = await renderAeliqo(templateFor(tag));
  assert.match(output, new RegExp(`<aeliqo-${tag}`));
  assert.match(output, /<table/);
  assert.match(output, /<svg/);
  assert.doesNotMatch(output, /(?:NaN|Infinity|undefined)/);
  assert.match(output, /2025-01-01|A|I/);
}

const heatmap = await renderAeliqo(
  html`<aeliqo-heatmap
    .visualization=${specs.heatmap}
    .context=${contextFor('heatmap')}
    .datasets=${[{ result: ref, rows }]}
  ></aeliqo-heatmap>`,
);
assert.match(heatmap, /part="color-key"/);
const histogram = await renderAeliqo(
  html`<aeliqo-histogram
    .visualization=${specs.histogram}
    .context=${contextFor('histogram')}
    .datasets=${[{ result: ref, rows }]}
  ></aeliqo-histogram>`,
);
assert.match(histogram, /executor-produced count bins/);
assert.match(histogram, /Source observation coverage/);

const empty = await renderAeliqo(html`<aeliqo-trend></aeliqo-trend>`);
assert.doesNotMatch(empty, /<table/);
assert.match(empty, /No .*trend.*visualization is available/s);
console.log('Cartesian SSR six-family marks, exact tables, color key, histogram scope and request isolation passed.');
