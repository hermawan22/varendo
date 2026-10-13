import assert from 'node:assert/strict';
import { createVarendoPresentationRegistry } from '@varendo/web/region';

const ref = {
  id: 'orders-result',
  revision: 'result-1',
  outputId: 'rows',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
};
const result = {
  version: '1',
  ref,
  taskId: 'orders-task',
  identity: ['order.id'],
  rowGrain: ['order.id'],
  fields: [
    { id: 'order.id', label: 'Order', role: 'identity', type: { value: 'text', nullable: false } },
    { id: 'region', label: 'Region', role: 'dimension', type: { value: 'text', nullable: false } },
    { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'integer', nullable: false } },
  ],
  counts: { loaded: 2, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Bounded supplied rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot' },
  evidence: { kind: 'computed', queryDigest: 'query-1', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const rows = [
  { 'order.id': 'o-1', region: 'North', amount: 12 },
  { 'order.id': 'o-2', region: 'South', amount: 18 },
];
const visualization = {
  version: '1',
  view: 'bar',
  plot: {
    version: '1',
    root: {
      kind: 'unit',
      mark: 'bar',
      result: ref,
      missing: 'gap',
      encoding: {
        x: { field: 'region', scale: 'ordinal' },
        y: { field: 'amount', scale: 'linear', zero: true },
      },
    },
  },
};
const registry = createVarendoPresentationRegistry({
  resolveEntity: () => 'orders',
  visualizations: [
    {
      result,
      context: { results: [result] },
      datasets: [{ result: ref, rows }],
    },
  ],
});
assert.equal(registry.ok, true);
if (!registry.ok) throw Error(JSON.stringify(registry.diagnostics));

const bar = registry.value.manifests.find((manifest) => manifest.ref.id === 'visualization.bar');
assert.ok(bar, 'the packed registry must expose the registered bar representation');
const resolved = bar.resolveConfig({ visualization }, result);
assert.equal(resolved.ok, true);
if (!resolved.ok) throw Error(JSON.stringify(resolved.diagnostics));
assert.deepEqual(resolved.value.values, { visualization });
assert.deepEqual(resolved.value.fields, ['order.id', 'region', 'amount']);
assert.deepEqual(resolved.value.ports, [
  {
    id: 'selection',
    direction: 'inout',
    payload: 'selection',
    entity: 'orders',
    identity: ['order.id'],
    grain: ['order.id'],
  },
]);
assert.deepEqual(resolved.value.operations, [
  { id: 'data.read', revision: '1' },
  { id: 'interaction.selection', revision: '1' },
  { id: 'data.analyze', revision: '1' },
]);

console.log('Packed registered-bar consumer proof passed');
