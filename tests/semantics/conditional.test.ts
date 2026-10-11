import { describe, expect, it } from 'vitest';
import { type Catalog, type Expression, type Outcome, type SemanticType } from '../../packages/core/src/index.js';
import {
  checkExpression,
  createFunctionRegistry,
  createQueryFunctionRegistry,
} from '../../packages/core/src/expressions/index.js';
const unwrap = <T>(result: Outcome<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
};
const registry = unwrap(createQueryFunctionRegistry({ version: '2' }));
const catalog: Catalog = {
  version: '1',
  revision: 'conditional-1',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'facts',
      label: 'Facts',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'status', label: 'Status', role: 'attribute', type: { value: 'text', nullable: true } },
        { id: 'condition', label: 'Condition', role: 'attribute', type: { value: 'boolean', nullable: false } },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const literal = (value: Extract<Expression, { kind: 'literal' }>['value'], type: SemanticType): Expression => ({
  kind: 'literal',
  value,
  type,
});
const integer = (value: number | null, extra: Partial<SemanticType> = {}): Expression =>
  literal(value, { value: 'integer', nullable: value === null, ...extra });
const call = (id: string, args: readonly Expression[]): Expression => ({
  kind: 'call',
  function: { id, revision: '1' },
  arguments: args,
});
const field = (ref: string): Expression => ({ kind: 'field', entity: 'facts', ref });
const check = (expression: Expression) => checkExpression(expression, { catalog, registry, entityId: 'facts' });

describe('opt-in conditional query semantics', () => {
  it('preserves the previous registry and explicitly opts into revision two', () => {
    const previous = unwrap(createQueryFunctionRegistry());
    expect(previous.digest).toBe('core-query-1');
    expect(registry.digest).toBe('core-query-2');
    for (const id of ['core.equal', 'core.if']) {
      expect(previous.resolve({ id, revision: '1' })).toBeUndefined();
      expect(registry.resolve({ id, revision: '1' })).toBeDefined();
    }
    for (const signature of previous.signatures) expect(registry.resolve(signature.ref)).toEqual(signature);
    expect(createQueryFunctionRegistry({ version: '3' } as never).ok).toBe(false);
  });
  it('retains row grain and unknown condition while mapping status to numeric branches', () => {
    const equality = call('core.equal', [field('status'), literal('absent', { value: 'text', nullable: false })]);
    expect(unwrap(check(equality)).type).toMatchObject({ value: 'boolean', nullable: true, grain: ['id'] });
    expect(unwrap(check(call('core.if', [equality, integer(1), integer(0)]))).type).toMatchObject({
      value: 'integer',
      nullable: true,
      grain: ['id'],
    });
    expect(unwrap(check(call('core.if', [field('condition'), integer(1), integer(0)]))).type.nullable).toBe(false);
  });
  it('honors explicit null-result metadata on custom host signatures', () => {
    for (const nullResult of ['non-null', 'preserve'] as const) {
      const signature = registry.resolve({ id: 'core.if', revision: '1' })!;
      const custom = unwrap(
        createFunctionRegistry({
          digest: 'custom-conditional',
          signatures: [{ ...signature, ref: { id: 'host.choose', revision: '1' }, nullResult, realization: 'host' }],
        }),
      );
      const result = checkExpression(
        call('host.choose', [literal(null, { value: 'boolean', nullable: true }), integer(1), integer(0)]),
        { catalog: { ...catalog, functionRegistryDigest: custom.digest }, registry: custom, entityId: 'facts' },
      );
      expect(unwrap(result).type.nullable).toBe(false);
    }
  });
  it('allows a typed null branch without losing row grain or nullability', () => {
    expect(unwrap(check(call('core.if', [field('condition'), integer(1), integer(null)]))).type).toMatchObject({
      value: 'integer',
      nullable: true,
      grain: ['id'],
    });
  });
  it('preserves an explicitly nullable host output with nonnullable arguments', () => {
    const signature = registry.resolve({ id: 'core.if', revision: '1' })!;
    const custom = unwrap(
      createFunctionRegistry({
        digest: 'custom-null-output',
        signatures: [
          {
            ...signature,
            ref: { id: 'host.choose', revision: '1' },
            output: { value: 'integer', nullable: true },
            realization: 'host',
          },
        ],
      }),
    );
    const result = checkExpression(
      call('host.choose', [literal(true, { value: 'boolean', nullable: false }), integer(1), integer(0)]),
      { catalog: { ...catalog, functionRegistryDigest: custom.digest }, registry: custom, entityId: 'facts' },
    );
    expect(unwrap(result).type.nullable).toBe(true);
  });
  it('rejects incompatible branch types, units, temporal policies and condition types', () => {
    const date = (timezone: string) =>
      literal('2026-01-01', {
        value: 'date',
        nullable: false,
        temporal: { calendar: 'gregorian', timezone, grain: 'day' },
      });
    for (const args of [
      [integer(1), integer(1), integer(0)],
      [field('condition'), integer(1), literal('one', { value: 'text', nullable: false })],
      [field('condition'), integer(1, { unit: { dimension: 'count', symbol: 'day' } }), integer(0)],
      [field('condition'), date('UTC'), date('Asia/Jakarta')],
      [field('condition'), integer(1, { grain: ['other'] }), integer(0)],
    ])
      expect(check(call('core.if', args)).ok).toBe(false);
  });
  it('rejects incomparable equality units and type families', () => {
    expect(check(call('core.equal', [integer(1), literal('1', { value: 'text', nullable: false })])).ok).toBe(false);
    expect(
      check(call('core.equal', [integer(1, { unit: { dimension: 'count', symbol: 'day' } }), integer(1)])).ok,
    ).toBe(false);
  });
});
