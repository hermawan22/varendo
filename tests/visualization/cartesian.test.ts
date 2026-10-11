import { describe, expect, it } from 'vitest';
import { bindVisualizationSpec } from '../../packages/core/src/contracts/visualization/index.js';
import type { PlotUnit, Result, VisualizationSpec } from '../../packages/core/src/index.js';
import { compilePlotUnit } from '../../packages/web/src/plot/geometry.js';
import { materializeVisualizationRows } from '../../packages/web/src/visualization/materialization.js';
import { result as baseResult } from '../contracts/fixtures.js';

const ref = { ...baseResult.ref, id: 'cartesian' };
const fields: Result['fields'] = [
  { id: 'id', label: 'Row', role: 'identity', type: { value: 'text', nullable: false } },
  {
    id: 'date',
    label: 'Day',
    role: 'time',
    type: { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } },
  },
  { id: 'category', label: 'Category', role: 'dimension', type: { value: 'text', nullable: false } },
  { id: 'feature', label: 'Feature', role: 'dimension', type: { value: 'text', nullable: false } },
  { id: 'x', label: 'X', role: 'measure', type: { value: 'integer', nullable: false } },
  { id: 'y', label: 'Value', role: 'measure', type: { value: 'integer', nullable: false } },
  { id: 'low', label: 'Bin start', role: 'dimension', type: { value: 'integer', nullable: false } },
  { id: 'high', label: 'Bin end', role: 'dimension', type: { value: 'integer', nullable: false } },
  { id: 'zero', label: 'Baseline', role: 'measure', type: { value: 'integer', nullable: false } },
  { id: 'color', label: 'Intensity', role: 'measure', type: { value: 'integer', nullable: false } },
];
const rows = [
  { id: 'a', date: '2025-01-01', category: 'A', feature: 'I', x: 1, y: 2, low: 0, high: 1, zero: 0, color: 2 },
  { id: 'b', date: '2025-01-02', category: 'A', feature: 'II', x: 2, y: 3, low: 1, high: 2, zero: 0, color: 3 },
  { id: 'c', date: '2025-01-03', category: 'B', feature: 'I', x: 3, y: 4, low: 2, high: 3, zero: 0, color: 4 },
  { id: 'd', date: '2025-01-04', category: 'B', feature: 'II', x: 4, y: 5, low: 3, high: 4, zero: 0, color: 5 },
];
const descriptor = (loaded = rows.length): Result => ({
  ...baseResult,
  ref,
  fields,
  identity: ['id'],
  rowGrain: ['id', 'date', 'category', 'feature', 'low', 'high'],
  counts: { loaded, population: { kind: 'unknown' } },
  coverage: { kind: 'unknown', reason: 'Observed page only' },
});
const options = { width: 480, height: 280, maxRows: 100, maxMarks: 100 };
const unit = (mark: PlotUnit['mark'], encoding: PlotUnit['encoding']): PlotUnit => ({
  kind: 'unit',
  mark,
  result: ref,
  missing: 'gap',
  encoding,
});
const compile = (
  node: PlotUnit,
  result: Result,
  values: readonly Record<string, unknown>[],
  family: 'trend' | 'bar' | 'area' | 'scatter' | 'histogram' | 'heatmap',
  stack?: 'none' | 'zero',
) => compilePlotUnit(node, result, values, { ...options, family, ...(stack === undefined ? {} : { stack }) });

describe('Cartesian geometry family', () => {
  it('binds and materializes all six view shapes through the shared PlotSpec geometry', () => {
    const result = descriptor();
    const specs: readonly VisualizationSpec[] = [
      {
        version: '1',
        view: 'trend',
        plot: {
          version: '1',
          root: unit('line', { x: { field: 'date', scale: 'temporal' }, y: { field: 'y', scale: 'linear' } }),
        },
      },
      {
        version: '1',
        view: 'bar',
        plot: {
          version: '1',
          root: unit('bar', {
            x: { field: 'category', scale: 'ordinal' },
            y: { field: 'y', scale: 'linear', zero: true },
          }),
        },
      },
      {
        version: '1',
        view: 'scatter',
        plot: {
          version: '1',
          root: unit('point', { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } }),
        },
      },
      {
        version: '1',
        view: 'heatmap',
        plot: {
          version: '1',
          root: unit('cell', {
            x: { field: 'category', scale: 'ordinal' },
            y: { field: 'feature', scale: 'ordinal' },
            color: { field: 'color', scale: 'linear' },
          }),
        },
      },
    ];
    for (const spec of specs) {
      const bound = bindVisualizationSpec(spec, { results: [result] });
      expect(bound.ok, spec.view).toBe(true);
      if (!bound.ok) continue;
      const materialized = materializeVisualizationRows(bound.value, ref, [{ result: ref, rows }]);
      expect(materialized.ok, spec.view).toBe(true);
      if (!materialized.ok || !('plot' in spec)) continue;
      const geometry = compilePlotUnit(
        spec.plot.root as PlotUnit,
        result,
        materialized.value.map((row) => row.values),
        { ...options, family: spec.view },
      );
      expect(geometry.ok, spec.view).toBe(true);
      if (geometry.ok) expect(geometry.value.rows).toHaveLength(rows.length);
    }
  });

  it('preserves trend gaps and uses a quantitative zero baseline for negative bars', () => {
    const result = descriptor(3);
    const trend = unit('line', { x: { field: 'date', scale: 'temporal' }, y: { field: 'y', scale: 'linear' } });
    const gapped = rows.slice(0, 3).map((row, index) => (index === 1 ? { ...row, y: null } : row));
    const trendResult = {
      ...result,
      fields: result.fields.map((field) =>
        field.id === 'y' ? { ...field, type: { ...field.type, nullable: true } } : field,
      ),
    } as Result;
    const line = compile(trend, trendResult, gapped, 'trend');
    expect(line.ok).toBe(true);
    if (line.ok) expect(line.value.marks.filter((mark) => mark.kind === 'path')[0]?.path.match(/M/gu)).toHaveLength(2);
    const bar = compile(
      unit('bar', { x: { field: 'category', scale: 'ordinal' }, y: { field: 'y', scale: 'linear', zero: true } }),
      {
        ...result,
        fields: result.fields.map((field) =>
          field.id === 'y' ? { ...field, type: { ...field.type, nullable: false } } : field,
        ),
      } as Result,
      rows.slice(0, 3).map((row, index) => ({ ...row, category: `Category ${index}`, y: index === 1 ? -3 : row.y })),
      'bar',
    );
    expect(bar.ok).toBe(true);
    if (bar.ok)
      expect(bar.value.marks.some((mark) => mark.kind === 'rect' && mark.y > 100 && mark.height > 0)).toBe(true);
  });

  it('stacks positive area series independently from negative series and rejects duplicate temporal cells', () => {
    const result = descriptor(4);
    const area = unit('area', {
      x: { field: 'date', scale: 'temporal' },
      y: { field: 'y', scale: 'linear', zero: true },
      series: { field: 'category', scale: 'ordinal' },
    });
    const stacked = rows.map((row, index) => ({
      ...row,
      date: rows[Math.floor(index / 2)]!.date,
      category: index % 2 === 0 ? 'A' : 'B',
      y: index % 2 === 0 ? row.y : -row.y,
    }));
    const geometry = compile(area, result, stacked, 'area', 'zero');
    expect(geometry.ok).toBe(true);
    if (geometry.ok) expect(geometry.value.marks.filter((mark) => mark.kind === 'path')).toHaveLength(2);
    const duplicate = compile(area, descriptor(5), [...stacked, { ...stacked[0]!, id: 'duplicate' }], 'area', 'zero');
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.value.state).toBe('data-only');
  });

  it('keeps malformed histogram bins as a data-only result and renders a quantitative heatmap key', () => {
    const result = descriptor(4);
    const histogram = unit('rect', {
      x: { field: 'low', scale: 'linear' },
      x2: { field: 'high', scale: 'linear' },
      y: { field: 'y', scale: 'linear', zero: true },
      y2: { field: 'zero', scale: 'linear', zero: true },
    });
    const overlap = rows.map((row, index) => (index === 1 ? { ...row, low: 0 } : row));
    const invalid = compile(histogram, result, overlap, 'histogram');
    expect(invalid.ok).toBe(true);
    if (invalid.ok) expect(invalid.value.state).toBe('data-only');
    const heatmap = unit('cell', {
      x: { field: 'category', scale: 'ordinal' },
      y: { field: 'feature', scale: 'ordinal' },
      color: { field: 'color', scale: 'linear' },
    });
    const colored = compile(heatmap, result, rows, 'heatmap');
    expect(colored.ok).toBe(true);
    if (colored.ok) {
      expect(colored.value.axisLeft).toBe(216);
      expect(colored.value.axes?.x.ticks.every((tick) => tick.position >= 216)).toBe(true);
      expect(colored.value.colorField).toBe('color');
      expect(colored.value.colorTicks?.length).toBeGreaterThan(0);
      expect(colored.value.marks.some((mark) => mark.kind === 'rect' && mark.color !== undefined)).toBe(true);
    }
    const narrow = compilePlotUnit(heatmap, result, rows, { ...options, width: 160, family: 'heatmap' });
    expect(narrow).toMatchObject({
      ok: true,
      value: { state: 'data-only', rows: { length: rows.length }, reason: expect.stringContaining('304 CSS pixels') },
    });
  });

  it('rejects ambiguous or overcrowded bars and preserves unplottable rows for the data view', () => {
    const result = descriptor();
    const bar = unit('bar', {
      x: { field: 'category', scale: 'ordinal' },
      y: { field: 'y', scale: 'linear', zero: true },
    });
    const duplicateX = compile(
      bar,
      result,
      rows.map((row, index) => ({ ...row, category: index < 2 ? 'A' : 'B' })),
      'bar',
    );
    expect(duplicateX.ok).toBe(true);
    if (duplicateX.ok) expect(duplicateX.value.state).toBe('data-only');
    const denseRows = Array.from({ length: 1_000 }, (_, index) => ({
      ...rows[index % rows.length]!,
      id: `dense-${index}`,
      category: `C${index}`,
      date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
    }));
    const dense = compilePlotUnit(bar, descriptor(denseRows.length), denseRows, {
      ...options,
      maxRows: 2_000,
      maxMarks: 2_000,
      family: 'bar',
    });
    expect(dense.ok).toBe(true);
    if (dense.ok) expect(dense.value.state).toBe('data-only');
    const nullable = {
      ...result,
      fields: result.fields.map((field) =>
        field.id === 'y' ? { ...field, type: { ...field.type, nullable: true } } : field,
      ),
    } as Result;
    const empty = compile(
      unit('line', { x: { field: 'date', scale: 'temporal' }, y: { field: 'y', scale: 'linear' } }),
      nullable,
      rows.map((row) => ({ ...row, y: null })),
      'trend',
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.reason).toContain('No plottable observations');
  });

  it('does not silently drop quantitative color semantics from line paths or missing marks', () => {
    const result = descriptor();
    const coloredLine = compile(
      unit('line', {
        x: { field: 'date', scale: 'temporal' },
        y: { field: 'y', scale: 'linear' },
        color: { field: 'color', scale: 'linear' },
      }),
      result,
      rows,
      'trend',
    );
    expect(coloredLine.ok).toBe(true);
    if (coloredLine.ok) expect(coloredLine.value.state).toBe('data-only');
    const nullableColor = {
      ...result,
      fields: result.fields.map((field) =>
        field.id === 'color' ? { ...field, type: { ...field.type, nullable: true } } : field,
      ),
    } as Result;
    const missingColor = compile(
      unit('point', {
        x: { field: 'x', scale: 'linear' },
        y: { field: 'y', scale: 'linear' },
        color: { field: 'color', scale: 'linear' },
      }),
      nullableColor,
      rows.map((row, index) => (index === 0 ? { ...row, color: null } : row)),
      'scatter',
    );
    expect(missingColor.ok).toBe(true);
    if (missingColor.ok) expect(missingColor.value.state).toBe('data-only');
  });
});
