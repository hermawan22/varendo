import { describe, expect, it } from 'vitest';
import type { Result } from '@varendo/core';
import {
  createAeliqoDataRegistry,
  validateAeliqoDataBinding,
  type AeliqoDataBinding,
} from '../../packages/web/src/region/data-registry.js';

const ref = {
  id: 'result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query',
  scopeDigest: 'scope',
} as const;
const fields = [
  {
    id: 'id',
    label: 'ID',
    type: { value: 'text' as const, nullable: false },
    role: 'identity' as const,
  },
  {
    id: 'name',
    label: 'Name',
    type: { value: 'text' as const, nullable: true },
    role: 'attribute' as const,
  },
  {
    id: 'amount',
    label: 'Amount',
    type: {
      value: 'decimal' as const,
      nullable: false,
      unit: { dimension: 'currency', symbol: 'USD' },
    },
    role: 'measure' as const,
  },
  {
    id: 'baseline',
    label: 'Baseline',
    type: {
      value: 'decimal' as const,
      nullable: false,
      unit: { dimension: 'currency', symbol: 'USD' },
    },
    role: 'measure' as const,
  },
  {
    id: 'currentRate',
    label: 'Current rate',
    type: {
      value: 'decimal' as const,
      nullable: true,
      unit: { dimension: 'ratio', symbol: '1' },
    },
    role: 'measure' as const,
  },
  {
    id: 'baselineRate',
    label: 'Baseline rate',
    type: {
      value: 'decimal' as const,
      nullable: true,
      unit: { dimension: 'ratio', symbol: '1' },
    },
    role: 'measure' as const,
  },
  {
    id: 'department',
    label: 'Department',
    type: { value: 'text' as const, nullable: false },
    role: 'dimension' as const,
  },
];
function result(overrides: Partial<Result> = {}): Result {
  return {
    version: '1',
    ref,
    taskId: 'task',
    fields,
    identity: ['id'],
    rowGrain: ['id'],
    counts: {
      loaded: 2,
      population: { kind: 'exact', value: 2, populationDigest: 'population' },
    },
    precision: { kind: 'exact' },
    coverage: { kind: 'complete', populationDigest: 'population' },
    consistency: {
      kind: 'snapshot',
      snapshotId: 'snapshot',
      sourceRevisions: { source: '1' },
    },
    evidence: { kind: 'observed', source: { id: 'source', revision: '1' } },
    filters: [],
    warnings: [],
    lineage: [],
    ...overrides,
  };
}
const rows = [
  {
    id: 'a',
    name: 'Ada',
    amount: { decimal: '12.50' },
    baseline: { decimal: '10.00' },
    department: 'Sales',
  },
  {
    id: 'b',
    name: 'Bea',
    amount: { decimal: '7.00' },
    baseline: { decimal: '7.00' },
    department: 'Design',
  },
] as const;
const ratioRows = [
  {
    ...rows[0],
    currentRate: { decimal: '0.62' },
    baselineRate: { decimal: '0.50' },
  },
  {
    ...rows[1],
    currentRate: { decimal: '0.40' },
    baselineRate: { decimal: '0.50' },
  },
] as const;
const binding = (override: Partial<AeliqoDataBinding> = {}) => ({
  result: override.result ?? result(),
  rows: override.rows ?? rows,
  ...(override.columns === undefined ? {} : { columns: override.columns }),
  ...(override.scope === undefined ? {} : { scope: override.scope }),
});
const ratioBinding = () => binding({ rows: ratioRows });

const registry = createAeliqoDataRegistry({ resolveEntity: () => 'person' });
const resolve = (
  component: Parameters<typeof registry.resolve>[0]['component'],
  config: Record<string, unknown> = {},
  value = binding(),
) =>
  registry.resolve(
    {
      id: `node-${String(typeof component === 'string' ? component : component.id)}`,
      component,
      config,
    },
    value,
  );

describe('authorized data binding', () => {
  it('requires the exact Result loaded count and validates declared scalar types', () => {
    expect(validateAeliqoDataBinding(binding({ rows: [rows[0]] })).ok).toBe(false);
    expect(validateAeliqoDataBinding(binding({ rows: [{ ...rows[0], amount: 12.5 } as never] })).ok).toBe(false);
    expect(validateAeliqoDataBinding(binding({ rows: [{ ...rows[0], extra: 'nope' }, rows[1]] as never })).ok).toBe(
      false,
    );
  });

  it('rejects duplicate identities and preserves the descriptor scope', () => {
    expect(validateAeliqoDataBinding(binding({ rows: [rows[0], { ...rows[1], id: 'a' }] })).ok).toBe(false);
    const checked = validateAeliqoDataBinding(binding());
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.result.ref).toEqual(ref);
      expect(checked.value.scope).toMatchObject({
        loaded: 2,
        populationTotal: 2,
        populationDigest: 'population',
        kind: 'population',
      });
    }
  });

  it('requires registered labels and types for supplied columns', () => {
    expect(
      validateAeliqoDataBinding({
        ...binding(),
        columns: [{ key: 'name', label: 'Wrong' }],
      }).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding({
        ...binding(),
        columns: [{ key: 'name', label: 'Name', type: 'integer' }],
      }).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding({
        ...binding(),
        columns: [{ key: 'name', label: 'Name', type: 'text' }],
      }).ok,
    ).toBe(true);
  });

  it('rejects non-record rows and accessors at the authorization boundary', () => {
    expect(validateAeliqoDataBinding(binding({ rows: [new Map() as never, rows[1]] })).ok).toBe(false);
    let invoked = false;
    const getterRow = { ...rows[0] };
    Object.defineProperty(getterRow, 'amount', {
      enumerable: true,
      get: () => {
        invoked = true;
        return { decimal: '12.50' };
      },
    });
    expect(validateAeliqoDataBinding(binding({ rows: [getterRow as never, rows[1]] })).ok).toBe(false);
    expect(invoked).toBe(false);
  });

  it('keeps counts, coverage and supplied scope metadata mutually consistent', () => {
    expect(
      validateAeliqoDataBinding(
        binding({
          result: result({
            counts: {
              loaded: 2,
              population: {
                kind: 'exact',
                value: 1,
                populationDigest: 'population',
              },
            },
          }),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding(
        binding({
          result: result({
            coverage: { kind: 'complete', populationDigest: 'other' },
          }),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding({
        ...binding(),
        scope: {
          kind: 'population',
          loaded: 2,
          populationTotal: 2,
          populationDigest: 'population',
          evil: 'secret',
        } as never,
      }).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding({
        ...binding(),
        result: result({ coverage: { kind: 'future' } as never }),
      }).ok,
    ).toBe(false);
    expect(
      validateAeliqoDataBinding(
        binding({
          result: result({
            counts: {
              loaded: 2,
              population: {
                kind: 'exact',
                value: 3,
                populationDigest: 'population',
              },
            },
            coverage: { kind: 'complete', populationDigest: 'population' },
          }),
        }),
      ).ok,
    ).toBe(false);
    const partial = validateAeliqoDataBinding(
      binding({
        result: result({
          counts: {
            loaded: 2,
            population: {
              kind: 'exact',
              value: 3,
              populationDigest: 'population',
            },
          },
          coverage: {
            kind: 'partial',
            populationDigest: 'population',
            reason: 'page',
          },
        }),
      }),
    );
    expect(partial.ok).toBe(true);
    if (partial.ok)
      expect(partial.value.scope).toMatchObject({
        kind: 'loaded',
        loaded: 2,
        populationTotal: 3,
      });
    const sample = validateAeliqoDataBinding(
      binding({
        result: result({
          counts: {
            loaded: 2,
            population: {
              kind: 'exact',
              value: 3,
              populationDigest: 'population',
            },
          },
          coverage: { kind: 'sample', populationDigest: 'population', method: 'sample' },
        }),
      }),
    );
    expect(sample.ok).toBe(true);
    if (sample.ok) expect(sample.value.scope.kind).toBe('sample');
  });
});

describe('data registry semantics', () => {
  it('registers all nine data views and only derives fields from the authorized Result', () => {
    expect(registry.manifests).toHaveLength(9);
    for (const component of [
      'metric',
      'delta',
      'keyValue',
      'detail',
      'recordList',
      'cardCollection',
      'table',
      'filterBuilder',
      'selectionSummary',
    ] as const) {
      const config =
        component === 'metric'
          ? { field: 'amount', identityValues: { id: 'a' } }
          : component === 'delta'
            ? {
                currentField: 'amount',
                baselineField: 'baseline',
                identityValues: { id: 'a' },
              }
            : component === 'keyValue'
              ? { items: [{ field: 'name' }], identityValues: { id: 'a' } }
              : component === 'detail'
                ? {
                    fields: ['id', 'name', 'amount'],
                    identityValues: { id: 'a' },
                  }
                : component === 'filterBuilder'
                  ? { field: 'department', outputId: 'people' }
                  : component === 'selectionSummary'
                    ? { selection: 'multiple' }
                    : {
                        columns: [
                          { key: 'id', label: 'ID' },
                          { key: 'name', label: 'Name' },
                        ],
                        selection: 'single',
                      };
      const outcome = resolve(component, config);
      expect(outcome.ok, component).toBe(true);
    }
  });

  it('does not aggregate a metric: multiple rows require explicit stable identity selection', () => {
    expect(resolve('metric', { field: 'amount' }).ok).toBe(false);
    const selected = resolve('metric', {
      field: 'amount',
      identityValues: { id: 'b' },
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value.config.selectedRow?.id).toBe('b');
  });

  it('requires explicit compatible observations for delta and uses the result units', () => {
    expect(
      resolve('delta', {
        currentField: 'amount',
        baselineField: 'name',
        identityValues: { id: 'a' },
      }).ok,
    ).toBe(false);
    expect(
      resolve('delta', {
        currentField: 'amount',
        baselineField: 'baseline',
        mode: 'percentage-point',
        identityValues: { id: 'a' },
      }).ok,
    ).toBe(false);
    const valid = resolve('delta', {
      currentField: 'amount',
      baselineField: 'baseline',
      mode: 'absolute',
      identityValues: { id: 'a' },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.config.delta?.currentRow.id).toBe('a');
    const ratio = resolve(
      'delta',
      {
        currentField: 'currentRate',
        baselineField: 'baselineRate',
        mode: 'percentage-point',
        identityValues: { id: 'a' },
      },
      ratioBinding(),
    );
    expect(ratio.ok).toBe(true);
  });

  it('rejects contradictory aliases and duplicate delta observations', () => {
    expect(
      resolve('delta', {
        currentField: 'amount',
        current: { field: 'baseline' },
        baselineField: 'baseline',
      }).ok,
    ).toBe(false);
    const same = resolve('delta', {
      currentField: 'amount',
      baselineField: 'amount',
      identityValues: { id: 'a' },
    });
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.value.config.fields).toEqual(['amount']);
    const crossRow = resolve('delta', {
      current: { field: 'amount', identityValues: { id: 'a' } },
      baseline: { field: 'amount', identityValues: { id: 'b' } },
    });
    expect(crossRow.ok).toBe(true);
    if (crossRow.ok) {
      expect(crossRow.value.config.fields).toEqual(['amount']);
      expect(crossRow.value.config.delta?.currentRow.id).toBe('a');
      expect(crossRow.value.config.delta?.baselineRow.id).toBe('b');
    }
    expect(
      resolve('metric', {
        field: 'amount',
        identityValues: { id: 'a' },
        rowIdentity: { id: 'b' },
      }).ok,
    ).toBe(false);
    expect(
      resolve('metric', {
        field: 'amount',
        identityValues: { id: 'a' },
        rowIdentity: { id: 'a' },
      }).ok,
    ).toBe(true);
  });

  it('derives detail fields and filter scope labels from authorized metadata', () => {
    const subset = resolve(
      'detail',
      { identityValues: { id: 'a' } },
      binding({ columns: [{ key: 'id', label: 'ID', type: 'text' }] }),
    );
    expect(subset.ok).toBe(true);
    if (subset.ok) {
      expect(subset.value.config.fields).toEqual(['id']);
      expect(subset.value.config.columns.map((column) => column.key)).toEqual(['id']);
    }
    expect(
      resolve(
        'detail',
        { fields: ['name'], identityValues: { id: 'a' } },
        binding({ columns: [{ key: 'id', label: 'ID', type: 'text' }] }),
      ).ok,
    ).toBe(false);
    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        scopeLabel: 'All records are verified',
      }).ok,
    ).toBe(false);
    const filter = resolve('filterBuilder', {
      field: 'department',
      outputId: 'people',
    });
    expect(filter.ok).toBe(true);
    if (filter.ok) expect(filter.value.config.values.scopeLabel).toBe('2 records');
  });

  it('does not allow presentation config to redefine identity or field labels', () => {
    expect(
      resolve('table', {
        identity: ['name'],
        columns: [{ key: 'id', label: 'ID' }],
      }).ok,
    ).toBe(false);
    expect(
      resolve('recordList', {
        columns: [{ key: 'name', label: 'Display name' }],
      }).ok,
    ).toBe(false);
  });

  it('keeps detail columns within its selected fields', () => {
    const selected = resolve('detail', { fields: ['id'], identityValues: { id: 'a' } });
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value.config.columns.map((column) => column.key)).toEqual(['id']);
    expect(
      resolve('detail', {
        fields: ['id'],
        identityValues: { id: 'a' },
        columns: [{ key: 'name', label: 'Name' }],
      }).ok,
    ).toBe(false);
  });

  it('requires a trusted entity before selection can create a selection port', () => {
    const noEntity = createAeliqoDataRegistry();
    expect(noEntity.resolve({ id: 'table', component: 'table', config: { selection: 'single' } }, binding()).ok).toBe(
      false,
    );
    const selected = resolve('table', { selection: 'single' });
    expect(selected.ok).toBe(true);
    if (selected.ok)
      expect(selected.value.config.ports[0]).toMatchObject({
        payload: 'selection',
        entity: 'person',
        identity: ['id'],
      });
  });

  it('accepts typed filter fields and requires exact output identity', () => {
    expect(resolve('filterBuilder', { field: 'amount', outputId: 'people' }).ok).toBe(true);
    expect(resolve('filterBuilder', { field: 'department', outputId: 'other' }).ok).toBe(false);
    const valid = resolve('filterBuilder', {
      field: 'department',
      outputId: 'people',
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.config.ports).toEqual([{ id: 'filter', direction: 'output', payload: 'filter' }]);
    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        inherited: { op: 'not-registered', field: 'department' },
      }).ok,
    ).toBe(false);
    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        inherited: { op: 'is-null', field: 'department', negate: false, extra: true },
      }).ok,
    ).toBe(false);
    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        inherited: { op: 'is-null', field: 'department', negate: false },
      }).ok,
    ).toBe(true);
  });

  it('guards initial filters to the editable canonical predicate subset', () => {
    const compare = {
      op: 'compare' as const,
      field: 'department',
      comparison: 'eq' as const,
      value: 'Sales',
    };
    const notEmpty = {
      op: 'not' as const,
      predicate: { op: 'is-null' as const, field: 'department', negate: false },
    };
    const homogeneous = {
      op: 'and' as const,
      predicates: [
        { op: 'and' as const, predicates: [compare, notEmpty] },
        { op: 'is-null' as const, field: 'department', negate: true },
      ],
    };
    const editable = resolve('filterBuilder', {
      field: 'department',
      outputId: 'people',
      predicate: homogeneous,
    });
    expect(editable.ok).toBe(true);
    if (editable.ok) expect(editable.value.config.values.predicate).toEqual(homogeneous);

    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        predicate: { op: 'or', predicates: [compare, notEmpty] },
      }).ok,
    ).toBe(true);
    const mixed = resolve('filterBuilder', {
      field: 'department',
      outputId: 'people',
      predicate: {
        op: 'and',
        predicates: [{ op: 'or', predicates: [compare, notEmpty] }, compare],
      },
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.diagnostics[0]?.code).toBe('web.data.unsupported');
    expect(
      resolve('filterBuilder', {
        field: 'department',
        outputId: 'people',
        predicate: { op: 'not', predicate: compare },
      }).ok,
    ).toBe(false);
    expect(
      resolve('filterBuilder', {
        field: 'name',
        outputId: 'people',
        predicate: {
          op: 'compare',
          field: 'name',
          comparison: 'eq',
          value: null,
        },
      }).ok,
    ).toBe(false);
    expect(
      resolve('filterBuilder', {
        field: 'name',
        outputId: 'people',
        predicate: {
          op: 'in',
          field: 'name',
          values: [null, 'Ada'],
        },
      }).ok,
    ).toBe(true);

    const inherited = resolve('filterBuilder', {
      field: 'department',
      outputId: 'people',
      inherited: {
        op: 'and',
        predicates: [
          { op: 'or', predicates: [compare, notEmpty] },
          { op: 'not', predicate: compare },
        ],
      },
    });
    expect(inherited.ok).toBe(true);
  });
});
