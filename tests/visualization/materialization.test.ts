import { expect, it } from 'vitest';
import { bindVisualizationSpec } from '../../packages/core/src/contracts/visualization/index.js';
import type { Result } from '../../packages/core/src/index.js';
import { compilePlotUnit } from '../../packages/web/src/plot/geometry.js';
import { materializeVisualizationRows } from '../../packages/web/src/visualization/materialization.js';
import { result as source } from '../contracts/fixtures.js';
const result: Result = {
  ...source,
  counts: { loaded: 2, population: { kind: 'unknown' } },
  coverage: { kind: 'unknown', reason: 'Observed page only' },
  fields: [
    ...source.fields,
    { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'decimal', nullable: true } },
  ],
};
const checked = bindVisualizationSpec(
  { version: '1', view: 'matrix', result: result.ref, columns: ['employee.id', 'amount'] },
  { results: [result] },
);
if (!checked.ok) throw Error(JSON.stringify(checked));
const bound = checked.value;
const rows = [
  { 'employee.id': 'a', amount: { decimal: '100000000000000000.01' } },
  { 'employee.id': 'b', amount: null },
];
it('preserves exact values, nulls and row identity across reordered materializations', () => {
  const a = materializeVisualizationRows(bound, result.ref, [{ result: result.ref, rows }]);
  const b = materializeVisualizationRows(bound, result.ref, [{ result: result.ref, rows: [...rows].reverse() }]);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.value[0]?.values.amount).toEqual({ decimal: '100000000000000000.01' });
  expect(a.value[0]?.identity).toBe(b.value[1]?.identity);
  expect(Object.isFrozen(a.value[0]?.values)).toBe(true);
});

it('accepts an exact source-lineage pin and rejects another lineage', () => {
  const lineaged: Result = { ...result, ref: { ...result.ref, sourceLineage: 'source-a' } };
  const checked = bindVisualizationSpec(
    { version: '1', view: 'matrix', result: lineaged.ref, columns: ['employee.id', 'amount'] },
    { results: [lineaged] },
  );
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(materializeVisualizationRows(checked.value, lineaged.ref, [{ result: lineaged.ref, rows }]).ok).toBe(true);
  expect(
    materializeVisualizationRows(checked.value, { ...lineaged.ref, sourceLineage: 'source-b' }, [
      { result: lineaged.ref, rows },
    ]).ok,
  ).toBe(false);
});

it('rejects stale, duplicate, malformed, extra-field and accessor payloads', () => {
  const dataset = { result: result.ref, rows };
  expect(materializeVisualizationRows(bound, { ...result.ref, id: 1n } as unknown as Result['ref'], [dataset]).ok).toBe(
    false,
  );
  expect(materializeVisualizationRows(bound, { ...result.ref, revision: 'stale' }, [dataset]).ok).toBe(false);
  expect(materializeVisualizationRows(bound, result.ref, [dataset, dataset]).ok).toBe(false);
  for (const invalid of [
    [rows[0]],
    [rows[0], rows[0]],
    [rows[0], { 'employee.id': 'b', secret: 'not allowed' }],
    [rows[0], { 'employee.id': 'b', amount: 1 }],
  ])
    expect(
      materializeVisualizationRows(bound, result.ref, [{ result: result.ref, rows: invalid as typeof rows }]).ok,
    ).toBe(false);
  let reads = 0;
  const accessor = Object.defineProperty({}, 'employee.id', {
    enumerable: true,
    get() {
      reads++;
      return 'a';
    },
  });
  expect(materializeVisualizationRows(bound, result.ref, [{ result: result.ref, rows: [accessor, rows[1]!] }]).ok).toBe(
    false,
  );
  expect(reads).toBe(0);
});

it('treats absent nullable prototype-named fields as null', () => {
  const extended: Result = {
    ...result,
    fields: [
      ...result.fields,
      { id: 'toString', label: 'Nullable text', role: 'attribute', type: { value: 'text', nullable: true } },
    ],
  };
  const checked = bindVisualizationSpec(
    { version: '1', view: 'matrix', result: result.ref, columns: ['toString'] },
    { results: [extended] },
  );
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  const materialized = materializeVisualizationRows(checked.value, result.ref, [{ result: result.ref, rows }]);
  expect(materialized.ok).toBe(true);
  if (!materialized.ok) return;
  expect(materialized.value.map((row) => row.values.toString)).toEqual([null, null]);
  expect(
    compilePlotUnit(
      {
        kind: 'unit',
        mark: 'point',
        result: extended.ref,
        missing: 'gap',
        encoding: { x: { field: 'employee.id', scale: 'ordinal' }, y: { field: 'amount', scale: 'linear' } },
      },
      extended,
      rows,
      { width: 320, height: 240, maxRows: 10, maxMarks: 100 },
    ).ok,
  ).toBe(true);
});
