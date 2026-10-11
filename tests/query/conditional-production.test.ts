import { describe, expect, it } from 'vitest';
import {
  createFunctionRegistry,
  createQueryFunctionRegistry,
  queryFunctionSignaturesV2,
} from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import type {
  Catalog,
  Expression,
  Outcome,
  QueryRow,
  QuerySource,
  RelationalQuery,
  SemanticType,
} from '../../packages/core/src/query/types.js';

const unwrap = <T>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
};

const registry = unwrap(createQueryFunctionRegistry({ version: '2' }));
const ref = (id: string) => ({ id, revision: '1' }) as const;
const factGrain = [JSON.stringify(['facts', 'id'])];
const field = (name: string): Expression => ({ kind: 'field', entity: 'facts', ref: name });
const literal = (value: Extract<Expression, { kind: 'literal' }>['value'], type: SemanticType): Expression => ({
  kind: 'literal',
  value,
  type,
});
const call = (id: string, arguments_: readonly Expression[]): Expression => ({
  kind: 'call',
  function: ref(id),
  arguments: arguments_,
});
const integer = (value: number | null): Expression => literal(value, { value: 'integer', nullable: value === null });
const float = (value: number | null): Expression => literal(value, { value: 'float', nullable: value === null });
const boolean = (value: boolean | null): Expression => literal(value, { value: 'boolean', nullable: value === null });
const decimal = (value: string | null, grain?: readonly string[]): Expression =>
  literal(value === null ? null : { decimal: value }, {
    value: 'decimal',
    nullable: value === null,
    ...(grain === undefined ? {} : { grain: [...grain] }),
  });
const instant = (value: string | null): Expression => literal(value, { value: 'instant', nullable: value === null });

const catalog: Catalog = {
  version: '1',
  revision: 'conditional-production',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'facts',
      label: 'Facts',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'condition', label: 'Condition', role: 'attribute', type: { value: 'boolean', nullable: true } },
        { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'decimal', nullable: true } },
        { id: 'at', label: 'At', role: 'time', type: { value: 'instant', nullable: true } },
        { id: 'group', label: 'Group', role: 'attribute', type: { value: 'text', nullable: false } },
        { id: 'value', label: 'Value', role: 'measure', type: { value: 'integer', nullable: true } },
        { id: 'numerator', label: 'Numerator', role: 'measure', type: { value: 'integer', nullable: false } },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

const source: QuerySource = {
  revision: 'conditional-source',
  catalogRevision: catalog.revision,
  relations: {
    facts: {
      entity: 'facts',
      complete: true,
      rows: [
        {
          id: 'a',
          condition: false,
          amount: { decimal: '1.00' },
          at: '2026-01-01T00:00:00Z',
          group: 'A',
          value: null,
          numerator: 1,
        },
        {
          id: 'b',
          condition: true,
          amount: { decimal: '1.01' },
          at: '2025-12-31T19:00:00-05:00',
          group: 'B',
          value: 4,
          numerator: 1,
        },
        { id: 'c', condition: null, amount: null, at: null, group: 'B', value: null, numerator: 1 },
      ],
    },
  },
};

const pins = { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest };
const plannerFor = (catalogValue: Catalog = catalog, registryValue = registry) =>
  unwrap(createQueryPlanner({ catalog: catalogValue, registry: registryValue }));

function projectionQuery(
  select: readonly RelationalQuery['select'][number][],
  extra: Partial<RelationalQuery> = {},
): RelationalQuery {
  return { root: 'facts', pins, select, ...extra };
}

describe('production conditional query evaluator', () => {
  it('executes typed equality for exact decimals, equivalent instants, nulls and coalesce values', () => {
    const query = projectionQuery([
      { id: 'id', expression: field('id') },
      { id: 'decimalEqual', expression: call('core.equal', [field('amount'), decimal('1')]) },
      { id: 'instantEqual', expression: call('core.equal', [field('at'), instant('2025-12-31T19:00:00-05:00')]) },
      { id: 'nullEqual', expression: call('core.equal', [field('amount'), decimal(null, factGrain)]) },
      {
        id: 'coalescedEqual',
        expression: call('core.equal', [
          call('core.coalesce', [field('amount'), decimal('1', factGrain)]),
          decimal('1.00'),
        ]),
      },
    ]);
    const planner = plannerFor();
    const plan = unwrap(planner.plan(query));
    const result = unwrap(planner.evaluate(plan, source));
    expect(result.rows).toEqual([
      { id: 'a', decimalEqual: true, instantEqual: true, nullEqual: null, coalescedEqual: true },
      { id: 'b', decimalEqual: false, instantEqual: true, nullEqual: null, coalescedEqual: false },
      { id: 'c', decimalEqual: null, instantEqual: null, nullEqual: null, coalescedEqual: true },
    ]);
  });

  it('evaluates only the selected conditional branch and charges only executed operators', () => {
    const divideByZero = call('core.divide.error', [field('numerator'), integer(0)]);
    const chooseError = call('core.if', [boolean(false), divideByZero, float(7)]);
    const query = projectionQuery([
      { id: 'id', expression: field('id') },
      { id: 'chosen', expression: chooseError },
    ]);
    const planner = plannerFor();
    const plan = unwrap(planner.plan(query));
    // Two plan nodes, and 14 operations per row including source validation,
    // projection and the four expression nodes actually evaluated.
    const result = planner.evaluate(plan, source, { maxOperations: 44 });
    expect(planner.evaluate(plan, source, { maxOperations: 43 }).ok).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows.map((row) => row.chosen)).toEqual([7, 7, 7]);
      expect(result.value.precision.kind).toBe('exact');
    }
  });

  it('returns null for an unknown condition and does not evaluate either branch', () => {
    const query = projectionQuery([
      { id: 'id', expression: field('id') },
      {
        id: 'chosen',
        expression: call('core.if', [
          field('condition'),
          call('core.divide.error', [field('numerator'), integer(0)]),
          call('core.divide.error', [field('numerator'), integer(0)]),
        ]),
      },
    ]);
    const planner = plannerFor();
    const plan = unwrap(planner.plan(query));
    const unknownSource: QuerySource = {
      ...source,
      relations: { facts: { ...source.relations.facts!, rows: [source.relations.facts!.rows[2]!] } },
    };
    // The null condition skips both branches, including their literal nodes.
    const result = planner.evaluate(plan, unknownSource, { maxOperations: 15 });
    expect(planner.evaluate(plan, unknownSource, { maxOperations: 14 }).ok).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows.map((row) => row.chosen)).toEqual([null]);
  });

  it('supports scalar literal branches over groups while retaining field rejection', () => {
    const countValue = call('core.aggregate.count', [field('value')]);
    const noKnownValue = call('core.equal', [countValue, integer(0)]);
    const query = projectionQuery(
      [
        { id: 'group', expression: field('group') },
        { id: 'rate', expression: { kind: 'field', ref: 'rate' } },
      ],
      {
        groupBy: [{ id: 'group', expression: field('group') }],
        aggregates: [{ id: 'rate', function: ref('core.if'), arguments: [noKnownValue, integer(0), integer(null)] }],
      },
    );
    const planner = plannerFor();
    const plan = unwrap(planner.plan(query));
    const result = unwrap(planner.evaluate(plan, source));
    expect(result.rows).toEqual([
      { group: 'A', rate: 0 },
      { group: 'B', rate: null },
    ]);

    const invalid = projectionQuery(
      [
        { id: 'group', expression: field('group') },
        { id: 'rate', expression: { kind: 'field', ref: 'rate' } },
      ],
      {
        groupBy: [{ id: 'group', expression: field('group') }],
        aggregates: [
          { id: 'rate', function: ref('core.if'), arguments: [noKnownValue, field('value'), integer(null)] },
        ],
      },
    );
    const invalidPlan = planner.plan(invalid);
    expect(invalidPlan.ok).toBe(false);
    if (!invalidPlan.ok) expect(invalidPlan.diagnostics[0]?.code).toBe('semantic.grain-mismatch');
  });

  it('requires the opt-in registry and rejects redefined trusted conditionals', () => {
    const oldRegistry = unwrap(createQueryFunctionRegistry());
    const oldCatalog = { ...catalog, functionRegistryDigest: oldRegistry.digest };
    const equalQuery = projectionQuery([
      { id: 'id', expression: field('id') },
      { id: 'same', expression: call('core.equal', [field('amount'), decimal('1')]) },
    ]);
    const oldPlanner = plannerFor(oldCatalog, oldRegistry);
    expect(oldPlanner.plan({ ...equalQuery, pins: { ...pins, functionRegistryDigest: oldRegistry.digest } }).ok).toBe(
      false,
    );

    const redefined = unwrap(
      createFunctionRegistry({
        digest: 'redefined-query-2',
        signatures: queryFunctionSignaturesV2.map((signature) =>
          signature.ref.id === 'core.if' ? { ...signature, operation: 'other' as const } : signature,
        ),
      }),
    );
    const redefinedCatalog = { ...catalog, functionRegistryDigest: redefined.digest };
    const conditional = projectionQuery(
      [
        { id: 'id', expression: field('id') },
        { id: 'chosen', expression: call('core.if', [boolean(true), integer(1), integer(0)]) },
      ],
      { pins: { ...pins, functionRegistryDigest: redefined.digest } },
    );
    const redefinedPlanner = plannerFor(redefinedCatalog, redefined);
    const plan = unwrap(redefinedPlanner.plan(conditional));
    const result = redefinedPlanner.evaluate(plan, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('query.unsupported');
  });
});
