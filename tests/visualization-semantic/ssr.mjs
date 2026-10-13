import assert from 'node:assert/strict';
import { html } from 'lit';
import { validatePresentationPlan } from '../../packages/core/dist/presentation/index.js';
import { createVarendoPresentationRegistry } from '../../packages/web/dist/region/registry.js';
import { renderVarendo } from '../../packages/web/dist/server.js';
import { regionResults, visualizationContext, visualizationPlan, visualizationRegistryOptions } from './fixtures.mjs';

const registry = createVarendoPresentationRegistry(visualizationRegistryOptions());
assert.equal(registry.ok, true, registry.ok ? '' : JSON.stringify(registry.diagnostics));
if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
const checked = validatePresentationPlan(visualizationPlan(), visualizationContext(), registry.value);
assert.equal(checked.ok, true, checked.ok ? '' : JSON.stringify(checked.diagnostics));
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
assert.equal(checked.value.nodes.length, 13);

const output = await renderVarendo(
  html`<varendo-region .presentation=${checked.value} .results=${regionResults()}></varendo-region>`,
);
for (const view of [
  'trend',
  'bar',
  'area',
  'scatter',
  'histogram',
  'heatmap',
  'matrix',
  'timeline',
  'calendar-grid',
  'tree',
  'treemap',
  'relationship',
]) {
  assert.match(output, new RegExp(`<varendo-${view}(?:\\s|>)`), `${view} must be rendered through the semantic region`);
}
assert.match(output, /<varendo-region/);
assert.match(output, /<table/);
assert.match(output, /shadowroot="open"/);
console.log('Semantic visualization region SSR: canonical core plan validated and all twelve views rendered.');
