import { describe, it, expect } from 'vitest';
import { parsePlotSpec, serializeContract, type PlotSpec, type Result } from '../../packages/core/src/index.js';
import { bindPlotSpec } from '../../packages/core/src/contracts/plot/index.js';
import { result, ref } from './fixtures.js';
const data: Result = {
  ...result,
  fields: [
    { id: 'x', label: 'Date', type: { value: 'date', nullable: false }, role: 'time' },
    {
      id: 'y',
      label: 'Amount',
      type: { value: 'decimal', nullable: true, unit: { dimension: 'money', symbol: 'USD', currency: 'USD' } },
      role: 'measure',
    },
  ],
};
const spec: PlotSpec = {
  version: '1',
  root: {
    kind: 'unit',
    mark: 'line',
    result: ref,
    missing: 'gap',
    encoding: { x: { field: 'x', scale: 'temporal' }, y: { field: 'y', scale: 'linear' } },
  },
};
describe('production PlotSpec boundary', () => {
  it('round trips the canonical shape without granting access', () => {
    const encoded = serializeContract('plot-spec', spec);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(parsePlotSpec(encoded.value)).toEqual({ ok: true, value: spec });
    expect(bindPlotSpec(spec, [data]).ok).toBe(true);
    expect(bindPlotSpec(spec, []).ok).toBe(false);
  });
  it('rejects code, unsupported versions/channels and missing gap policy', () => {
    expect(parsePlotSpec({ ...spec, version: '2' }).ok).toBe(false);
    expect(parsePlotSpec({ ...spec, code: 'alert(1)' }).ok).toBe(false);
    const root = spec.root;
    if (root.kind !== 'unit') throw Error();
    expect(parsePlotSpec({ ...spec, root: { ...root, encoding: { ...root.encoding, html: '<b>x</b>' } } }).ok).toBe(
      false,
    );
    const { missing, ...rest } = root;
    expect(parsePlotSpec({ ...spec, root: rest }).ok).toBe(false);
  });
  it('checks exact revisions, fields, scale types and zero baselines', () => {
    const root = spec.root;
    if (root.kind !== 'unit') throw Error();
    for (const changed of [
      { ...root, result: { ...ref, revision: 'stale' } },
      { ...root, encoding: { ...root.encoding, x: { field: 'missing', scale: 'temporal' } } },
      { ...root, encoding: { ...root.encoding, x: { field: 'x', scale: 'linear' } } },
      { ...root, mark: 'bar' },
      { ...root, encoding: { ...root.encoding, y: { field: 'y', scale: 'log', zero: true } } },
    ])
      expect(bindPlotSpec({ ...spec, root: changed }, [data]).ok).toBe(false);
    expect(
      bindPlotSpec(
        {
          ...spec,
          root: {
            ...root,
            mark: 'bar',
            encoding: { ...root.encoding, y: { field: 'y', scale: 'linear', zero: true } },
          },
        },
        [data],
      ).ok,
    ).toBe(true);
  });
  it('rejects incompatible shared currencies and allows independent scales', () => {
    const root = spec.root;
    if (root.kind !== 'unit') throw Error();
    const other: Result = {
      ...data,
      ref: { ...ref, id: 'other' },
      fields: data.fields.map((f) =>
        f.id === 'y' ? { ...f, type: { ...f.type, unit: { dimension: 'money', symbol: 'EUR', currency: 'EUR' } } } : f,
      ),
    };
    const layer = { kind: 'layer', children: [root, { ...root, result: other.ref }], scales: 'shared-compatible' };
    expect(bindPlotSpec({ version: '1', root: layer }, [data, other]).ok).toBe(false);
    expect(bindPlotSpec({ version: '1', root: { ...layer, scales: 'independent' } }, [data, other]).ok).toBe(true);
  });
  it('bounds nested composition and refuses cycles before recursive validation', () => {
    const loop: any = { kind: 'facet', field: 'x', scales: 'independent' };
    loop.child = loop;
    expect(parsePlotSpec({ version: '1', root: loop }).ok).toBe(false);
    const group = { kind: 'concat', direction: 'inline', children: Array(32).fill(spec.root) };
    expect(
      bindPlotSpec({ version: '1', root: { kind: 'concat', direction: 'block', children: Array(5).fill(group) } }, [
        data,
      ]).ok,
    ).toBe(false);
  });
});

it('rejects a facet field whose meaning differs across child results', () => {
  const root = spec.root;
  if (root.kind !== 'unit') throw Error();
  const other: Result = {
    ...data,
    ref: { ...ref, id: 'other' },
    fields: data.fields.map((f) => (f.id === 'x' ? { ...f, type: { value: 'text', nullable: false } } : f)),
  };
  const second = { ...root, result: other.ref, encoding: { ...root.encoding, x: { field: 'x', scale: 'ordinal' } } };
  const facet = {
    version: '1',
    root: {
      kind: 'facet',
      field: 'x',
      scales: 'independent',
      child: { kind: 'layer', scales: 'independent', children: [root, second] },
    },
  };
  expect(bindPlotSpec(facet, [data, other]).ok).toBe(false);
});

it('requires shared axes to use the same scalar representation', () => {
  const root = spec.root;
  if (root.kind !== 'unit') throw Error();
  const integer: Result = {
    ...data,
    ref: { ...ref, id: 'integer' },
    fields: data.fields.map((f) => (f.id === 'y' ? { ...f, type: { ...f.type, value: 'integer' } } : f)),
  };
  const layer = { kind: 'layer', scales: 'shared-compatible', children: [root, { ...root, result: integer.ref }] };
  expect(bindPlotSpec({ version: '1', root: layer }, [data, integer]).ok).toBe(false);
  expect(bindPlotSpec({ version: '1', root: { ...layer, scales: 'independent' } }, [data, integer]).ok).toBe(true);
});
