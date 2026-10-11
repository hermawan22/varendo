import { describe, expect, it } from 'vitest';
import { parseVisualizationSpec, serializeContract } from '../../packages/core/src/index.js';
import { bindVisualizationSpec } from '../../packages/core/src/contracts/visualization/index.js';
import type {
  Catalog,
  FieldDefinition,
  MeaningDefinition,
  PlotUnit,
  Result,
  VisualizationSpec,
} from '../../packages/core/src/index.js';
import { catalog, result } from './fixtures.js';
const text = { value: 'text', nullable: false } as const;
const number = { value: 'integer', nullable: false } as const;
const date = { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } } as const;
const meaning: MeaningDefinition = {
  id: 'amount',
  revision: '1',
  label: 'Amount',
  explanation: 'Authorized additive observations',
  output: number,
  implementation: { kind: 'host-capability', capability: { id: 'amount', revision: '1' } },
  dependencies: [],
  functionRegistryDigest: catalog.functionRegistryDigest,
  origin: 'manual',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'reviewed',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'reject',
};
const fields: FieldDefinition[] = [
  { id: 'id', label: 'Node', role: 'identity', type: text },
  { id: 'parent', label: 'Parent', role: 'attribute', type: { ...text, nullable: true } },
  { id: 'category', label: 'Category', role: 'dimension', type: text },
  { id: 'feature', label: 'Feature', role: 'dimension', type: text },
  { id: 'date', label: 'Date', role: 'time', type: date },
  { id: 'end', label: 'End', role: 'time', type: date },
  { id: 'low', label: 'Bin start', role: 'dimension', type: number },
  { id: 'high', label: 'Bin end', role: 'dimension', type: number },
  {
    id: 'amount',
    label: 'Amount',
    role: 'measure',
    type: number,
    derivation: { id: meaning.id, revision: meaning.revision },
  },
  { id: 'zero', label: 'Baseline', role: 'measure', type: number },
];
const descriptor: Result = {
  ...result,
  fields,
  identity: ['id'],
  rowGrain: ['id', 'date', 'low', 'high', 'category', 'feature'],
};
const hierarchy: Result = { ...descriptor, rowGrain: ['id'] };
const authorized: Catalog = {
  ...catalog,
  meanings: [meaning],
  entities: [
    { id: 'nodes', label: 'Nodes', identity: ['id'], rowGrain: ['id'], fields: [fields[0]!] },
    {
      id: 'parents',
      label: 'Parents',
      identity: ['parent'],
      rowGrain: ['parent'],
      fields: [{ ...fields[1]!, type: text }],
    },
  ],
  relationships: [
    {
      id: 'parent-edge',
      revision: '1',
      sourceEntity: 'nodes',
      targetEntity: 'parents',
      keys: [{ sourceField: 'id', targetField: 'parent' }],
      cardinality: 'many-to-one',
      optional: true,
      joinPolicy: 'validated',
    },
  ],
};
const plot = (mark: PlotUnit['mark'], encoding: PlotUnit['encoding']) => ({
  version: '1' as const,
  root: { kind: 'unit' as const, mark, result: descriptor.ref, encoding, missing: 'gap' as const },
});
const xy = {
  x: { field: 'date', scale: 'temporal' as const },
  y: { field: 'amount', scale: 'linear' as const, zero: true },
};
const fixtures: VisualizationSpec[] = [
  { version: '1', view: 'trend', plot: plot('line', xy) },
  { version: '1', view: 'bar', plot: plot('bar', { ...xy, x: { field: 'category', scale: 'ordinal' } }) },
  {
    version: '1',
    view: 'area',
    plot: plot('area', { ...xy, series: { field: 'category', scale: 'ordinal' } }),
    meaning: { id: 'amount', revision: '1' },
    stack: 'zero',
  },
  { version: '1', view: 'scatter', plot: plot('point', { ...xy, x: { field: 'low', scale: 'linear' } }) },
  {
    version: '1',
    view: 'histogram',
    plot: plot('rect', {
      x: { field: 'low', scale: 'linear' },
      x2: { field: 'high', scale: 'linear' },
      y: xy.y,
      y2: { field: 'zero', scale: 'linear', zero: true },
    }),
    bins: { start: 'low', end: 'high', value: 'amount', measure: 'count', boundary: 'start-inclusive-end-exclusive' },
  },
  {
    version: '1',
    view: 'heatmap',
    plot: plot('cell', {
      x: { field: 'category', scale: 'ordinal' },
      y: { field: 'feature', scale: 'ordinal' },
      color: { field: 'amount', scale: 'linear' },
    }),
  },
  { version: '1', view: 'matrix', result: descriptor.ref, columns: ['category', 'amount'] },
  { version: '1', view: 'tree', result: descriptor.ref, node: ['id'], parent: ['parent'] },
  {
    version: '1',
    view: 'treemap',
    result: descriptor.ref,
    node: ['id'],
    parent: ['parent'],
    value: 'amount',
    meaning: { id: 'amount', revision: '1' },
  },
  {
    version: '1',
    view: 'relationship',
    result: descriptor.ref,
    source: ['id'],
    target: ['parent'],
    relationship: { id: 'parent-edge', revision: '1' },
  },
  { version: '1', view: 'timeline', result: descriptor.ref, start: 'date', end: 'end' },
  { version: '1', view: 'calendar-grid', result: descriptor.ref, date: 'date', value: 'amount', weekStartsOn: 1 },
];
const edges: Result = {
  ...descriptor,
  fields: descriptor.fields.map((field) => (field.id === 'parent' ? { ...field, type: text } : field)),
};
const context = (spec: VisualizationSpec) => ({
  results: [
    spec.view === 'relationship' ? edges : spec.view === 'tree' || spec.view === 'treemap' ? hierarchy : descriptor,
  ],
  catalog: authorized,
  histograms: spec.view === 'histogram' ? [{ result: descriptor.ref, bins: spec.bins }] : [],
  relationships: [
    { result: descriptor.ref, relationship: { id: 'parent-edge', revision: '1' }, source: ['id'], target: ['parent'] },
  ],
});

function expectDiagnostic(outcome: ReturnType<typeof bindVisualizationSpec>, code: string, message: string): void {
  expect(outcome).toEqual({
    ok: false,
    diagnostics: [{ code: `visualization.${code}`, message, retryable: false }],
  });
}

describe('owned visualization family contracts', () => {
  for (const spec of fixtures)
    it(`${spec.view} round trips and binds exact authorized descriptors`, () => {
      const serialized = serializeContract('visualization-spec', spec);
      expect(serialized.ok).toBe(true);
      if (serialized.ok) expect(parseVisualizationSpec(serialized.value)).toEqual({ ok: true, value: spec });
      const bound = bindVisualizationSpec(spec, context(spec));
      expect(bound.ok, JSON.stringify(bound)).toBe(true);
      if (bound.ok) {
        expect(Object.isFrozen(bound.value.spec)).toBe(true);
        expect(bound.value.results[0]).not.toBe(descriptor);
        expect(bound.value.results[0]?.ref).toEqual(descriptor.ref);
      }
      expect(bindVisualizationSpec(spec, { ...context(spec), results: [] }).ok).toBe(false);
    });
  it('rejects unsupported shapes, code and cross-family configuration', () => {
    for (const spec of fixtures) {
      expect(parseVisualizationSpec({ ...spec, version: '2' }).ok).toBe(false);
      expect(parseVisualizationSpec({ ...spec, html: '<svg/>' }).ok).toBe(false);
      expect(parseVisualizationSpec({ ...spec, approved: true }).ok).toBe(false);
    }
    expect(parseVisualizationSpec({ ...fixtures[0], columns: ['amount'] }).ok).toBe(false);
    expect(parseVisualizationSpec({ ...fixtures[11], weekStartsOn: 7 }).ok).toBe(false);
  });
  it('rejects stale, duplicate, identity-free and falsely complete descriptors', () => {
    for (const changed of [
      { ...descriptor, ref: { ...descriptor.ref, revision: 'old' } },
      { ...descriptor, identity: [] },
      {
        ...descriptor,
        fields: [
          ...descriptor.fields,
          { id: '__proto__', label: 'Reserved', role: 'attribute' as const, type: { ...text, nullable: true } },
        ],
      },
      { ...descriptor, rowGrain: ['missing'] },
      { ...descriptor, fields: [...descriptor.fields, descriptor.fields[0]!] },
      {
        ...descriptor,
        counts: {
          ...descriptor.counts,
          loaded: 1,
          population: { kind: 'exact' as const, value: 2, populationDigest: 'population' },
        },
      },
    ])
      expect(bindVisualizationSpec(fixtures[0], { results: [changed] }).ok).toBe(false);
    expect(bindVisualizationSpec(fixtures[0], { results: [descriptor, descriptor] }).ok).toBe(false);
  });
  it('requires authorized active additive meaning pinned by each magnitude field', () => {
    for (const spec of [fixtures[2]!, fixtures[8]!]) {
      expect(bindVisualizationSpec(spec, { results: context(spec).results }).ok).toBe(false);
      for (const patch of [
        { aggregation: 'non-additive' },
        { authority: 'hypothesis' },
        { lifecycle: 'draft' },
        { revision: 'old' },
      ] as const)
        expect(
          bindVisualizationSpec(spec, {
            ...context(spec),
            catalog: { ...authorized, meanings: [{ ...meaning, ...patch }] },
          }).ok,
        ).toBe(false);
      const changed = context(spec).results[0]!;
      expect(
        bindVisualizationSpec(spec, {
          ...context(spec),
          results: [
            {
              ...changed,
              fields: changed.fields.map((field) =>
                field.id === 'amount' ? { ...field, derivation: { id: 'other', revision: '1' } } : field,
              ),
            },
          ],
        }).ok,
      ).toBe(false);
    }
  });
  it('requires the declared relationship revision and matching endpoint semantics', () => {
    const spec = fixtures[9]!;
    expect(bindVisualizationSpec(spec, { results: [descriptor] }).ok).toBe(false);
    expect(
      bindVisualizationSpec(spec, {
        ...context(spec),
        catalog: { ...authorized, relationships: [{ ...authorized.relationships[0]!, revision: 'old' }] },
      }).ok,
    ).toBe(false);
    expect(bindVisualizationSpec({ ...spec, source: ['amount'] }, context(spec)).ok).toBe(false);
    expect(bindVisualizationSpec({ ...fixtures[7], parent: ['amount'] }, { results: [hierarchy] }).ok).toBe(false);
  });
  it('requires temporal policies and matching endpoint calendars', () => {
    const missing = {
      ...descriptor,
      fields: descriptor.fields.map((field) =>
        field.id === 'date' ? { ...field, type: { value: 'date' as const, nullable: false } } : field,
      ),
    };
    for (const index of [0, 10, 11])
      expect(bindVisualizationSpec(fixtures[index], { results: [missing] }).ok).toBe(false);
    const changed = {
      ...descriptor,
      fields: descriptor.fields.map((field) =>
        field.id === 'end' ? { ...field, type: { ...date, temporal: { calendar: 'hebrew' } } } : field,
      ),
    };
    expect(bindVisualizationSpec(fixtures[10], { results: [changed] }).ok).toBe(false);
  });
  it('rejects repeated axes, undeclared temporal grain, mismatched nullability and population digests', () => {
    const heatmap = fixtures[5]!;
    if (!('plot' in heatmap) || heatmap.plot.root.kind !== 'unit') throw Error();
    expect(
      bindVisualizationSpec(
        {
          ...heatmap,
          plot: {
            ...heatmap.plot,
            root: {
              ...heatmap.plot.root,
              encoding: { ...heatmap.plot.root.encoding, y: heatmap.plot.root.encoding.x },
            },
          },
        },
        context(heatmap),
      ).ok,
    ).toBe(false);
    const noGrain = {
      ...descriptor,
      fields: descriptor.fields.map((field) =>
        field.id === 'date' ? { ...field, type: { ...date, temporal: { calendar: 'gregory' } } } : field,
      ),
    };
    expect(bindVisualizationSpec(fixtures[0], { results: [noGrain] }).ok).toBe(false);
    expect(bindVisualizationSpec(fixtures[9], { ...context(fixtures[9]!), results: [descriptor] }).ok).toBe(false);
    expect(
      bindVisualizationSpec(fixtures[2], {
        ...context(fixtures[2]!),
        catalog: { ...authorized, meanings: [{ ...meaning, output: { ...number, nullable: true } }] },
      }).ok,
    ).toBe(false);
    expect(
      bindVisualizationSpec(fixtures[0], {
        results: [
          {
            ...descriptor,
            counts: { loaded: 0, population: { kind: 'exact', value: 0, populationDigest: 'A' } },
            coverage: { kind: 'complete', populationDigest: 'B' },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  it('accepts contextual result grain and enforces explicitly declared meaning grain', () => {
    const grouped = {
      ...descriptor,
      fields: descriptor.fields.map((field) => ({ ...field, type: { ...field.type, grain: descriptor.rowGrain } })),
    };
    expect(bindVisualizationSpec(fixtures[2], { ...context(fixtures[2]!), results: [grouped] }).ok).toBe(true);
    expect(
      bindVisualizationSpec(fixtures[2], {
        ...context(fixtures[2]!),
        results: [grouped],
        catalog: { ...authorized, meanings: [{ ...meaning, output: { ...number, grain: ['other'] } }] },
      }).ok,
    ).toBe(false);
    const edgeGrain = {
      ...edges,
      fields: edges.fields.map((field) => ({ ...field, type: { ...field.type, grain: edges.rowGrain } })),
    };
    expect(bindVisualizationSpec(fixtures[9], { ...context(fixtures[9]!), results: [edgeGrain] }).ok).toBe(true);
  });
  it('requires histogram endpoints, heatmap dimensions and quantitative axes', () => {
    expect(
      bindVisualizationSpec(
        {
          ...fixtures[4],
          bins: {
            start: 'low',
            end: 'missing',
            value: 'amount',
            measure: 'count',
            boundary: 'start-inclusive-end-exclusive',
          },
        },
        { results: [descriptor] },
      ).ok,
    ).toBe(false);
    expect(bindVisualizationSpec(fixtures[4], { results: [descriptor] }).ok).toBe(false);
    const histogram = fixtures[4]!;
    if (histogram.view !== 'histogram') throw Error();
    expect(
      bindVisualizationSpec({ ...histogram, bins: { ...histogram.bins, measure: 'density' } }, context(histogram)).ok,
    ).toBe(false);
    expect(bindVisualizationSpec(fixtures[5], { results: [{ ...descriptor, rowGrain: ['id'] }] }).ok).toBe(false);
    const scatter = fixtures[3]!;
    if (!('plot' in scatter) || scatter.plot.root.kind !== 'unit') throw Error();
    expect(
      bindVisualizationSpec(
        {
          ...scatter,
          plot: {
            ...scatter.plot,
            root: {
              ...scatter.plot.root,
              encoding: { ...scatter.plot.root.encoding, x: { field: 'category', scale: 'ordinal' } },
            },
          },
        },
        { results: [descriptor] },
      ).ok,
    ).toBe(false);
  });

  it('preserves authorization and family diagnostic paths', () => {
    const matrix = fixtures[6]!;
    expectDiagnostic(
      bindVisualizationSpec(matrix, { results: [descriptor, descriptor] }),
      'results',
      'An exact result reference is repeated.',
    );
    expectDiagnostic(
      bindVisualizationSpec(matrix, { results: [{ ...descriptor, rowGrain: ['missing'] }] }),
      'identity',
      'Visualization rows require declared nonnullable stable identity and field-based grain.',
    );
    expectDiagnostic(
      bindVisualizationSpec({ ...matrix, columns: ['category', 'category'] }, context(matrix)),
      'matrix',
      'Matrix columns must be unique.',
    );

    const histogram = fixtures[4]!;
    expectDiagnostic(
      bindVisualizationSpec(histogram, { ...context(histogram), histograms: [] }),
      'histogram',
      'The exact bin projection and count/density meaning must be declared once by the authorized host.',
    );
    const area = fixtures[2]!;
    expectDiagnostic(
      bindVisualizationSpec(area, { results: context(area).results }),
      'additivity',
      'Area magnitude requires an active authorized additive meaning pinned by the result field.',
    );
    const relationship = fixtures[9]!;
    expectDiagnostic(
      bindVisualizationSpec(relationship, { results: context(relationship).results }),
      'relationship',
      'Relationship view requires a declared versioned relation and stable endpoint identities.',
    );
    const missingCalendar = {
      ...descriptor,
      fields: descriptor.fields.map((field) =>
        field.id === 'date' ? { ...field, type: { value: 'date' as const, nullable: false } } : field,
      ),
    };
    expectDiagnostic(
      bindVisualizationSpec(fixtures[10]!, { results: [missingCalendar] }),
      'temporal',
      'Dated views require a declared calendar and timezone for instants.',
    );
  });
});
