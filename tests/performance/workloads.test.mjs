import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  environmentSnapshot,
  percentile,
  firstSubsequent,
  makeRows,
  semanticFields,
  mediumPlan,
  runMediumPlanner,
  runTargetedReducer,
} from './workloads.mjs';

test('Node with a global navigator is still recorded as Node', () => {
  assert.equal(typeof navigator, 'object');
  assert.deepEqual(environmentSnapshot(), {
    runtime: 'node',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });
});

test('nearest-rank p95 uses the tail, not a missing-index zero fallback', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
});
test('missing or invalid percentile configuration cannot pass a budget', () => {
  for (const fraction of [undefined, NaN, 0, -1, 1.01]) assert.throws(() => percentile([20], fraction));
  for (const observations of [[], [NaN], [Infinity], [-1]]) assert.throws(() => percentile(observations, 0.95));
});
test('measurements retain operation results and predetermined sample counts', async () => {
  let call = 0;
  const result = await firstSubsequent('unit sequence', async () => ({ call: ++call }), {
    firstCount: 2,
    subsequentCount: 3,
  });
  assert.deepEqual(result.results.first, [{ call: 1 }, { call: 2 }]);
  assert.deepEqual(result.results.subsequent, [{ call: 3 }, { call: 4 }, { call: 5 }]);
  assert.equal(result.first.count, 2);
  assert.equal(result.subsequent.count, 3);
});
test('medium records contain every declared semantic field', () => {
  const rows = makeRows(3, 100);
  for (const row of rows) for (const field of semanticFields(100)) assert.ok(Object.hasOwn(row, field.id), field.id);
});

function originalRows(count, fieldCount = 4) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const row = { id: `row-${index + 1}`, label: `Row ${index + 1}`, value: index };
    for (let field = 1; field < fieldCount; field += 1)
      row[`field-${String(field).padStart(3, '0')}`] = `v-${index}-${field}`;
    rows.push(row);
  }
  return rows;
}

test('field-name setup preserves every row value, property order and descriptor', () => {
  for (const [count, fields] of [
    [0, 100],
    [1, 0],
    [1, 1],
    [3, 4],
    [100, 4],
    [3, 100],
    [10_000, 100],
  ]) {
    const expected = originalRows(count, fields);
    const actual = makeRows(count, fields);
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    for (let index = 0; index < count; index += 1) {
      assert.deepEqual(Reflect.ownKeys(actual[index]), Reflect.ownKeys(expected[index]));
      assert.deepEqual(
        Object.getOwnPropertyDescriptors(actual[index]),
        Object.getOwnPropertyDescriptors(expected[index]),
      );
    }
  }
  assert.deepEqual(makeRows(3), originalRows(3));
});

test('medium setup creates fresh rows within and across every invocation', () => {
  const first = makeRows(10_000, 100);
  const second = makeRows(10_000, 100);
  assert.notEqual(first, second);
  assert.equal(first.length, 10_000);
  assert.equal(second.length, 10_000);
  assert.equal(new Set(first).size, 10_000);
  assert.equal(new Set(second).size, 10_000);
  for (let index = 0; index < first.length; index += 1) {
    assert.notEqual(first[index], second[index]);
    assert.equal(Reflect.ownKeys(first[index]).length, 102);
    assert.equal(Reflect.ownKeys(second[index]).length, 102);
  }
  first[0].label = 'Changed';
  first[0]['field-001'] = 'Changed';
  assert.equal(second[0].label, 'Row 1');
  assert.equal(second[0]['field-001'], 'v-0-1');
  assert.equal(first[1]['field-001'], 'v-1-1');
});

test('the planner workload exercises 64 distinct complete candidates', () => {
  const { candidates } = mediumPlan();
  assert.equal(candidates.length, 64);
  assert.equal(new Set(candidates.map((candidate) => JSON.stringify(candidate.plan))).size, 64);
  for (const candidate of candidates) assert.equal(candidate.plan.nodes.length, 31);
});

test('functional planner and reducer never sample the performance clock or report timings', async () => {
  const original = globalThis.performance;
  globalThis.performance = {
    now() {
      const caller = new Error().stack?.split('\n')[2] ?? '';
      assert.equal(
        caller.includes('/tests/performance/workloads.mjs'),
        false,
        'Workload timing is forbidden in functional mode',
      );
      return original.now();
    },
  };
  try {
    const planner = runMediumPlanner({ timed: false });
    const reducer = await runTargetedReducer(2, { timed: false });
    assert.equal(planner.nodes, 31);
    assert.equal(reducer.successful, 2);
    assert.equal(reducer.unrelatedRoutes, 0);
    for (const result of [planner, reducer]) {
      for (const key of ['durationMs', 'rawMs', 'p50Ms', 'p95Ms']) assert.equal(key in result, false);
    }
  } finally {
    globalThis.performance = original;
  }
});
