import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import type {
  Catalog,
  Expression,
  FieldDefinition,
  QuerySpec,
  SemanticType,
} from '../../packages/core/src/contracts/types.js';
import type { QueryResult, QueryRow, QuerySource, RelationalQuery } from '../../packages/core/src/query/types.js';

const registryOutcome = createQueryFunctionRegistry();
if (!registryOutcome.ok) throw new Error(JSON.stringify(registryOutcome.diagnostics));
const registry = registryOutcome.value;

type FieldInput = { readonly id: string; readonly type: SemanticType; readonly role: FieldDefinition['role'] };
type EntityInput = {
  readonly id: string;
  readonly identity: readonly string[];
  readonly fields: readonly FieldInput[];
};

const text = (nullable = false): SemanticType => ({ value: 'text', nullable });
const integer = (nullable = false): SemanticType => ({ value: 'integer', nullable });
const decimal = (nullable = false): SemanticType => ({ value: 'decimal', nullable });
const instant = (nullable = false): SemanticType => ({ value: 'instant', nullable });
const date = (nullable = false): SemanticType => ({ value: 'date', nullable });
const field = (entity: string, ref: string): Expression => ({ kind: 'field', entity, ref });
const plainField = (ref: string): Expression => ({ kind: 'field', ref });
const literal = (value: string | { readonly decimal: string }, type: SemanticType): Expression => ({
  kind: 'literal',
  value,
  type,
});
const ref = (id: string) => ({ id, revision: '1' }) as const;

function entity(input: EntityInput): Catalog['entities'][number] {
  const first = input.identity[0];
  if (first === undefined) throw new Error(`Entity ${input.id} needs an identity.`);
  return {
    id: input.id,
    label: input.id,
    identity: [first, ...input.identity.slice(1)],
    rowGrain: [first, ...input.identity.slice(1)],
    fields: input.fields.map((item) => ({ ...item, label: item.id })),
  };
}

function catalog(
  entities: readonly EntityInput[],
  relationships: readonly Catalog['relationships'][number][] = [],
): Catalog {
  return {
    version: '1',
    revision: 'review-regressions',
    functionRegistryDigest: registry.digest,
    entities: entities.map(entity),
    relationships,
    meanings: [],
    capabilities: [],
  };
}

function source(
  catalogValue: Catalog,
  rows: readonly QueryRow[],
  entityId = catalogValue.entities[0]?.id,
): QuerySource {
  if (entityId === undefined) throw new Error('A source needs an entity.');
  return {
    revision: 'review-source',
    catalogRevision: catalogValue.revision,
    relations: { [entityId]: { entity: entityId, complete: true, rows } },
  };
}

function planner(catalogValue: Catalog) {
  const outcome = createQueryPlanner({
    catalog: catalogValue,
    registry,
    limits: {
      maxRows: 10_000,
      maxBytes: 1_000_000,
      maxJoinRows: 10_000,
      maxOperations: 1_000_000,
    },
  });
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
}

function evaluate(
  catalogValue: Catalog,
  query: RelationalQuery | QuerySpec,
  rows: readonly QueryRow[],
  entityId = catalogValue.entities[0]?.id,
): QueryResult {
  const engine = planner(catalogValue);
  const planned = engine.plan(query);
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
  const result = engine.evaluate(planned.value, source(catalogValue, rows, entityId));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function plan(catalogValue: Catalog, query: RelationalQuery | QuerySpec) {
  return planner(catalogValue).plan(query);
}

function standardQuery(root: string, select: RelationalQuery['select']): RelationalQuery {
  return {
    root,
    pins: { catalogRevision: 'review-regressions', functionRegistryDigest: registry.digest },
    select,
  };
}

function equivalentScalarCase(type: SemanticType, first: QueryRow['value'], second: QueryRow['value']) {
  const valueField = type.value === 'decimal' ? 'amount' : 'at';
  const valueRows = [
    { id: 'a', [valueField]: first },
    { id: 'b', [valueField]: second },
  ];
  const valueCatalog = catalog([
    {
      id: 'events',
      identity: ['id'],
      fields: [
        { id: 'id', type: text(), role: 'identity' },
        { id: valueField, type, role: 'attribute' },
      ],
    },
  ]);
  return { valueCatalog, valueField, valueRows };
}

describe('independent query review regressions', () => {
  it.each([
    ['decimal', decimal(), { decimal: '1.00' }, { decimal: '1' }],
    ['instant', instant(), '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00Z'],
  ] as const)('matches equivalent %s values in IN predicates', (_label, type, rowValue, literalValue) => {
    const { valueCatalog, valueField, valueRows } = equivalentScalarCase(type, rowValue, literalValue);
    const predicateExpression: Expression =
      type.value === 'instant'
        ? {
            kind: 'call',
            function: ref('core.coalesce'),
            arguments: [field('events', valueField), literal(literalValue, { ...type, grain: ['["events","id"]'] })],
          }
        : field('events', valueField);
    const query = {
      ...standardQuery('events', [{ id: 'id', expression: field('events', 'id') }]),
      filter: { op: 'in' as const, expression: predicateExpression, values: [literal(literalValue, type)] },
    };
    expect(evaluate(valueCatalog, query, valueRows).rows).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it.each([
    ['decimal', decimal(), [{ decimal: '1.0' }, { decimal: '1.00' }]],
    ['instant', instant(), ['2026-01-01T00:00:00Z', '2025-12-31T19:00:00-05:00']],
  ] as const)('coalesces equivalent %s values for grouping and count-distinct', (_label, type, values) => {
    const valueField = type.value === 'decimal' ? 'amount' : 'at';
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: valueField, type, role: 'attribute' },
          { id: 'value', type: integer(), role: 'measure' },
        ],
      },
    ]);
    const rows = values.map((value, index) => ({ id: String(index), [valueField]: value, value: 1 }));
    const grouping = {
      ...standardQuery('events', [
        { id: 'group', expression: plainField('group') },
        { id: 'n', expression: plainField('n') },
      ]),
      groupBy: [{ id: 'group', expression: field('events', valueField) }],
      aggregates: [{ id: 'n', function: ref('core.aggregate.count'), arguments: [field('events', 'id')] }],
    };
    const grouped = evaluate(valueCatalog, grouping, rows);
    expect(grouped.rows).toHaveLength(1);
    expect(grouped.rows[0]?.n).toBe(2);

    const distinct = {
      ...standardQuery('events', [{ id: 'n', expression: plainField('n') }]),
      aggregates: [
        { id: 'n', function: ref('core.aggregate.count-distinct'), arguments: [field('events', valueField)] },
      ],
    };
    expect(evaluate(valueCatalog, distinct, rows).rows).toEqual([{ n: 1 }]);
  });

  it.each([
    ['decimal', decimal(), [{ amount: { decimal: '1.0' } }, { amount: { decimal: '1.00' } }]],
    ['instant', instant(), [{ at: '2026-01-01T00:00:00Z' }, { at: '2025-12-31T19:00:00-05:00' }]],
  ] as const)('uses equivalent %s values for window partitions', (_label, type, values) => {
    const valueField = type.value === 'decimal' ? 'amount' : 'at';
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: valueField, type, role: 'attribute' },
          { id: 'value', type: integer(), role: 'measure' },
        ],
      },
    ]);
    const rows = values.map((value, index) => ({ id: String.fromCharCode(97 + index), ...value, value: 1 }));
    const query = {
      ...standardQuery('events', [
        { id: 'id', expression: field('events', 'id') },
        { id: 'running', expression: plainField('running') },
      ]),
      windows: [
        {
          id: 'running',
          function: ref('core.window.sum'),
          arguments: [field('events', 'value')],
          partitionBy: [field('events', valueField)],
          orderBy: [{ expression: field('events', 'id'), direction: 'asc' as const, nulls: 'last' as const }],
          frame: { preceding: 1, following: 0 },
        },
      ],
    };
    expect(evaluate(valueCatalog, query, rows).rows.map((row) => row.running)).toEqual([1, 2]);
  });

  it('honors a lag frame with two preceding rows', () => {
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'sequence', type: integer(), role: 'dimension' },
          { id: 'value', type: integer(), role: 'measure' },
        ],
      },
    ]);
    const query = {
      ...standardQuery('events', [
        { id: 'id', expression: field('events', 'id') },
        { id: 'lag', expression: plainField('lag') },
      ]),
      windows: [
        {
          id: 'lag',
          function: ref('core.window.lag'),
          arguments: [field('events', 'value')],
          partitionBy: [],
          orderBy: [
            { expression: field('events', 'sequence'), direction: 'asc' as const, nulls: 'last' as const },
            { expression: field('events', 'id'), direction: 'asc' as const, nulls: 'last' as const },
          ],
          frame: { preceding: 2, following: 0 },
        },
      ],
    };
    expect(
      evaluate(valueCatalog, query, [
        { id: 'a', sequence: 1, value: 10 },
        { id: 'b', sequence: 2, value: 20 },
        { id: 'c', sequence: 3, value: 30 },
      ]).rows.map((row) => row.lag),
    ).toEqual([null, 10, 20]);
  });

  it('converts decimal mean-of-rates inputs to the declared approximate float result', () => {
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'rate', type: decimal(), role: 'measure' },
        ],
      },
    ]);
    const query = {
      ...standardQuery('events', [{ id: 'mean', expression: plainField('mean') }]),
      aggregates: [{ id: 'mean', function: ref('core.mean-of-rates'), arguments: [field('events', 'rate')] }],
    };
    const result = evaluate(valueCatalog, query, [
      { id: 'a', rate: { decimal: '0.2' } },
      { id: 'b', rate: { decimal: '0.4' } },
    ]);
    expect(result.rows[0]?.mean).toBeCloseTo(0.3, 15);
    expect(result.precision.kind).toBe('approximate');
  });

  it('buckets year 0000 and year 0099 without ECMAScript 1900-year coercion', () => {
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'day', type: date(), role: 'time' },
        ],
      },
    ]);
    const bucket = (grain: 'day' | 'week' | 'month' | 'quarter' | 'year', value: string) => {
      const query = {
        ...standardQuery('events', [
          { id: 'id', expression: field('events', 'id') },
          { id: 'bucket', expression: plainField('bucket') },
        ]),
        timeBuckets: [
          {
            id: 'bucket',
            expression: field('events', 'day'),
            grain,
            calendar: 'gregorian' as const,
            timezone: 'UTC' as const,
            weekStartsOn: 1 as const,
          },
        ],
      };
      const outcome = plan(valueCatalog, query);
      if (!outcome.ok) return outcome;
      return planner(valueCatalog).evaluate(outcome.value, source(valueCatalog, [{ id: 'x', day: value }]));
    };
    expect(bucket('day', '0000-01-01')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0000-01-01' }] } });
    expect(bucket('month', '0000-01-01')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0000-01-01' }] } });
    expect(bucket('quarter', '0000-01-01')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0000-01-01' }] } });
    expect(bucket('year', '0000-01-01')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0000-01-01' }] } });
    expect(bucket('week', '0000-01-01')).toMatchObject({ ok: false, diagnostics: [{ code: 'query.temporal-range' }] });
    expect(bucket('day', '0099-12-31')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-12-31' }] } });
    expect(bucket('week', '0099-12-31')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-12-28' }] } });
    expect(bucket('month', '0099-12-31')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-12-01' }] } });
    expect(bucket('quarter', '0099-12-31')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-10-01' }] } });
    expect(bucket('year', '0099-12-31')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-01-01' }] } });
    expect(bucket('week', '0100-01-01')).toMatchObject({ ok: true, value: { rows: [{ bucket: '0099-12-28' }] } });
  });

  it('rejects a source relation whose entity label is forged', () => {
    const valueCatalog = catalog([
      { id: 'left', identity: ['id'], fields: [{ id: 'id', type: text(), role: 'identity' }] },
    ]);
    const query = standardQuery('left', [{ id: 'id', expression: plainField('id') }]);
    const engine = planner(valueCatalog);
    const planned = engine.plan(query);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const forged = engine.evaluate(planned.value, {
      revision: 'review-source',
      catalogRevision: valueCatalog.revision,
      relations: { left: { entity: 'other', complete: true, rows: [{ id: 'from-other' }] } },
    });
    expect(forged).toMatchObject({ ok: false, diagnostics: [{ code: 'query.source-entity' }] });
  });

  it('rejects duplicate left keys for one-to-one left joins', () => {
    const relationship = {
      id: 'right',
      revision: '1',
      sourceEntity: 'left',
      targetEntity: 'right',
      keys: [{ sourceField: 'group', targetField: 'group' }] as [{ sourceField: string; targetField: string }],
      cardinality: 'one-to-one' as const,
      optional: false,
      joinPolicy: 'validated' as const,
    };
    const valueCatalog = catalog(
      [
        {
          id: 'left',
          identity: ['id'],
          fields: [
            { id: 'id', type: text(), role: 'identity' },
            { id: 'group', type: text(), role: 'attribute' },
          ],
        },
        {
          id: 'right',
          identity: ['rid'],
          fields: [
            { id: 'rid', type: text(), role: 'identity' },
            { id: 'group', type: text(), role: 'attribute' },
          ],
        },
      ],
      [relationship],
    );
    const query = {
      ...standardQuery('left', [
        { id: 'id', expression: field('left', 'id') },
        { id: 'rid', expression: field('right', 'rid') },
      ]),
      joins: [{ id: 'right', rightEntity: 'right', relationship: ref('right'), kind: 'left' as const }],
    };
    const engine = planner(valueCatalog);
    const planned = engine.plan(query);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const result = engine.evaluate(planned.value, {
      revision: 'review-source',
      catalogRevision: valueCatalog.revision,
      relations: {
        left: {
          entity: 'left',
          complete: true,
          rows: [
            { id: 'a', group: 'x' },
            { id: 'b', group: 'x' },
          ],
        },
        right: { entity: 'right', complete: true, rows: [{ rid: 'r', group: 'x' }] },
      },
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'query.cardinality' }] });
  });

  it.each([
    ['dimension', { dimension: 'count', symbol: 'n' }, { dimension: 'time', symbol: 's' }],
    ['symbol', { dimension: 'count', symbol: 'n' }, { dimension: 'count', symbol: 'items' }],
  ] as const)('rejects join keys with mismatched unit %s', (_label, leftUnit, rightUnit) => {
    const relationship = {
      id: 'right',
      revision: '1',
      sourceEntity: 'left',
      targetEntity: 'right',
      keys: [{ sourceField: 'id', targetField: 'left_id' }] as [{ sourceField: string; targetField: string }],
      cardinality: 'many-to-one' as const,
      optional: false,
      joinPolicy: 'validated' as const,
    };
    const valueCatalog = catalog(
      [
        {
          id: 'left',
          identity: ['id'],
          fields: [{ id: 'id', type: { value: 'integer', nullable: false, unit: leftUnit }, role: 'identity' }],
        },
        {
          id: 'right',
          identity: ['rid'],
          fields: [
            { id: 'rid', type: text(), role: 'identity' },
            { id: 'left_id', type: { value: 'integer', nullable: false, unit: rightUnit }, role: 'attribute' },
          ],
        },
      ],
      [relationship],
    );
    const query = {
      ...standardQuery('left', [
        { id: 'id', expression: field('left', 'id') },
        { id: 'rid', expression: field('right', 'rid') },
      ]),
      joins: [{ id: 'right', rightEntity: 'right', relationship: ref('right'), kind: 'inner' as const }],
    };
    expect(plan(valueCatalog, query)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.relationship-key-type' }],
    });
  });

  it('retains hidden QuerySpec order fields through sort and top-k', () => {
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'value', type: integer(), role: 'measure' },
        ],
      },
    ]);
    const query: QuerySpec = {
      entity: 'events',
      fields: ['id'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [{ field: 'value', direction: 'desc', nulls: 'last' }],
      topK: 1,
    };
    const engine = planner(valueCatalog);
    const planned = engine.plan(query);
    expect(planned).toMatchObject({ ok: true });
    if (!planned.ok) return;
    expect(planned.value.nodes.map((node) => node.op)).toEqual(['scan', 'sort', 'project', 'top-k']);
    const result = engine.evaluate(
      planned.value,
      source(valueCatalog, [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ]),
    );
    expect(result).toMatchObject({ ok: true, value: { rows: [{ id: 'b' }] } });
    const { topK: _topK, ...unlimited } = query;
    expect(engine.plan({ ...unlimited, page: { size: 1 } })).toMatchObject({ ok: false });
    expect(engine.plan({ ...query, order: [] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.top-k-order' }],
    });
    expect(
      engine.plan({ ...standardQuery('events', [{ id: 'id', expression: plainField('id') }]), topK: 1, orderBy: [] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.top-k-order' }] });
  });

  it('retains wire QuerySpec time buckets and windows when lowering', () => {
    const bucketCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'instant', type: instant(), role: 'time' },
        ],
      },
    ]);
    const bucketQuery: QuerySpec = {
      entity: 'events',
      fields: ['id', 'instant'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      period: {
        from: '2026-01-01T00:00:00Z',
        toExclusive: '2026-02-01T00:00:00Z',
        calendar: 'gregorian',
        timezone: 'UTC',
        interpretation: 'UTC calendar month',
      },
      timeBucket: { field: 'instant', grain: 'month' },
      order: [],
    };
    const bucketEngine = planner(bucketCatalog);
    const bucketPlan = bucketEngine.plan(bucketQuery);
    expect(bucketPlan).toMatchObject({ ok: true });
    if (!bucketPlan.ok) return;
    expect(bucketPlan.value.nodes.map((node) => node.op)).toEqual(['scan', 'filter', 'time-bucket', 'project']);
    const bucketResult = bucketEngine.evaluate(
      bucketPlan.value,
      source(bucketCatalog, [
        { id: 'jan', instant: '2026-01-15T00:00:00Z' },
        { id: 'feb', instant: '2026-02-01T00:00:00Z' },
      ]),
    );
    expect(bucketResult).toMatchObject({ ok: true, value: { rows: [{ id: 'jan', instant: '2026-01-01' }] } });

    const windowCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'partition', type: text(), role: 'dimension' },
          { id: 'value', type: integer(), role: 'measure' },
        ],
      },
    ]);
    const windowQuery: QuerySpec = {
      entity: 'events',
      fields: ['id', 'running'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      windows: [
        {
          id: 'running',
          function: ref('core.window.sum'),
          arguments: [field('events', 'value')],
          partitionBy: [field('events', 'partition')],
          orderBy: [{ expression: field('events', 'id'), direction: 'asc', nulls: 'last' }],
          frame: { preceding: 1, following: 0 },
        },
      ],
      order: [],
    };
    const windowEngine = planner(windowCatalog);
    const windowPlan = windowEngine.plan(windowQuery);
    expect(windowPlan).toMatchObject({ ok: true });
    if (!windowPlan.ok) return;
    expect(windowPlan.value.nodes.map((node) => node.op)).toEqual(['scan', 'window', 'project']);
    const windowResult = windowEngine.evaluate(
      windowPlan.value,
      source(windowCatalog, [
        { id: 'a', partition: 'p', value: 1 },
        { id: 'b', partition: 'p', value: 2 },
      ]),
    );
    expect(windowResult).toMatchObject({
      ok: true,
      value: {
        rows: [
          { id: 'a', running: 1 },
          { id: 'b', running: 3 },
        ],
      },
    });
  });

  it('marks float sums approximate instead of claiming exact precision', () => {
    const valueCatalog = catalog([
      {
        id: 'events',
        identity: ['id'],
        fields: [
          { id: 'id', type: text(), role: 'identity' },
          { id: 'value', type: { value: 'float', nullable: false }, role: 'measure' },
        ],
      },
    ]);
    const query = {
      ...standardQuery('events', [{ id: 'sum', expression: plainField('sum') }]),
      aggregates: [{ id: 'sum', function: ref('core.aggregate.sum'), arguments: [field('events', 'value')] }],
    };
    const result = evaluate(valueCatalog, query, [
      { id: 'a', value: 0.1 },
      { id: 'b', value: 0.2 },
    ]);
    expect(result.rows).toEqual([{ sum: 0.30000000000000004 }]);
    expect(result.precision.kind).toBe('approximate');
  });
});
