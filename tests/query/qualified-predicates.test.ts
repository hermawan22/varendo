import { expect, it } from 'vitest';
import { parseContract, type Catalog, type Outcome, type QuerySpec } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
const unwrap = <T>(value: Outcome<T>): T => {
  if (!value.ok) throw new Error(JSON.stringify(value.diagnostics));
  return value.value;
};
const registry = unwrap(createQueryFunctionRegistry());
const relation = { id: 'fact-policy', revision: '1' };
const catalog: Catalog = {
  version: '1',
  revision: 'qualified-predicates',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'facts',
      label: 'Facts',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [{ id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } }],
    },
    {
      id: 'policies',
      label: 'Policies',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'factId', label: 'Fact', role: 'attribute', type: { value: 'text', nullable: false } },
        { id: 'blocked', label: 'Blocked', role: 'attribute', type: { value: 'boolean', nullable: false } },
      ],
    },
  ],
  relationships: [
    {
      ...relation,
      sourceEntity: 'facts',
      targetEntity: 'policies',
      keys: [{ sourceField: 'id', targetField: 'factId' }],
      cardinality: 'one-to-one',
      optional: true,
      joinPolicy: 'validated',
    },
  ],
  meanings: [],
  capabilities: [],
};
const engine = unwrap(createQueryPlanner({ catalog, registry, limits: { maxRows: 10 } }));
const source = {
  revision: 'source',
  relations: {
    facts: { entity: 'facts', complete: true, rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    policies: {
      entity: 'policies',
      complete: true,
      rows: [
        { id: 'policy-a', factId: 'a', blocked: false },
        { id: 'policy-b', factId: 'b', blocked: true },
      ],
    },
  },
};
const query = (where: QuerySpec['where']): QuerySpec => ({
  entity: 'facts',
  fields: ['id'],
  measures: [],
  groupBy: ['id'],
  relations: [relation],
  relationUsage: [{ relation, kind: 'left' }],
  population: { kind: 'all-authorized' },
  order: [],
  ...(where === undefined ? {} : { where }),
});

it('resolves explicit joined predicate entities and preserves the root default', () => {
  const cases: [NonNullable<QuerySpec['where']>, readonly string[]][] = [
    [{ op: 'is-null', entity: 'policies', field: 'blocked', negate: false }, ['c']],
    [{ op: 'compare', entity: 'policies', field: 'blocked', comparison: 'eq', value: false }, ['a']],
    [{ op: 'in', entity: 'policies', field: 'id', values: ['policy-b'] }, ['b']],
    [{ op: 'compare', field: 'id', comparison: 'eq', value: 'a' }, ['a']],
    [
      {
        op: 'or',
        predicates: [
          { op: 'is-null', entity: 'policies', field: 'blocked', negate: false },
          { op: 'compare', entity: 'policies', field: 'blocked', comparison: 'eq', value: false },
        ],
      },
      ['a', 'c'],
    ],
  ];
  for (const [where, expected] of cases) {
    const parsed = unwrap(parseContract('query', query(where)));
    expect(unwrap(engine.evaluate(unwrap(engine.plan(parsed)), source)).rows.map((row) => row.id)).toEqual(expected);
  }
});

it('does not grant an unrelated entity or accept undeclared predicate fields', () => {
  for (const where of [
    { op: 'is-null', entity: 'absent', field: 'id', negate: false },
    { op: 'is-null', entity: 'policies', field: 'secret', negate: false },
  ] as const)
    expect(engine.plan(query(where)).ok).toBe(false);
  const withoutJoin = {
    ...query({ op: 'in', entity: 'policies', field: 'id', values: ['policy-a'] }),
    relations: [],
    relationUsage: [],
  };
  expect(engine.plan(withoutJoin).ok).toBe(false);
  expect(parseContract('query', query({ op: 'is-null', entity: 1, field: 'id', negate: false } as never)).ok).toBe(
    false,
  );
});
