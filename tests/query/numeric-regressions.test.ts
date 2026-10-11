import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import type { Catalog, Expression, Outcome } from '../../packages/core/src/contracts/types.js';
import type { QueryResult, QuerySource, RelationalQuery } from '../../packages/core/src/query/types.js';

const unwrap = <T>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
};

const registry = unwrap(createQueryFunctionRegistry());
const ref = (id: string) => ({ id, revision: '1' }) as const;
const field = (name: string): Expression => ({ kind: 'field', entity: 'facts', ref: name });
const literal = (value: number, valueType: 'integer' | 'float'): Expression => ({
  kind: 'literal',
  value,
  type: { value: valueType, nullable: false },
});
const decimalLiteral = (value: string): Expression => ({
  kind: 'literal',
  value: { decimal: value },
  type: { value: 'decimal', nullable: false },
});
const call = (id: string, arguments_: readonly Expression[]): Expression => ({
  kind: 'call',
  function: ref(id),
  arguments: arguments_,
});

const catalog: Catalog = {
  version: '1',
  revision: 'numeric-regressions',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'facts',
      label: 'Facts',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'value', label: 'Value', role: 'measure', type: { value: 'integer', nullable: false } },
        { id: 'numerator', label: 'Numerator', role: 'measure', type: { value: 'integer', nullable: true } },
        { id: 'denominator', label: 'Denominator', role: 'measure', type: { value: 'integer', nullable: true } },
        { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'decimal', nullable: false } },
        { id: 'floatValue', label: 'Float value', role: 'measure', type: { value: 'float', nullable: false } },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

const pins = { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest };
const source = (rows: QuerySource['relations']['facts']['rows']): QuerySource => ({
  revision: 'numeric-source',
  catalogRevision: catalog.revision,
  relations: { facts: { entity: 'facts', complete: true, rows } },
});
const planner = unwrap(
  createQueryPlanner({
    catalog,
    registry,
    limits: {
      maxRows: 100,
      maxBytes: 1_000_000,
      maxJoinRows: 100,
      maxOperations: 100_000,
    },
  }),
);

function evaluate(
  query: RelationalQuery,
  rows: QuerySource['relations']['facts']['rows'],
): QueryResult | ReturnType<typeof planner.evaluate> {
  const plan = unwrap(planner.plan(query));
  return planner.evaluate(plan, source(rows));
}

function projectionQuery(
  select: readonly RelationalQuery['select'][number][],
  extra: Partial<RelationalQuery> = {},
): RelationalQuery {
  return { root: 'facts', pins, select, ...extra };
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// The integer rows are all individually valid source scalars. The aggregate is
// exact because the mathematical cancellation returns a safe integer.
describe('query numeric exactness', () => {
  it('accumulates integer sums exactly through cancellation', () => {
    const query = projectionQuery([{ id: 'total', expression: { kind: 'field', ref: 'total' } }], {
      aggregates: [{ id: 'total', function: ref('core.aggregate.sum'), arguments: [field('value')] }],
    });
    const result = evaluate(query, [
      { id: 'a', value: MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
      { id: 'b', value: 2, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
      { id: 'c', value: -MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({ ok: true, value: { rows: [{ total: 2 }], precision: { kind: 'exact' } } });
  });

  it('rejects unsafe integer intermediates instead of allowing cancellation to hide rounding', () => {
    const query = projectionQuery(
      [
        { id: 'id', expression: field('id') },
        { id: 'result', expression: { kind: 'field', ref: 'result' } },
      ],
      {
        derives: [
          {
            id: 'result',
            expression: call('core.subtract', [
              call('core.add', [field('value'), literal(2, 'integer')]),
              literal(MAX_SAFE, 'integer'),
            ]),
          },
        ],
      },
    );
    const result = evaluate(query, [
      { id: 'a', value: MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'query.numeric-overflow' }] });
  });

  it('rejects an oversized integer aggregate before an outer subtraction can hide it', () => {
    const query = projectionQuery([{ id: 'result', expression: { kind: 'field', ref: 'result' } }], {
      aggregates: [
        {
          id: 'result',
          function: ref('core.subtract'),
          arguments: [call('core.aggregate.sum', [field('value')]), literal(MAX_SAFE, 'integer')],
        },
      ],
    });
    const result = evaluate(query, [
      { id: 'a', value: MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
      { id: 'b', value: 2, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'query.numeric-overflow' }] });
  });

  it('promotes decimal and integer arithmetic exactly in either operand order', () => {
    const query = projectionQuery(
      [
        { id: 'id', expression: field('id') },
        { id: 'decimalPlusInteger', expression: { kind: 'field', ref: 'decimalPlusInteger' } },
        { id: 'integerPlusDecimal', expression: { kind: 'field', ref: 'integerPlusDecimal' } },
        { id: 'decimalMinusInteger', expression: { kind: 'field', ref: 'decimalMinusInteger' } },
        { id: 'integerMinusDecimal', expression: { kind: 'field', ref: 'integerMinusDecimal' } },
      ],
      {
        derives: [
          { id: 'decimalPlusInteger', expression: call('core.add', [field('amount'), literal(2, 'integer')]) },
          { id: 'integerPlusDecimal', expression: call('core.add', [literal(2, 'integer'), field('amount')]) },
          { id: 'decimalMinusInteger', expression: call('core.subtract', [field('amount'), literal(2, 'integer')]) },
          { id: 'integerMinusDecimal', expression: call('core.subtract', [literal(2, 'integer'), field('amount')]) },
        ],
      },
    );
    const result = evaluate(query, [
      { id: 'a', value: 0, amount: { decimal: '1.25' }, floatValue: 0, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        rows: [
          {
            decimalPlusInteger: { decimal: '3.25' },
            integerPlusDecimal: { decimal: '3.25' },
            decimalMinusInteger: { decimal: '-0.75' },
            integerMinusDecimal: { decimal: '0.75' },
          },
        ],
        precision: { kind: 'exact' },
      },
    });
  });

  it('retains approximate behavior for declared float arithmetic', () => {
    const query = projectionQuery(
      [
        { id: 'id', expression: field('id') },
        { id: 'sum', expression: { kind: 'field', ref: 'sum' } },
      ],
      {
        derives: [{ id: 'sum', expression: call('core.add', [field('floatValue'), literal(0.2, 'float')]) }],
      },
    );
    const result = evaluate(query, [
      { id: 'a', value: 0, amount: { decimal: '0' }, floatValue: 0.1, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: { rows: [{ id: 'a', sum: 0.30000000000000004 }], precision: { kind: 'approximate' } },
    });
  });

  it('keeps window integer cancellation exact when each frame result is safe', () => {
    const query = projectionQuery(
      [
        { id: 'id', expression: field('id') },
        { id: 'windowSum', expression: { kind: 'field', ref: 'windowSum' } },
      ],
      {
        windows: [
          {
            id: 'windowSum',
            function: ref('core.window.sum'),
            arguments: [field('value')],
            partitionBy: [],
            orderBy: [{ expression: field('id'), direction: 'asc', nulls: 'last' }],
            frame: { preceding: 0, following: 2 },
          },
        ],
      },
    );
    const result = evaluate(query, [
      { id: 'a', value: MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
      { id: 'b', value: 2, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
      { id: 'c', value: -MAX_SAFE, amount: { decimal: '0' }, floatValue: 0, numerator: 0, denominator: 0 },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        rows: [
          { id: 'a', windowSum: 2 },
          { id: 'b', windowSum: -9007199254740989 },
          { id: 'c', windowSum: -9007199254740991 },
        ],
        precision: { kind: 'exact' },
      },
    });
  });

  it('accumulates wide integer ratio inputs exactly before documented float division', () => {
    const query = projectionQuery([{ id: 'ratio', expression: { kind: 'field', ref: 'ratio' } }], {
      aggregates: [
        { id: 'ratio', function: ref('core.ratio-of-sums'), arguments: [field('numerator'), field('denominator')] },
      ],
    });
    const result = evaluate(query, [
      { id: 'a', value: 0, amount: { decimal: '0' }, floatValue: 0, numerator: MAX_SAFE, denominator: 1 },
      { id: 'b', value: 0, amount: { decimal: '0' }, floatValue: 0, numerator: 2, denominator: 0 },
      { id: 'c', value: 0, amount: { decimal: '0' }, floatValue: 0, numerator: 2, denominator: 0 },
    ]);
    // Exact integer total is 2^53+3; conversion to the declared approximate
    // ratio output rounds that value to the nearest representable float.
    expect(result).toMatchObject({
      ok: true,
      value: { rows: [{ ratio: 9007199254740996 }], precision: { kind: 'approximate' } },
    });
  });
});
