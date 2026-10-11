import { it, expect } from 'vitest';
import { compilePlotUnit } from '../../packages/web/src/plot/geometry.js';
import type { PlotUnit, Result } from '../../packages/core/src/index.js';
import { result, ref } from '../contracts/fixtures.js';
const descriptor: Result = {
  ...result,
  counts: { loaded: 3, population: { kind: 'exact', value: 3, populationDigest: 'population-1' } },
  identity: ['id'],
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'x', label: 'Day', type: { value: 'integer', nullable: false }, role: 'dimension' },
    {
      id: 'y',
      label: 'Amount',
      type: { value: 'decimal', nullable: true, unit: { dimension: 'money', symbol: 'USD' } },
      role: 'measure',
    },
  ],
};
const unit: PlotUnit = {
  kind: 'unit',
  result: ref,
  mark: 'line',
  missing: 'gap',
  encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
};
const rows = [
  { id: 'a', x: 1, y: { decimal: '1.123456789012345678' } },
  { id: 'b', x: 2, y: null },
  { id: 'c', x: 3, y: { decimal: '3.123456789012345678' } },
];
const options = { width: 400, height: 240, maxRows: 100, maxMarks: 100 };
it('retains exact rows and creates separate path segments at missing observations', () => {
  const r = compilePlotUnit(unit, descriptor, rows, options);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const paths = r.value.marks.filter((m) => m.kind === 'path');
  expect(paths).toHaveLength(1);
  expect(paths[0]!.path.match(/M/g)).toHaveLength(2);
  expect(r.value.rows[0]!.values.y).toEqual(rows[0]!.y);
  expect(r.value.axes!.yLabel).toBe('Amount (USD)');
});
it('fails closed for exceeded budgets, forged scope, duplicate IDs and unordered lines', () => {
  const bounded = compilePlotUnit(unit, descriptor, rows, { ...options, maxMarks: 1 });
  expect(bounded.ok && bounded.value.state).toBe('data-only');
  expect(compilePlotUnit(unit, descriptor, rows.slice(1), options).ok).toBe(false);
  expect(compilePlotUnit(unit, descriptor, [rows[0], rows[0], rows[2]], options).ok).toBe(false);
  const unordered = compilePlotUnit(unit, descriptor, [rows[2], rows[0], rows[1]], options);
  expect(unordered.ok && unordered.value.state).toBe('data-only');
});

it('omitted nullable runtime cells preserve the missing gap', () => {
  const r = compilePlotUnit(unit, descriptor, [rows[0], { id: 'b', x: 2 }, rows[2]], options);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.rows[1]!.values.y).toBeNull();
});

it('allows ordered segments to restart after an actual missing gap', () => {
  const r = compilePlotUnit(unit, descriptor, [rows[2], rows[1], rows[0]], options);
  expect(r.ok && r.value.state).toBe('plot');
});

it('rejects undeclared cells instead of silently dropping their contents', () => {
  expect(
    compilePlotUnit(unit, descriptor, [{ ...rows[0], hidden: { nested: true } }, rows[1], rows[2]], options).ok,
  ).toBe(false);
});
