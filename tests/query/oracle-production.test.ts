import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import { createTypedAuthoring } from '../../packages/core/src/expressions/builder.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import type {
  Catalog,
  Expression,
  FieldDefinition,
  MeaningDefinition,
  QuerySpec,
  SemanticType,
} from '../../packages/core/src/contracts/types.js';
import type {
  QueryResult,
  QueryRow,
  QuerySource,
  RelationalQuery,
  TimeBucketSpec,
} from '../../packages/core/src/query/types.js';

const registryOutcome = createQueryFunctionRegistry();
if (!registryOutcome.ok) throw new Error('query registry fixture failed');
const registry = registryOutcome.value;

type OracleCases = {
  seededFanout: { eligibleEmployeeIndexes: readonly number[] };
  ratioOfSums: { groups: readonly { id: string; numerator: number; denominator: number }[] };
  emptyUnknown: {
    groups: Readonly<Record<string, readonly { numerator: number | null; denominator: number | null }[]>>;
  };
  exactArithmetic: { decimalValues: readonly string[]; integerValues: readonly number[]; unsafeIntegerInput: string };
  ranking: {
    observations: readonly { employee: string; week: string; numerator: number; denominator: number }[];
    partialPage: readonly { employee: string; score: number }[];
  };
  incompleteAndAdversarial: {
    relations: readonly { employee: string; team: string }[];
    events: readonly { id: string; instant: string }[];
  };
  timeBuckets: { instants: readonly { id: string; instant: string }[] };
  windows: {
    rows: readonly { id: string; partition: string; sequence: number; score: number; value: number | null }[];
  };
};
type OracleExpected = {
  seededFanout: { eligibleEmployees: readonly string[] };
  ratioOfSums: { ratioOfSums: string };
  emptyUnknown: {
    empty: { rate: string | null };
    missingNumerator: { rate: string | null };
    zeroDenominator: { rate: string | null };
    zeroValid: { rate: string };
  };
  exactArithmetic: {
    decimalTotal: string;
    integerTotal: string;
    safeIntegerMaximum: number;
    unsafeIntegerInput: { state: string };
  };
  ranking: { fixedTopK: readonly string[]; fullTop: string };
  incompleteAndAdversarial: { halfOpenPeriod: { included: readonly string[]; excluded: readonly string[] } };
  timeBuckets: {
    instants: readonly {
      id: string;
      day: string;
      month: string;
      quarter: string;
      week: string;
      year: string;
      utc: string;
    }[];
  };
  windows: { rows: readonly { id: string; sum: number | null; lag: number | null; rank: number }[] };
};
const readOracle = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./oracle/${name}`, import.meta.url), 'utf8')) as T;
const oracleCases = readOracle<OracleCases>('cases.json');
const oracleExpected = readOracle<OracleExpected>('expected.json');
const fractionNumber = (value: string): number => {
  const parts = value.split('/').map(Number);
  const numerator = parts[0] ?? Number.NaN;
  const denominator = parts[1];
  return denominator === undefined ? numerator : numerator / denominator;
};

type FieldInput = { id: string; type: SemanticType; role: FieldDefinition['role']; label?: string };
function nonEmpty(values: readonly string[]): [string, ...string[]] {
  if (values.length === 0) throw new Error('catalog identity cannot be empty');
  return [values[0]!, ...values.slice(1)];
}

function catalogFor(
  entity: string,
  fields: readonly FieldInput[],
  identity: readonly string[],
  relationships: Catalog['relationships'] = [],
  extraEntities: Catalog['entities'] = [],
): Catalog {
  return {
    version: '1',
    revision: 'catalog-query-oracle',
    functionRegistryDigest: registry.digest,
    entities: [
      {
        id: entity,
        label: entity,
        identity: nonEmpty(identity),
        rowGrain: nonEmpty(identity),
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label ?? field.id,
          type: field.type,
          role: field.role,
        })),
      },
      ...extraEntities,
    ],
    relationships,
    meanings: [],
    capabilities: [],
  };
}

function field(entity: string, ref: string): Expression {
  return { kind: 'field', entity, ref };
}
function plainField(ref: string): Expression {
  return { kind: 'field', ref };
}
function literal(value: string | number | boolean | null, type: SemanticType): Expression {
  return { kind: 'literal', value, type };
}
function plannerFor(catalog: Catalog) {
  const outcome = createQueryPlanner({ catalog, registry });
  if (!outcome.ok) throw new Error(outcome.diagnostics.map((diagnostic) => diagnostic.code).join(', '));
  return outcome.value;
}

function execute(catalog: Catalog, query: RelationalQuery, relations: QuerySource['relations']): QueryResult {
  const planner = plannerFor(catalog);
  const planned = planner.plan(query);
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
  const evaluated = planner.evaluate(planned.value, { revision: 'source-query-oracle', relations });
  if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
  return evaluated.value;
}

function queryBase(
  root: string,
  pins = { catalogRevision: 'catalog-query-oracle', functionRegistryDigest: registry.digest },
): RelationalQuery {
  return { root, select: [], pins };
}

const int = (nullable = false): SemanticType => ({ value: 'integer', nullable });
const text = (nullable = false): SemanticType => ({ value: 'text', nullable });
const decimal = (nullable = false): SemanticType => ({ value: 'decimal', nullable });

describe('production query engine against the independent oracle', () => {
  it('evaluates an exact decimal aggregate and pooled ratio', () => {
    const ratioCatalog = catalogFor(
      'metrics',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'group', type: text(), role: 'dimension' },
        { id: 'numerator', type: int(), role: 'measure' },
        { id: 'denominator', type: int(), role: 'measure' },
      ],
      ['id'],
    );
    const ratioQuery: RelationalQuery = {
      ...queryBase('metrics'),
      select: [
        { id: 'group', expression: field('metrics', 'group') },
        { id: 'ratio', expression: plainField('ratio') },
      ],
      groupBy: [{ id: 'group', expression: field('metrics', 'group') }],
      aggregates: [
        {
          id: 'ratio',
          function: { id: 'core.ratio-of-sums', revision: '1' },
          arguments: [field('metrics', 'numerator'), field('metrics', 'denominator')],
        },
      ],
    };
    const debugPlan = plannerFor(ratioCatalog).plan(ratioQuery);
    expect(debugPlan.ok).toBe(true);
    const ratio = execute(ratioCatalog, ratioQuery, {
      metrics: {
        entity: 'metrics',
        complete: true,
        rows: oracleCases.ratioOfSums.groups.map((group, index) => ({
          id: `r${index}`,
          group: 'all',
          numerator: group.numerator,
          denominator: group.denominator,
        })),
      },
    });
    expect(ratio.rows).toEqual([{ group: 'all', ratio: expect.anything() }]);
    const actual = ratio.rows[0]?.ratio;
    const numeric =
      typeof actual === 'number'
        ? actual
        : actual !== null && typeof actual === 'object' && 'decimal' in actual
          ? Number(actual.decimal)
          : NaN;
    expect(numeric).toBeCloseTo(fractionNumber(oracleExpected.ratioOfSums.ratioOfSums), 12);
    expect(numeric).not.toBeCloseTo(1 / 2, 12);

    const decimalCatalog = catalogFor(
      'decimalRows',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'amount', type: decimal(), role: 'measure' },
      ],
      ['id'],
    );
    const decimalQuery: RelationalQuery = {
      ...queryBase('decimalRows'),
      select: [{ id: 'total', expression: plainField('total') }],
      aggregates: [
        {
          id: 'total',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [field('decimalRows', 'amount')],
        },
      ],
    };
    const total = execute(decimalCatalog, decimalQuery, {
      decimalRows: {
        entity: 'decimalRows',
        complete: true,
        rows: oracleCases.exactArithmetic.decimalValues.map((value, index) => ({
          id: `d${index}`,
          amount: { decimal: value },
        })),
      },
    });
    expect(total.rows).toEqual([{ total: { decimal: oracleExpected.exactArithmetic.decimalTotal } }]);
    expect(total.precision).toEqual({ kind: 'exact' });
  });

  it('uses an identity-preserving semijoin and rejects a fanout join', () => {
    const relationship = {
      id: 'employee-orders',
      revision: '1',
      sourceEntity: 'employees',
      targetEntity: 'orders',
      keys: [{ sourceField: 'id', targetField: 'employeeId' }],
      cardinality: 'one-to-many',
      optional: false,
      joinPolicy: 'validated',
    } as const;
    const employeeFields: FieldInput[] = [{ id: 'id', type: text(), role: 'identity' }];
    const orderFields: FieldInput[] = [
      { id: 'orderId', type: text(), role: 'identity' },
      { id: 'employeeId', type: text(), role: 'attribute' },
      { id: 'amount', type: int(), role: 'measure' },
    ];
    const ordersEntity: Catalog['entities'][number] = {
      id: 'orders',
      label: 'orders',
      identity: ['orderId'],
      rowGrain: ['orderId'],
      fields: orderFields.map((item) => ({
        id: item.id,
        label: item.label ?? item.id,
        type: item.type,
        role: item.role,
      })),
    };
    const catalog = catalogFor('employees', employeeFields, ['id'], [relationship], [ordersEntity]);
    const query: RelationalQuery = {
      ...queryBase('employees'),
      select: [{ id: 'id', expression: field('employees', 'id') }],
      semiJoins: [
        {
          id: 'has-order',
          rightEntity: 'orders',
          relationship: { id: relationship.id, revision: relationship.revision },
        },
      ],
    };
    const eligibleEmployees = oracleCases.seededFanout.eligibleEmployeeIndexes.map((index) => `e${index}`);
    expect(eligibleEmployees).toEqual(oracleExpected.seededFanout.eligibleEmployees);
    const result = execute(catalog, query, {
      employees: {
        entity: 'employees',
        complete: true,
        rows: Array.from({ length: 5 }, (_, index) => ({ id: `e${index}` })),
      },
      orders: {
        entity: 'orders',
        complete: true,
        rows: eligibleEmployees.flatMap((employee, employeeIndex) => [
          { orderId: `o${employeeIndex}a`, employeeId: employee, amount: 10 },
          { orderId: `o${employeeIndex}b`, employeeId: employee, amount: 20 },
        ]),
      },
    });
    expect(result.rows.map((row) => row.id)).toEqual(oracleExpected.seededFanout.eligibleEmployees);
    expect(result.rows).toHaveLength(oracleExpected.seededFanout.eligibleEmployees.length);

    const regularJoin: RelationalQuery = {
      ...query,
      semiJoins: [],
      joins: [
        {
          id: 'fanout',
          rightEntity: 'orders',
          relationship: { id: relationship.id, revision: relationship.revision },
          kind: 'inner',
        },
      ],
    };
    const planned = plannerFor(catalog).plan(regularJoin);
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.diagnostics[0]?.code).toBe('query.unsupported');
  });

  it('preserves empty, unknown and valid-zero ratio states', () => {
    const catalog = catalogFor(
      'rates',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'group', type: text(), role: 'dimension' },
        { id: 'numerator', type: int(true), role: 'measure' },
        { id: 'denominator', type: int(true), role: 'measure' },
      ],
      ['id'],
    );
    const query: RelationalQuery = {
      ...queryBase('rates'),
      select: [
        { id: 'group', expression: field('rates', 'group') },
        { id: 'rate', expression: plainField('rate') },
      ],
      groupBy: [{ id: 'group', expression: field('rates', 'group') }],
      aggregates: [
        {
          id: 'rate',
          function: { id: 'core.ratio-of-sums', revision: '1' },
          arguments: [field('rates', 'numerator'), field('rates', 'denominator')],
        },
      ],
    };
    const result = execute(catalog, query, {
      rates: {
        entity: 'rates',
        complete: true,
        rows: [
          { id: 'empty', group: 'empty', numerator: null, denominator: null },
          { id: 'missing', group: 'missingNumerator', numerator: null, denominator: 3 },
          { id: 'zero', group: 'zeroDenominator', numerator: 0, denominator: 0 },
          { id: 'valid', group: 'zeroValid', numerator: 0, denominator: 4 },
        ],
      },
    });
    const byGroup = new Map(result.rows.map((row) => [row.group, row.rate]));
    expect(byGroup.get('empty')).toBe(oracleExpected.emptyUnknown.empty.rate);
    expect(byGroup.get('missingNumerator')).toBe(oracleExpected.emptyUnknown.missingNumerator.rate);
    expect(byGroup.get('zeroDenominator')).toBe(oracleExpected.emptyUnknown.zeroDenominator.rate);
    expect(byGroup.get('zeroValid')).toBe(fractionNumber(oracleExpected.emptyUnknown.zeroValid.rate));
  });

  it('keeps decimal sums exact and accepts only safe integer source values', () => {
    const decimalCatalog = catalogFor(
      'decimalRows',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'amount', type: decimal(), role: 'measure' },
      ],
      ['id'],
    );
    const decimalQuery: RelationalQuery = {
      ...queryBase('decimalRows'),
      select: [{ id: 'total', expression: plainField('total') }],
      aggregates: [
        {
          id: 'total',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [field('decimalRows', 'amount')],
        },
      ],
    };
    const decimalResult = execute(decimalCatalog, decimalQuery, {
      decimalRows: {
        entity: 'decimalRows',
        complete: true,
        rows: [
          { id: 'a', amount: { decimal: '9007199254740993.01' } },
          { id: 'b', amount: { decimal: '0.02' } },
          { id: 'c', amount: { decimal: '-0.01' } },
        ],
      },
    });
    expect(decimalResult.rows).toEqual([{ total: { decimal: '9007199254740993.02' } }]);
    expect(decimalResult.precision).toEqual({ kind: 'exact' });

    const integerCatalog = catalogFor(
      'integerRows',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'amount', type: int(), role: 'measure' },
      ],
      ['id'],
    );
    const integerQuery: RelationalQuery = {
      ...queryBase('integerRows'),
      select: [{ id: 'total', expression: plainField('total') }],
      aggregates: [
        {
          id: 'total',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [field('integerRows', 'amount')],
        },
      ],
    };
    // The independent total is mathematically exact, but exceeds the declared
    // safe-integer scalar range. The SDK must refuse that output instead of
    // emitting a value outside its predicted type or silently coercing it.
    expect(
      BigInt(oracleExpected.exactArithmetic.integerTotal) > BigInt(oracleExpected.exactArithmetic.safeIntegerMaximum),
    ).toBe(true);
    expect(() =>
      execute(integerCatalog, integerQuery, {
        integerRows: {
          entity: 'integerRows',
          complete: true,
          rows: oracleCases.exactArithmetic.integerValues.map((amount, index) => ({ id: `i${index}`, amount })),
        },
      }),
    ).toThrow(/query\.numeric-overflow/);
    const unsafeSource = {
      integerRows: {
        entity: 'integerRows',
        complete: true,
        rows: [{ id: 'a', amount: Number(oracleCases.exactArithmetic.unsafeIntegerInput) }],
      },
    };
    const planner = plannerFor(integerCatalog);
    const planned = planner.plan(integerQuery);
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
    const rejected = planner.evaluate(planned.value, { revision: 'source-query-oracle', relations: unsafeSource });
    expect(rejected.ok).toBe(oracleExpected.exactArithmetic.unsafeIntegerInput.state === 'accepted');
    if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('query.source-value');
  });

  it('ranks pooled rates after aggregation and rejects partial top-k populations', () => {
    const catalog = catalogFor(
      'observations',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'employee', type: text(), role: 'dimension' },
        { id: 'week', type: text(), role: 'dimension' },
        { id: 'numerator', type: int(), role: 'measure' },
        { id: 'denominator', type: int(), role: 'measure' },
      ],
      ['id'],
    );
    const sourceRows = oracleCases.ranking.observations.map((observation, index) => ({
      id: `ob${index}`,
      ...observation,
    }));
    const query: RelationalQuery = {
      ...queryBase('observations'),
      select: [
        { id: 'employee', expression: plainField('employee') },
        { id: 'rate', expression: plainField('rate') },
      ],
      groupBy: [{ id: 'employee', expression: field('observations', 'employee') }],
      aggregates: [
        {
          id: 'rate',
          function: { id: 'core.ratio-of-sums', revision: '1' },
          arguments: [field('observations', 'numerator'), field('observations', 'denominator')],
        },
      ],
      orderBy: [
        { expression: plainField('rate'), direction: 'desc', nulls: 'last' },
        { expression: plainField('employee'), direction: 'asc', nulls: 'last' },
      ],
      topK: 3,
    };
    const result = execute(catalog, query, {
      observations: { entity: 'observations', complete: true, rows: sourceRows },
    });
    expect(result.rows.map((row) => row.employee)).toEqual(oracleExpected.ranking.fixedTopK);
    const rates = new Map(result.rows.map((row) => [row.employee, row.rate]));
    const asNumber = (value: unknown): number =>
      typeof value === 'number'
        ? value
        : value !== null && typeof value === 'object' && value !== undefined && 'decimal' in value
          ? Number((value as { decimal: string }).decimal)
          : NaN;
    expect(asNumber(rates.get('C'))).toBeCloseTo(3 / 5, 12);
    expect(asNumber(rates.get('D'))).toBeCloseTo(3 / 5, 12);
    expect(asNumber(rates.get('A'))).toBeCloseTo(1 / 2, 12);

    const partialQuery: RelationalQuery = {
      ...queryBase('scores'),
      select: [
        { id: 'id', expression: plainField('id') },
        { id: 'score', expression: plainField('score') },
      ],
      orderBy: [{ expression: plainField('score'), direction: 'desc', nulls: 'last' }],
      topK: 1,
    };
    const scoresCatalog = catalogFor(
      'scores',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'score', type: int(), role: 'measure' },
      ],
      ['id'],
    );
    const planner = plannerFor(scoresCatalog);
    const planned = planner.plan(partialQuery);
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
    const partial = planner.evaluate(planned.value, {
      revision: 'source-query-oracle',
      relations: {
        scores: {
          entity: 'scores',
          complete: false,
          rows: oracleCases.ranking.partialPage.map((item) => ({ id: item.employee, score: item.score })),
        },
      },
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.diagnostics[0]?.code).toBe('query.incomplete-input');
    const complete = planner.evaluate(planned.value, {
      revision: 'source-query-oracle',
      relations: {
        scores: {
          entity: 'scores',
          complete: true,
          rows: oracleCases.ranking.partialPage.map((item) => ({ id: item.employee, score: item.score })),
        },
      },
    });
    if (!complete.ok) throw new Error(JSON.stringify(complete.diagnostics));
    expect(complete.value.rows).toEqual([
      {
        id: oracleExpected.ranking.fullTop,
        score: Math.max(...oracleCases.ranking.partialPage.map((item) => item.score)),
      },
    ]);
  });

  it('rejects declared many-to-one violations and applies half-open instant bounds', () => {
    const membership = {
      id: 'employee-membership',
      revision: '1',
      sourceEntity: 'people',
      targetEntity: 'memberships',
      keys: [{ sourceField: 'id', targetField: 'employee' }],
      cardinality: 'many-to-one',
      optional: false,
      joinPolicy: 'validated',
    } as const;
    const membershipEntity: Catalog['entities'][number] = {
      id: 'memberships',
      label: 'memberships',
      identity: ['rowId'],
      rowGrain: ['rowId'],
      fields: [
        { id: 'rowId', label: 'rowId', type: text(), role: 'identity' },
        { id: 'employee', label: 'employee', type: text(), role: 'attribute' },
        { id: 'team', label: 'team', type: text(), role: 'attribute' },
      ],
    };
    const peopleCatalog = catalogFor(
      'people',
      [{ id: 'id', type: text(), role: 'identity' }],
      ['id'],
      [membership],
      [membershipEntity],
    );
    const joinQuery: RelationalQuery = {
      ...queryBase('people'),
      select: [
        { id: 'id', expression: field('people', 'id') },
        { id: 'rowId', expression: field('memberships', 'rowId') },
        { id: 'team', expression: plainField('team') },
      ],
      joins: [
        {
          id: 'membership',
          rightEntity: 'memberships',
          relationship: { id: membership.id, revision: membership.revision },
          kind: 'inner',
        },
      ],
    };
    const joinPlanner = plannerFor(peopleCatalog);
    const plannedJoin = joinPlanner.plan(joinQuery);
    if (!plannedJoin.ok) throw new Error(JSON.stringify(plannedJoin.diagnostics));
    const invalid = joinPlanner.evaluate(plannedJoin.value, {
      revision: 'source-query-oracle',
      relations: {
        people: { entity: 'people', complete: true, rows: [{ id: 'e1' }, { id: 'e2' }] },
        memberships: {
          entity: 'memberships',
          complete: true,
          rows: [
            { rowId: 'm1', employee: 'e1', team: 't1' },
            { rowId: 'm2', employee: 'e1', team: 't2' },
            { rowId: 'm3', employee: 'e2', team: 't2' },
          ],
        },
      },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0]?.code).toBe('query.cardinality');

    const eventCatalog = catalogFor(
      'events',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'instant', type: { value: 'instant', nullable: false }, role: 'time' },
      ],
      ['id'],
    );
    const instant = (value: string): Expression => literal(value, { value: 'instant', nullable: false });
    const periodQuery: RelationalQuery = {
      ...queryBase('events'),
      select: [
        { id: 'id', expression: field('events', 'id') },
        { id: 'instant', expression: field('events', 'instant') },
      ],
      filter: {
        op: 'and',
        predicates: [
          {
            op: 'compare',
            left: field('events', 'instant'),
            comparison: 'gte',
            right: instant('2026-03-01T00:00:00Z'),
          },
          { op: 'compare', left: field('events', 'instant'), comparison: 'lt', right: instant('2026-04-01T00:00:00Z') },
        ],
      },
    };
    const events = execute(eventCatalog, periodQuery, {
      events: { entity: 'events', complete: true, rows: oracleCases.incompleteAndAdversarial.events },
    });
    expect(events.rows.map((row) => row.id)).toEqual(oracleExpected.incompleteAndAdversarial.halfOpenPeriod.included);
    expect(
      oracleCases.incompleteAndAdversarial.events
        .map((row) => row.id)
        .filter((id) => !events.rows.some((row) => row.id === id)),
    ).toEqual(oracleExpected.incompleteAndAdversarial.halfOpenPeriod.excluded);

    const invalidDecimalCatalog = catalogFor(
      'decimalInput',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'amount', type: decimal(), role: 'measure' },
      ],
      ['id'],
    );
    const invalidDecimalQuery: RelationalQuery = {
      ...queryBase('decimalInput'),
      select: [{ id: 'id', expression: field('decimalInput', 'id') }],
    };
    const decimalPlanner = plannerFor(invalidDecimalCatalog);
    const decimalPlan = decimalPlanner.plan(invalidDecimalQuery);
    if (!decimalPlan.ok) throw new Error(JSON.stringify(decimalPlan.diagnostics));
    const decimalInput = decimalPlanner.evaluate(decimalPlan.value, {
      revision: 'source-query-oracle',
      relations: {
        decimalInput: {
          entity: 'decimalInput',
          complete: true,
          rows: [{ id: 'a', amount: { decimal: '1.2.3' } } as QueryRow],
        },
      },
    });
    expect(decimalInput.ok).toBe(false);
    if (!decimalInput.ok) expect(decimalInput.diagnostics[0]?.code).toBe('query.source-value');
  });

  it('uses explicit Gregorian UTC time buckets and rejects an unapproved timezone', () => {
    const catalog = catalogFor(
      'timestamped',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'instant', type: { value: 'instant', nullable: false }, role: 'time' },
      ],
      ['id'],
    );
    const buckets = (): TimeBucketSpec[] => [
      {
        id: 'day',
        expression: field('timestamped', 'instant'),
        grain: 'day',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      },
      {
        id: 'week',
        expression: field('timestamped', 'instant'),
        grain: 'week',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      },
      {
        id: 'month',
        expression: field('timestamped', 'instant'),
        grain: 'month',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      },
      {
        id: 'quarter',
        expression: field('timestamped', 'instant'),
        grain: 'quarter',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      },
      {
        id: 'year',
        expression: field('timestamped', 'instant'),
        grain: 'year',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      },
    ];
    const query: RelationalQuery = {
      ...queryBase('timestamped'),
      select: [
        { id: 'id', expression: field('timestamped', 'id') },
        { id: 'day', expression: plainField('day') },
        { id: 'week', expression: plainField('week') },
        { id: 'month', expression: plainField('month') },
        { id: 'quarter', expression: plainField('quarter') },
        { id: 'year', expression: plainField('year') },
      ],
      timeBuckets: buckets(),
    };
    const result = execute(catalog, query, {
      timestamped: { entity: 'timestamped', complete: true, rows: oracleCases.timeBuckets.instants },
    });
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    for (const expected of oracleExpected.timeBuckets.instants) {
      const actual = byId.get(expected.id);
      expect(actual?.day).toBe(expected.day);
      expect(actual?.month).toBe(`${expected.month}-01`);
      const quarterMonth = { Q1: '01', Q2: '04', Q3: '07', Q4: '10' }[
        expected.quarter.slice(5) as 'Q1' | 'Q2' | 'Q3' | 'Q4'
      ];
      expect(actual?.quarter).toBe(`${expected.quarter.slice(0, 4)}-${quarterMonth}-01`);
      expect(actual?.year).toBe(`${expected.year}-01-01`);
    }

    const unsupportedBuckets = buckets().map((item) => ({
      ...item,
      timezone: 'Asia/Jakarta',
    })) as unknown as TimeBucketSpec[];
    const unsupported = plannerFor(catalog).plan({ ...query, timeBuckets: unsupportedBuckets });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.diagnostics[0]?.code).toBe('query.unsupported');
  });

  it('evaluates bounded windows with partition, stable order and null propagation', () => {
    const catalog = catalogFor(
      'windowRows',
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'partition', type: text(), role: 'dimension' },
        { id: 'sequence', type: int(), role: 'dimension' },
        { id: 'score', type: int(), role: 'measure' },
        { id: 'value', type: int(true), role: 'measure' },
      ],
      ['id'],
    );
    const row = (id: string, partition: string, sequence: number, score: number, value: number | null): QueryRow => ({
      id,
      partition,
      sequence,
      score,
      value,
    });
    const rows = oracleCases.windows.rows.map((item) =>
      row(item.id, item.partition, item.sequence, item.score, item.value),
    );
    const sequenceOrder = [
      { expression: field('windowRows', 'sequence'), direction: 'asc' as const, nulls: 'last' as const },
      { expression: field('windowRows', 'id'), direction: 'asc' as const, nulls: 'last' as const },
    ];
    const rankOrder = [
      { expression: field('windowRows', 'score'), direction: 'desc' as const, nulls: 'last' as const },
      { expression: field('windowRows', 'id'), direction: 'asc' as const, nulls: 'last' as const },
    ];
    const windowQuery: RelationalQuery = {
      ...queryBase('windowRows'),
      select: [
        { id: 'id', expression: field('windowRows', 'id') },
        { id: 'partition', expression: plainField('partition') },
        { id: 'sequence', expression: plainField('sequence') },
        { id: 'score', expression: plainField('score') },
        { id: 'value', expression: plainField('value') },
        { id: 'sum', expression: plainField('sum') },
        { id: 'lag', expression: plainField('lag') },
        { id: 'rank', expression: plainField('rank') },
      ],
      windows: [
        {
          id: 'sum',
          function: { id: 'core.window.sum', revision: '1' },
          arguments: [field('windowRows', 'value')],
          partitionBy: [field('windowRows', 'partition')],
          orderBy: sequenceOrder,
          frame: { preceding: 1, following: 1 },
        },
        {
          id: 'lag',
          function: { id: 'core.window.lag', revision: '1' },
          arguments: [field('windowRows', 'value')],
          partitionBy: [field('windowRows', 'partition')],
          orderBy: sequenceOrder,
          frame: { preceding: 1, following: 1 },
        },
        {
          id: 'rank',
          function: { id: 'core.window.rank', revision: '1' },
          arguments: [],
          partitionBy: [field('windowRows', 'partition')],
          orderBy: rankOrder,
          frame: { preceding: 1, following: 1 },
        },
      ],
    };
    const result = execute(catalog, windowQuery, { windowRows: { entity: 'windowRows', complete: true, rows } });
    const byId = new Map(result.rows.map((item) => [item.id, item]));
    expect(result.rows.map((item) => item.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1']);
    for (const expected of oracleExpected.windows.rows)
      expect(byId.get(expected.id)).toMatchObject({ sum: expected.sum, lag: expected.lag, rank: expected.rank });

    const invalidFrame: RelationalQuery = {
      ...windowQuery,
      windows: [{ ...windowQuery.windows![1]!, frame: { preceding: 0, following: 1 } }],
    };
    const invalid = plannerFor(catalog).plan(invalidFrame);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0]?.code).toBe('query.window-frame');
  });

  it('binds an approved commerce net measure through the canonical meaning expression', () => {
    const catalog = catalogFor(
      'commerce',
      [
        { id: 'orderId', type: text(), role: 'identity' },
        { id: 'revenue', type: decimal(true), role: 'measure' },
        { id: 'cost', type: decimal(true), role: 'measure' },
      ],
      ['orderId'],
    );
    const authoringOutcome = createTypedAuthoring({ catalog, registry });
    if (!authoringOutcome.ok) throw new Error(JSON.stringify(authoringOutcome.diagnostics));
    const authoring = authoringOutcome.value;
    const revenue = {
      expression: field('commerce', 'revenue'),
      type: decimal(true),
      context: 'row' as const,
      entityId: 'commerce',
    };
    const cost = {
      expression: field('commerce', 'cost'),
      type: decimal(true),
      context: 'row' as const,
      entityId: 'commerce',
    };
    const revenueSum = authoring.call({ id: 'core.aggregate.sum', revision: '1' }, [revenue]);
    const costSum = authoring.call({ id: 'core.aggregate.sum', revision: '1' }, [cost]);
    if (!revenueSum.ok) throw new Error(JSON.stringify(revenueSum.diagnostics));
    if (!costSum.ok) throw new Error(JSON.stringify(costSum.diagnostics));
    const netExpression = authoring.call({ id: 'core.subtract', revision: '1' }, [revenueSum.value, costSum.value]);
    if (!netExpression.ok) throw new Error(JSON.stringify(netExpression.diagnostics));
    const meaning = authoring.defineMetric({
      id: 'commerce.net',
      label: 'Net revenue',
      description: 'Pooled revenue less pooled cost.',
      expression: netExpression.value,
      aggregation: 'none',
      missingPolicy: 'propagate',
      scope: 'organization',
    });
    if (!meaning.ok) throw new Error(JSON.stringify(meaning.diagnostics));
    // The host treats this definition as the reviewed, active version in the
    // catalog snapshot used by the query path. The expression itself remains
    // the authoring builder's canonical tree.
    const approvedMeaning: MeaningDefinition = {
      ...meaning.value,
      lifecycle: 'active',
      authority: 'approved',
    };
    expect(approvedMeaning.implementation).toEqual({
      kind: 'expression',
      expression: {
        kind: 'call',
        function: { id: 'core.subtract', revision: '1' },
        arguments: [
          {
            kind: 'call',
            function: { id: 'core.aggregate.sum', revision: '1' },
            arguments: [{ kind: 'field', entity: 'commerce', ref: 'revenue' }],
          },
          {
            kind: 'call',
            function: { id: 'core.aggregate.sum', revision: '1' },
            arguments: [{ kind: 'field', entity: 'commerce', ref: 'cost' }],
          },
        ],
      },
    });
    const query: QuerySpec = {
      entity: 'commerce',
      fields: [],
      measures: [{ id: approvedMeaning.id, revision: approvedMeaning.revision }],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [],
    };
    const plannerOutcome = createQueryPlanner({ catalog, registry, definitions: [approvedMeaning] });
    if (!plannerOutcome.ok) throw new Error(JSON.stringify(plannerOutcome.diagnostics));
    const planned = plannerOutcome.value.plan(query);
    if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
    const evaluated = plannerOutcome.value.evaluate(planned.value, {
      revision: 'source-query-oracle',
      relations: {
        commerce: {
          entity: 'commerce',
          complete: true,
          rows: [
            { orderId: 'o1', revenue: { decimal: '100.25' }, cost: { decimal: '40.10' } },
            { orderId: 'o2', revenue: { decimal: '20.00' }, cost: { decimal: '9.75' } },
          ],
        },
      },
    });
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
    expect(evaluated.value.rows).toEqual([{ 'commerce.net': { decimal: '70.4' } }]);
    expect(evaluated.value.precision).toEqual({ kind: 'exact' });
  });
});
