import { it, expect } from 'vitest';
import { makeAxisScale, makePlotScale } from '../../packages/web/src/plot/scales.js';
it('retains tiny exact differences on an enormous decimal baseline', () => {
  const values = [
    '9007199254740993123456789.0001',
    '9007199254740993123456789.0002',
    '9007199254740993123456789.0003',
  ].map((decimal) => ({ decimal }));
  const scale = makePlotScale(
    { field: 'amount', scale: 'linear' },
    { value: 'decimal', nullable: false },
    values,
    [0, 100],
  );
  expect(values.map(scale.at)).toEqual([0, 50, 100]);
  expect(scale.ticks.map((t) => t.label)).toEqual(values.map((v) => v.decimal));
});
it('uses exact fractional instant offsets and preserves gaps', () => {
  const values = ['2026-09-08T00:00:00.0001Z', '2026-09-08T00:00:00.0002Z', '2026-09-08T00:00:00.0003Z'];
  const scale = makePlotScale(
    { field: 'time', scale: 'temporal' },
    { value: 'instant', nullable: true },
    values,
    [0, 100],
  );
  expect(values.map(scale.at)).toEqual([0, 50, 100]);
  expect(scale.at(null)).toBeUndefined();
});
it('rejects nonpositive log observations and centers equal values', () => {
  expect(() =>
    makePlotScale({ field: 'v', scale: 'log' }, { value: 'float', nullable: false }, [0, 1], [0, 100]),
  ).toThrow();
  const scale = makePlotScale({ field: 'v', scale: 'linear' }, { value: 'float', nullable: false }, [2, 2], [0, 100]);
  expect(scale.at(2)).toBe(50);
});
it('labels a zero-based linear axis with round steps instead of raw data values', () => {
  const scale = makeAxisScale(
    { field: 'amount', scale: 'linear', zero: true },
    { value: 'integer', nullable: false },
    [96, 120, 144],
    [300, 0],
  );
  expect(scale.ticks.map((tick) => tick.label)).toEqual(['0', '50', '100']);
  expect(scale.ticks[0]!.position).toBe(300);
  expect(scale.at(144)).toBe(0);
  const colorKey = makePlotScale(
    { field: 'amount', scale: 'linear', zero: true },
    { value: 'integer', nullable: false },
    [96, 120, 144],
    [0, 1],
  );
  expect(colorKey.ticks.map((tick) => tick.label)).toEqual(['96', '120', '144']);
});
it('keeps whole-number steps for small counts and exact decimal labels', () => {
  const counts = makeAxisScale(
    { field: 'hires', scale: 'linear', zero: true },
    { value: 'integer', nullable: false },
    [1, 2],
    [100, 0],
  );
  expect(counts.ticks.map((tick) => tick.label)).toEqual(['0', '1', '2']);
  const decimals = makeAxisScale(
    { field: 'rate', scale: 'linear' },
    { value: 'decimal', nullable: false },
    [{ decimal: '0.5' }, { decimal: '1.0' }],
    [100, 0],
  );
  expect(decimals.ticks.map((tick) => tick.label)).toEqual(['0.5', '0.6', '0.7', '0.8', '0.9', '1']);
});
