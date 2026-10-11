import { it, expect } from 'vitest';
import { compilePlotComposition } from '../../packages/web/src/plot/composition.js';
import type { PlotSpec, PlotUnit, Result } from '../../packages/core/src/index.js';
import { result, ref } from '../contracts/fixtures.js';
const descriptor: Result = {
  ...result,
  identity: ['id'],
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'group', label: 'Group', type: { value: 'text', nullable: false }, role: 'dimension' },
    { id: 'x', label: 'X', type: { value: 'float', nullable: false }, role: 'measure' },
    { id: 'y', label: 'Y', type: { value: 'float', nullable: false }, role: 'measure' },
  ],
  counts: { loaded: 2, population: { kind: 'unknown' } },
};
const unit: PlotUnit = {
  kind: 'unit',
  mark: 'point',
  result: ref,
  missing: 'gap',
  encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
};
const rows = [
  { id: 'a', group: 'A', x: 0, y: 0 },
  { id: 'b', group: 'B', x: 10, y: 10 },
];
const options = { width: 400, height: 240, maxRows: 100, maxMarks: 100 };
it('facets preserve source identities/scope while sharing the full display domain', () => {
  const spec: PlotSpec = {
    version: '1',
    root: { kind: 'facet', field: 'group', scales: 'shared-compatible', child: unit },
  };
  const r = compilePlotComposition(spec, [descriptor], [{ result: ref, rows }], options);
  expect(r.ok).toBe(true);
  if (!r.ok || r.value.root.kind !== 'facet') return;
  expect(r.value.root.children.map((c) => c.label)).toEqual(['A', 'B']);
  const a = r.value.root.children[0]!.node,
    b = r.value.root.children[1]!.node;
  if (a.kind !== 'unit' || b.kind !== 'unit') throw Error();
  expect(a.geometry.marks[0]).toMatchObject({ x: 64, y: 192 });
  expect(b.geometry.marks[0]).toMatchObject({ x: 376, y: 24 });
  expect(a.geometry.result.ref).toEqual(ref);
  expect(a.geometry.rows).toHaveLength(2);
  expect(a.displayedIdentities).toHaveLength(1);
});
it('layer shared scales map equal values to equal positions across results', () => {
  const second: Result = { ...descriptor, ref: { ...ref, id: 'second' } };
  const r = compilePlotComposition(
    {
      version: '1',
      root: { kind: 'layer', scales: 'shared-compatible', children: [unit, { ...unit, result: second.ref }] },
    },
    [descriptor, second],
    [
      { result: ref, rows },
      {
        result: second.ref,
        rows: [
          { id: 'c', group: 'A', x: 10, y: 10 },
          { id: 'd', group: 'A', x: 20, y: 20 },
        ],
      },
    ],
    options,
  );
  expect(r.ok).toBe(true);
  if (!r.ok || r.value.root.kind !== 'layer') return;
  const a = r.value.root.children[0]!,
    b = r.value.root.children[1]!;
  if (a.kind !== 'unit' || b.kind !== 'unit') throw Error();
  expect(a.geometry.marks[1]).toMatchObject({ x: 220, y: 108 });
  expect(b.geometry.marks[0]).toMatchObject({ x: 220, y: 108 });
});
it('keeps otherwise identical plot inputs isolated by source lineage', () => {
  const sourceA = { ...ref, sourceLineage: 'source-a' };
  const sourceB = { ...ref, sourceLineage: 'source-b' };
  const first: Result = { ...descriptor, ref: sourceA };
  const second: Result = { ...descriptor, ref: sourceB };
  const compiled = compilePlotComposition(
    {
      version: '1',
      root: {
        kind: 'layer',
        scales: 'independent',
        children: [
          { ...unit, result: sourceA },
          { ...unit, result: sourceB },
        ],
      },
    },
    [first, second],
    [
      { result: sourceA, rows },
      { result: sourceB, rows: rows.map((row) => ({ ...row, id: `other-${row.id}` })) },
    ],
    options,
  );
  expect(compiled.ok).toBe(true);
  if (!compiled.ok || compiled.value.root.kind !== 'layer') return;
  const [left, right] = compiled.value.root.children;
  if (left?.kind !== 'unit' || right?.kind !== 'unit') throw new Error('Expected two compiled plot units.');
  expect(left.geometry.result.ref).toEqual(sourceA);
  expect(right.geometry.result.ref).toEqual(sourceB);
  expect(left.displayedIdentities).not.toEqual(right.displayedIdentities);
});
it('retains explicit concatenation direction and rejects missing datasets', () => {
  const spec: PlotSpec = { version: '1', root: { kind: 'concat', direction: 'block', children: [unit, unit] } };
  const r = compilePlotComposition(spec, [descriptor], [{ result: ref, rows }], options);
  expect(r.ok && r.value.root.kind).toBe('concat');
  expect(compilePlotComposition(spec, [descriptor], [], options).ok).toBe(false);
});
