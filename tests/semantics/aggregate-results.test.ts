import { expect, it } from 'vitest';
import { type Catalog, type Expression, type Outcome } from '../../packages/core/src/index.js';
import { checkExpression, createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
const unwrap = <T>(result: Outcome<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
};
const registry = unwrap(createQueryFunctionRegistry({ version: '2' }));
const catalog: Catalog = {
  version: '1',
  revision: 'aggregate-types',
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
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const field = (ref: string): Expression => ({ kind: 'field', entity: 'facts', ref });
const call = (id: string, args: readonly Expression[]): Expression => ({
  kind: 'call',
  function: { id, revision: '1' },
  arguments: args,
});
const check = (expression: Expression, evaluationContext: 'group' | 'window' = 'group') =>
  unwrap(checkExpression(expression, { catalog, registry, entityId: 'facts', evaluationContext })).type;

it('combines aggregates at group grain instead of mixing source and group rows', () => {
  const sum = call('core.aggregate.sum', [field('value')]);
  const count = call('core.aggregate.count', [field('id')]);
  expect(check(sum)).toMatchObject({ value: 'integer', nullable: true, grain: [] });
  expect(check(count)).toMatchObject({ value: 'integer', nullable: false, grain: [] });
  expect(check(call('core.divide.null', [sum, count]))).toMatchObject({ value: 'float', nullable: true, grain: [] });
});

it('keeps window sums at the input row grain', () => {
  expect(check(call('core.window.sum', [field('value')]), 'window')).toMatchObject({
    value: 'integer',
    nullable: false,
    grain: ['id'],
  });
});

it('declares decimal division as a fractional float with possible zero-denominator null', () => {
  const decimal = (value: string): Expression => ({
    kind: 'literal',
    value: { decimal: value },
    type: { value: 'decimal', nullable: false },
  });
  expect(check(call('core.divide.null', [decimal('1'), decimal('3')]))).toMatchObject({
    value: 'float',
    nullable: true,
  });
  expect(check(call('core.add', [decimal('1'), decimal('3')]))).toMatchObject({ value: 'decimal', nullable: false });
});
