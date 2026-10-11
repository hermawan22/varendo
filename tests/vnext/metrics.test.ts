import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import { validateMeaning } from '../../packages/core/src/semantics/meaning.js';
import type {
  Catalog,
  FieldDefinition,
  MeaningDefinition,
  QuerySpec,
  SemanticType,
} from '../../packages/core/src/contracts/types.js';
import type {
  LogicalPlan,
  QueryPlanner,
  QueryRow,
  QuerySource,
  RelationalQuery,
} from '../../packages/core/src/query/types.js';

const registryOutcome = createQueryFunctionRegistry({ version: '2' });
if (!registryOutcome.ok) throw new Error(JSON.stringify(registryOutcome.diagnostics));
const registry = registryOutcome.value;

const ref = (id: string) => ({ id, revision: '1' }) as const;
const field = (entity: string, ref_: string) => ({ kind: 'field' as const, entity, ref: ref_ });
const plainField = (ref_: string) => ({ kind: 'field' as const, ref: ref_ });

type MutablePlanField = { id: string };
type MutablePlanItem = {
  id: string;
  semantics?: Record<string, unknown>;
  arguments: Array<{ kind: string; entity?: string; ref?: string }>;
  expression: { ref?: string };
};
type MutablePlanNode = {
  op: string;
  items?: MutablePlanItem[];
  keys?: Array<{ id: string; expression: { kind: string; entity?: string; ref?: string } }>;
  output?: { fields: MutablePlanField[] };
};
type MutablePlan = Omit<LogicalPlan, 'canonical' | 'planKey' | 'nodes' | 'output' | 'pins'> & {
  canonical: string;
  planKey: string;
  root: string;
  pins: Record<string, unknown>;
  nodes: MutablePlanNode[];
  output: { fields: MutablePlanField[] };
};

function mutablePlan(plan: LogicalPlan): MutablePlan {
  return structuredClone(plan) as unknown as MutablePlan;
}

function asLogicalPlan(plan: MutablePlan): LogicalPlan {
  return plan as unknown as LogicalPlan;
}

function aggregateNode(plan: MutablePlan): MutablePlanNode & { items: MutablePlanItem[] } {
  const node = plan.nodes.find((candidate) => candidate.op === 'aggregate');
  if (node?.items === undefined) throw new Error('aggregate fixture node is missing');
  return node as MutablePlanNode & { items: MutablePlanItem[] };
}

function aggregateItem(plan: MutablePlan): MutablePlanItem {
  const item = aggregateNode(plan).items[0];
  if (item === undefined) throw new Error('aggregate fixture item is missing');
  return item;
}

function recanonicalize(plan: MutablePlan): void {
  const canonical = (value: unknown): string =>
    value === null || typeof value !== 'object'
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? `[${value.map(canonical).join(',')}]`
        : `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
  plan.canonical = canonical({ version: '1', pins: plan.pins, root: plan.root, nodes: plan.nodes });
  plan.planKey = `query-${plan.canonical}`;
}

function renameAggregate(plan: MutablePlan, original: string, replacement: string): void {
  aggregateItem(plan).id = replacement;
  for (const node of plan.nodes) {
    for (const field of node.output?.fields ?? []) {
      if (field.id === original) field.id = replacement;
    }
    if (node.op !== 'project') continue;
    for (const projection of node.items ?? []) {
      if (projection.id === original) projection.id = replacement;
      if (projection.expression.ref === original) projection.expression.ref = replacement;
    }
  }
  for (const field of plan.output.fields) {
    if (field.id === original) field.id = replacement;
  }
  recanonicalize(plan);
}

const money = (currency: string): SemanticType['unit'] => ({
  dimension: 'money',
  symbol: currency,
  currency,
});

const physical = (dimension: string, symbol: string): SemanticType['unit'] => ({ dimension, symbol });

const integer = (nullable = false, unit?: SemanticType['unit'], grain?: readonly string[]): SemanticType => ({
  value: 'integer',
  nullable,
  ...(unit === undefined ? {} : { unit }),
  ...(grain === undefined ? {} : { grain }),
});

const date = (timezone = 'UTC', calendar = 'gregorian'): SemanticType => ({
  value: 'date',
  nullable: false,
  temporal: { calendar, timezone, grain: 'day' },
});

function metric(
  id: string,
  expression: Extract<MeaningDefinition['implementation'], { readonly kind: 'expression' }>['expression'],
  output: SemanticType,
  aggregation: MeaningDefinition['aggregation'],
  missingPolicy: MeaningDefinition['missingPolicy'] = 'propagate',
  aggregationDimensions: readonly string[] = [],
): MeaningDefinition {
  return {
    id,
    revision: '1',
    label: id,
    explanation: id,
    output,
    implementation: { kind: 'expression', expression },
    dependencies: [],
    functionRegistryDigest: registry.digest,
    origin: 'manual',
    lifecycle: 'active',
    scope: 'workspace',
    authority: 'approved',
    aggregation,
    aggregationDimensions,
    missingPolicy,
  };
}

function catalog(meanings: readonly MeaningDefinition[] = [], includePhysicalUnits = false): Catalog {
  const fields: { id: string; type: SemanticType; role: FieldDefinition['role'] }[] = [
    { id: 'id', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'day', type: date(), role: 'time' },
    { id: 'reportedOn', type: date(), role: 'time' },
    { id: 'balance', type: integer(false, money('USD'), ['id']), role: 'measure' },
    { id: 'numerator', type: integer(true), role: 'measure' },
    { id: 'denominator', type: integer(true), role: 'measure' },
    { id: 'usd', type: integer(false, money('USD')), role: 'measure' },
    { id: 'eur', type: integer(false, money('EUR')), role: 'measure' },
    { id: 'raw', type: integer(false), role: 'measure' },
  ];
  if (includePhysicalUnits) {
    fields.push(
      { id: 'meters', type: integer(false, physical('length', 'm')), role: 'measure' },
      { id: 'seconds', type: integer(false, physical('time', 's')), role: 'measure' },
    );
  }
  return {
    version: '1',
    revision: 'vnext-metrics',
    functionRegistryDigest: registry.digest,
    entities: [
      {
        id: 'metrics',
        label: 'Metrics',
        identity: ['id'],
        rowGrain: ['id'],
        fields: fields.map((candidate) => ({ ...candidate, label: candidate.id })),
      },
    ],
    relationships: [],
    meanings,
    capabilities: [],
  };
}

function source(rows: readonly QueryRow[], complete = true): QuerySource {
  return {
    revision: 'metrics-source',
    catalogRevision: 'vnext-metrics',
    relations: {
      metrics: {
        entity: 'metrics',
        complete,
        rows: rows.map((row) => ({ ...row, reportedOn: row.reportedOn ?? row.day ?? '2026-01-01' })),
      },
    },
  };
}

function plannerFor(value: Catalog): QueryPlanner {
  const planner = createQueryPlanner({ catalog: value, registry });
  if (!planner.ok) throw new Error(JSON.stringify(planner.diagnostics));
  return planner.value;
}

function analyze(measure: string, timeBucket?: QuerySpec['timeBucket']): QuerySpec {
  return {
    entity: 'metrics',
    fields: timeBucket === undefined ? [] : ['day'],
    measures: [ref(measure)],
    relations: [],
    groupBy: timeBucket === undefined ? [] : ['day'],
    population: { kind: 'all-authorized' },
    order: [],
    ...(timeBucket === undefined ? {} : { timeBucket }),
  };
}

function ratioMetric(
  id: string,
  functionId: 'core.ratio-of-sums.null' | 'core.ratio-of-sums.unknown',
  missingPolicy: MeaningDefinition['missingPolicy'],
): MeaningDefinition {
  return metric(
    id,
    {
      kind: 'call',
      function: ref(functionId),
      arguments: [field('metrics', 'numerator'), field('metrics', 'denominator')],
    },
    { value: 'float', nullable: true },
    'ratio-of-sums',
    missingPolicy,
  );
}

function meanMetric(id: string, missingPolicy: MeaningDefinition['missingPolicy']): MeaningDefinition {
  return metric(
    id,
    {
      kind: 'call',
      function: ref('core.mean-of-rates'),
      arguments: [field('metrics', 'numerator')],
    },
    { value: 'float', nullable: true },
    'non-additive',
    missingPolicy,
  );
}

function variadicMeanMetric(id: string, missingPolicy: MeaningDefinition['missingPolicy']): MeaningDefinition {
  return metric(
    id,
    {
      kind: 'call',
      function: ref('core.mean-of-rates'),
      arguments: [field('metrics', 'numerator'), field('metrics', 'denominator')],
    },
    { value: 'float', nullable: true },
    'non-additive',
    missingPolicy,
  );
}

function countMetric(
  id: string,
  missingPolicy: MeaningDefinition['missingPolicy'],
  functionId: 'core.aggregate.count' | 'core.aggregate.count-distinct' = 'core.aggregate.count',
): MeaningDefinition {
  return metric(
    id,
    {
      kind: 'call',
      function: ref(functionId),
      arguments: [field('metrics', 'numerator')],
    },
    { value: 'integer', nullable: true },
    'additive',
    missingPolicy,
  );
}

describe('vNext semantic analytics', () => {
  it('validates every catalog meaning output when creating a planner', () => {
    const invalid = metric(
      'orders.usd-as-eur',
      { kind: 'call', function: ref('core.aggregate.sum'), arguments: [field('metrics', 'usd')] },
      integer(true, money('EUR')),
      'additive',
    );
    expect(createQueryPlanner({ catalog: catalog([invalid]), registry })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.type-mismatch' }],
    });
  });

  it('rejects propagating aggregate meanings with non-null outputs', () => {
    const invalid = metric(
      'orders.count.non-null',
      { kind: 'call', function: ref('core.aggregate.count'), arguments: [field('metrics', 'numerator')] },
      integer(false),
      'additive',
      'propagate',
    );
    const value = catalog([invalid]);
    expect(validateMeaning(invalid, { catalog: value, registry, entityId: 'metrics' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.missing-policy' }],
    });
    expect(createQueryPlanner({ catalog: value, registry })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.missing-policy' }],
    });
  });

  it('selects the month-end value for a registered semi-additive balance', () => {
    const balance = metric(
      'inventory.balance',
      {
        kind: 'call',
        function: ref('core.aggregate.sum'),
        arguments: [field('metrics', 'balance')],
      },
      integer(true, money('USD')),
      'semi-additive',
    );
    const balanceCatalog = catalog([balance]);
    const validatedBalance = validateMeaning(balance, { catalog: balanceCatalog, registry, entityId: 'metrics' });
    expect(validatedBalance, JSON.stringify(validatedBalance)).toMatchObject({
      ok: true,
    });
    const planner = plannerFor(balanceCatalog);
    const plan = planner.plan(
      analyze('inventory.balance', {
        field: 'day',
        grain: 'month',
        calendar: 'gregorian',
        timezone: 'UTC',
      }),
    );
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const unique = planner.evaluate(
      plan.value,
      source([
        { id: 'd1', day: '2026-01-01', balance: 10, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'd2', day: '2026-01-15', balance: 20, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'd3', day: '2026-01-31', balance: 30, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(unique).toMatchObject({
      ok: true,
      value: { rows: [{ day: '2026-01-01', 'inventory.balance': 30 }] },
    });
    const earlierTie = [
      { id: 'd1', day: '2026-01-01', balance: 10, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
      { id: 'd2', day: '2026-01-01', balance: 11, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
      { id: 'd3', day: '2026-01-31', balance: 30, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
    ] satisfies readonly QueryRow[];
    for (const rows of [earlierTie, [earlierTie[2]!, earlierTie[0]!, earlierTie[1]!]]) {
      expect(planner.evaluate(plan.value, source(rows))).toMatchObject({
        ok: true,
        value: { rows: [{ 'inventory.balance': 30 }] },
      });
    }
    const result = planner.evaluate(
      plan.value,
      source([
        { id: 'd1', day: '2026-01-01', balance: 10, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'd2', day: '2026-01-15', balance: 20, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'd3', day: '2026-01-31', balance: 30, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'd4', day: '2026-01-31', balance: 40, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(result).toMatchObject({ ok: true, value: { rows: [{ 'inventory.balance': 70 }] } });
  });

  it('selects latest-period additive rows inside declared semi-additive partitions', () => {
    const balance = metric(
      'inventory.partitioned-balance',
      {
        kind: 'call',
        function: ref('core.aggregate.sum'),
        arguments: [field('metrics', 'balance')],
      },
      integer(true, money('USD'), ['id']),
      'semi-additive',
      'propagate',
      ['id'],
    );
    const baseCatalog = catalog([balance]);
    const value: Catalog = {
      ...baseCatalog,
      entities: baseCatalog.entities.map((entity) => ({ ...entity, identity: ['id', 'day'], rowGrain: ['id', 'day'] })),
    };
    expect(validateMeaning(balance, { catalog: value, registry, entityId: 'metrics' })).toMatchObject({ ok: true });
    const planner = plannerFor(value);
    const plan = planner.plan({
      ...analyze('inventory.partitioned-balance', {
        field: 'day',
        grain: 'month',
        calendar: 'gregorian',
        timezone: 'UTC',
      }),
      fields: ['id', 'day'],
      groupBy: ['id', 'day'],
    });
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const result = planner.evaluate(
      plan.value,
      source([
        { id: 'a', day: '2026-01-01', balance: 10, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'a', day: '2026-01-31', balance: 30, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'b', day: '2026-01-31', balance: 40, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.rows).toContainEqual(expect.objectContaining({ id: 'a', 'inventory.partitioned-balance': 30 }));
  });

  it('rejects semi-additive plans that omit or forge a declared partition binding', () => {
    const balance = metric(
      'inventory.partitioned-balance',
      {
        kind: 'call',
        function: ref('core.aggregate.sum'),
        arguments: [field('metrics', 'balance')],
      },
      integer(true, money('USD'), ['id']),
      'semi-additive',
      'propagate',
      ['id'],
    );
    const planner = plannerFor(catalog([balance]));
    const missingPartition = planner.plan(
      analyze('inventory.partitioned-balance', {
        field: 'day',
        grain: 'month',
        calendar: 'gregorian',
        timezone: 'UTC',
      }),
    );
    expect(missingPartition.ok, JSON.stringify(missingPartition)).toBe(true);
    if (!missingPartition.ok) return;
    expect(planner.evaluate(missingPartition.value, source([]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.plan' }],
    });

    const forged = mutablePlan(missingPartition.value);
    const semantics = aggregateItem(forged).semantics;
    if (semantics === undefined) throw new Error('aggregate semantics fixture is missing');
    semantics.aggregationDimensions = [];
    recanonicalize(forged);
    expect(planner.evaluate(asLogicalPlan(forged), source([]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.plan' }],
    });
  });

  it('rejects a semi-additive binding to an unrelated date field', () => {
    const balance = metric(
      'inventory.balance',
      {
        kind: 'call',
        function: ref('core.aggregate.sum'),
        arguments: [field('metrics', 'balance')],
      },
      integer(true, money('USD')),
      'semi-additive',
    );
    const planner = plannerFor(catalog([balance]));
    const plan = planner.plan(
      analyze('inventory.balance', {
        field: 'day',
        grain: 'month',
        calendar: 'gregorian',
        timezone: 'UTC',
      }),
    );
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const forged = mutablePlan(plan.value);
    const semantics = aggregateItem(forged).semantics;
    if (semantics === undefined) throw new Error('aggregate semantics fixture is missing');
    semantics.timeExpression = { kind: 'field', entity: 'metrics', ref: 'reportedOn' };
    recanonicalize(forged);
    expect(
      planner.evaluate(
        asLogicalPlan(forged),
        source([
          {
            id: 'a',
            day: '2026-01-31',
            reportedOn: '2026-01-01',
            balance: 1,
            numerator: 1,
            denominator: 1,
            usd: 1,
            eur: 1,
            raw: 1,
          },
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });
  });

  it('computes ratio-of-sums with an exclude-pair missing policy', () => {
    const ratio = ratioMetric('orders.rate', 'core.ratio-of-sums.null', 'exclude-pair');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const result = planner.evaluate(
      plan.value,
      source([
        { id: 'complete', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 },
        { id: 'complete-two', day: '2026-01-02', balance: 1, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        { id: 'missing', day: '2026-01-02', balance: 1, numerator: null, denominator: 10, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(result).toMatchObject({ ok: true, value: { rows: [{ 'orders.rate': 0.6 }] } });

    const empty = planner.evaluate(
      plan.value,
      source([
        {
          id: 'all-missing',
          day: '2026-01-03',
          balance: 1,
          numerator: null,
          denominator: null,
          usd: 1,
          eur: 1,
          raw: 1,
        },
      ]),
    );
    expect(empty).toMatchObject({ ok: true, value: { rows: [{ 'orders.rate': null }] } });
  });

  it('keeps zero-denominator policies distinct from a valid zero ratio', () => {
    const unknown = ratioMetric('orders.rate.unknown', 'core.ratio-of-sums.unknown', 'propagate');
    const planner = plannerFor(catalog([unknown]));
    const plan = planner.plan(analyze('orders.rate.unknown'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const zero = planner.evaluate(
      plan.value,
      source([{ id: 'zero', day: '2026-01-01', balance: 1, numerator: 0, denominator: 0, usd: 1, eur: 1, raw: 1 }]),
    );
    expect(zero).toMatchObject({
      ok: true,
      value: { rows: [{ 'orders.rate.unknown': null }], unknown: [{ field: 'division' }] },
    });

    const valid = planner.evaluate(
      plan.value,
      source([
        { id: 'valid-zero', day: '2026-01-01', balance: 1, numerator: 0, denominator: 4, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(valid).toMatchObject({ ok: true, value: { rows: [{ 'orders.rate.unknown': 0 }] } });

    const propagated = planner.evaluate(
      plan.value,
      source([
        { id: 'missing', day: '2026-01-02', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(propagated).toMatchObject({ ok: true, value: { rows: [{ 'orders.rate.unknown': null }] } });
  });

  it('rejects missing values when a ratio meaning declares reject', () => {
    const ratio = ratioMetric('orders.rate.reject', 'core.ratio-of-sums.null', 'reject');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate.reject'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const result = planner.evaluate(
      plan.value,
      source([
        { id: 'missing', day: '2026-01-01', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
      ]),
    );
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'query.missing-value' }] });
  });

  it('does not allow a forged plan to weaken a registered reject policy', () => {
    const ratio = ratioMetric('orders.rate.reject', 'core.ratio-of-sums.null', 'reject');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate.reject'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const forged = mutablePlan(plan.value);
    const aggregateItemValue = aggregateItem(forged);
    if (aggregateItemValue.semantics === undefined) throw new Error('aggregate semantics fixture is missing');
    aggregateItemValue.semantics.missingPolicy = 'propagate';
    const canonical = (value: unknown): string =>
      value === null || typeof value !== 'object'
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.map(canonical).join(',')}]`
          : `{${Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
              .join(',')}}`;
    forged.canonical = canonical({ version: '1', pins: forged.pins, root: forged.root, nodes: forged.nodes });
    forged.planKey = `query-${forged.canonical}`;
    expect(
      planner.evaluate(
        asLogicalPlan(forged),
        source([
          { id: 'missing', day: '2026-01-01', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });

    const stripped = mutablePlan(plan.value);
    delete aggregateItem(stripped).semantics;
    stripped.canonical = canonical({ version: '1', pins: stripped.pins, root: stripped.root, nodes: stripped.nodes });
    stripped.planKey = `query-${stripped.canonical}`;
    expect(
      planner.evaluate(
        asLogicalPlan(stripped),
        source([
          { id: 'missing', day: '2026-01-01', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });
  });

  it('requires aggregate identifiers to match their registered semantic meanings', () => {
    const primary = ratioMetric('orders.rate.primary', 'core.ratio-of-sums.null', 'reject');
    const sibling = ratioMetric('orders.rate.sibling', 'core.ratio-of-sums.null', 'exclude-pair');
    const planner = plannerFor(catalog([primary, sibling]));
    const plan = planner.plan(analyze(primary.id));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const forged = mutablePlan(plan.value);
    renameAggregate(forged, primary.id, sibling.id);
    expect(
      planner.evaluate(
        asLogicalPlan(forged),
        source([{ id: 'a', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 }]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });
  });

  it('requires a semantic binding after an aggregate is aliased and its binding is removed', () => {
    const ratio = ratioMetric('orders.rate.reject', 'core.ratio-of-sums.null', 'reject');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate.reject'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const forged = mutablePlan(plan.value);
    const alias = 'forged.rate';
    const original = 'orders.rate.reject';
    const item = aggregateItem(forged);
    delete item.semantics;
    item.id = alias;
    for (const node of forged.nodes) {
      for (const field of node.output?.fields ?? []) {
        if (field.id === original) field.id = alias;
      }
      if (node.op === 'project') {
        for (const projection of node.items ?? []) {
          if (projection.id === original) projection.id = alias;
          if (projection.expression.ref === original) projection.expression.ref = alias;
        }
      }
    }
    for (const field of forged.output.fields) {
      if (field.id === original) field.id = alias;
    }
    const canonical = (value: unknown): string =>
      value === null || typeof value !== 'object'
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.map(canonical).join(',')}]`
          : `{${Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
              .join(',')}}`;
    forged.canonical = canonical({ version: '1', pins: forged.pins, root: forged.root, nodes: forged.nodes });
    forged.planKey = `query-${forged.canonical}`;
    expect(
      planner.evaluate(
        asLogicalPlan(forged),
        source([
          { id: 'missing', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 },
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });
  });

  it('requires a semantic binding after an aliased ratio strips qualified field refs', () => {
    const ratio = ratioMetric('orders.rate.reject', 'core.ratio-of-sums.null', 'reject');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate.reject'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    const forged = mutablePlan(plan.value);
    const alias = 'forged.rate.unqualified';
    const original = 'orders.rate.reject';
    const item = aggregateItem(forged);
    delete item.semantics;
    item.id = alias;
    for (const argument of item.arguments) {
      if (argument.kind === 'field') delete argument.entity;
    }
    for (const node of forged.nodes) {
      for (const field of node.output?.fields ?? []) {
        if (field.id === original) field.id = alias;
      }
      if (node.op === 'project') {
        for (const projection of node.items ?? []) {
          if (projection.id === original) projection.id = alias;
          if (projection.expression.ref === original) projection.expression.ref = alias;
        }
      }
    }
    for (const field of forged.output.fields) {
      if (field.id === original) field.id = alias;
    }
    const canonical = (value: unknown): string =>
      value === null || typeof value !== 'object'
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.map(canonical).join(',')}]`
          : `{${Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
              .join(',')}}`;
    forged.canonical = canonical({ version: '1', pins: forged.pins, root: forged.root, nodes: forged.nodes });
    forged.planKey = `query-${forged.canonical}`;
    const evaluated = planner.evaluate(
      asLogicalPlan(forged),
      source([{ id: 'missing', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 }]),
    );
    expect(evaluated).toMatchObject({ ok: false, diagnostics: [{ code: 'query.plan' }] });
  });

  it('applies missing policies to mean-of-rates and nested aggregate expressions', () => {
    const rejectMean = meanMetric('orders.mean.reject', 'reject');
    const excludeMean = meanMetric('orders.mean.exclude', 'exclude-pair');
    const propagateMean = meanMetric('orders.mean.propagate', 'propagate');
    const planner = plannerFor(catalog([rejectMean, excludeMean, propagateMean]));
    const rejectPlan = planner.plan(analyze('orders.mean.reject'));
    const excludePlan = planner.plan(analyze('orders.mean.exclude'));
    const propagatePlan = planner.plan(analyze('orders.mean.propagate'));
    expect(rejectPlan.ok, JSON.stringify(rejectPlan)).toBe(true);
    expect(excludePlan.ok, JSON.stringify(excludePlan)).toBe(true);
    expect(propagatePlan.ok, JSON.stringify(propagatePlan)).toBe(true);
    if (!rejectPlan.ok || !excludePlan.ok || !propagatePlan.ok) return;
    const rows = source([
      { id: 'complete', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 },
      { id: 'missing', day: '2026-01-02', balance: 1, numerator: null, denominator: 8, usd: 1, eur: 1, raw: 1 },
    ]);
    expect(planner.evaluate(rejectPlan.value, rows)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.missing-value' }],
    });
    expect(planner.evaluate(excludePlan.value, rows)).toMatchObject({
      ok: true,
      value: { rows: [{ 'orders.mean.exclude': 2 }] },
    });
    expect(planner.evaluate(propagatePlan.value, rows)).toMatchObject({
      ok: true,
      value: { rows: [{ 'orders.mean.propagate': null }] },
    });

    const nested = metric(
      'orders.total.reject',
      {
        kind: 'call',
        function: ref('core.add'),
        arguments: [
          { kind: 'call', function: ref('core.aggregate.sum'), arguments: [field('metrics', 'numerator')] },
          { kind: 'call', function: ref('core.aggregate.sum'), arguments: [field('metrics', 'denominator')] },
        ],
      },
      { value: 'integer', nullable: true },
      'additive',
      'reject',
    );
    const nestedPlanner = plannerFor(catalog([nested]));
    const nestedPlan = nestedPlanner.plan(analyze('orders.total.reject'));
    expect(nestedPlan.ok, JSON.stringify(nestedPlan)).toBe(true);
    if (!nestedPlan.ok) return;
    expect(nestedPlanner.evaluate(nestedPlan.value, rows)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.missing-value' }],
    });
  });

  it('propagates missing values for count and count-distinct with nullable validated outputs', () => {
    const count = countMetric('orders.count', 'propagate', 'core.aggregate.count');
    const distinct = countMetric('orders.count-distinct', 'propagate', 'core.aggregate.count-distinct');
    const value = catalog([count, distinct]);
    expect(validateMeaning(count, { catalog: value, registry, entityId: 'metrics' })).toMatchObject({ ok: true });
    expect(validateMeaning(distinct, { catalog: value, registry, entityId: 'metrics' })).toMatchObject({ ok: true });
    const planner = plannerFor(value);
    const countPlan = planner.plan(analyze('orders.count'));
    const distinctPlan = planner.plan(analyze('orders.count-distinct'));
    expect(countPlan.ok, JSON.stringify(countPlan)).toBe(true);
    expect(distinctPlan.ok, JSON.stringify(distinctPlan)).toBe(true);
    if (!countPlan.ok || !distinctPlan.ok) return;
    const rows = source([
      { id: 'present', day: '2026-01-01', balance: 1, numerator: 7, denominator: 4, usd: 1, eur: 1, raw: 1 },
      { id: 'missing', day: '2026-01-02', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
    ]);
    expect(planner.evaluate(countPlan.value, rows)).toMatchObject({
      ok: true,
      value: { rows: [{ 'orders.count': null }] },
    });
    expect(planner.evaluate(distinctPlan.value, rows)).toMatchObject({
      ok: true,
      value: { rows: [{ 'orders.count-distinct': null }] },
    });
  });

  it('keeps legacy raw count and count-distinct null handling', () => {
    const planner = plannerFor(catalog());
    const query: RelationalQuery = {
      root: 'metrics',
      pins: { catalogRevision: 'vnext-metrics', functionRegistryDigest: registry.digest },
      select: [
        { id: 'count', expression: plainField('count') },
        { id: 'distinct', expression: plainField('distinct') },
      ],
      groupBy: [],
      aggregates: [
        { id: 'count', function: ref('core.aggregate.count'), arguments: [field('metrics', 'numerator')] },
        {
          id: 'distinct',
          function: ref('core.aggregate.count-distinct'),
          arguments: [field('metrics', 'numerator')],
        },
      ],
    };
    const plan = planner.plan(query);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(
      planner.evaluate(
        plan.value,
        source([
          { id: 'present', day: '2026-01-01', balance: 1, numerator: 7, denominator: 4, usd: 1, eur: 1, raw: 1 },
          { id: 'missing', day: '2026-01-02', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
        ]),
      ),
    ).toMatchObject({ ok: true, value: { rows: [{ count: 1, distinct: 1 }] } });
  });

  it('applies missing policies to counts and every variadic mean-of-rates argument', () => {
    const rejectedCount = countMetric('orders.count.reject', 'reject');
    const rejectedDistinct = countMetric('orders.distinct.reject', 'reject', 'core.aggregate.count-distinct');
    const countPlanner = plannerFor(catalog([rejectedCount, rejectedDistinct]));
    for (const meaning of [rejectedCount, rejectedDistinct]) {
      const countPlan = countPlanner.plan(analyze(meaning.id));
      expect(countPlan.ok, JSON.stringify(countPlan)).toBe(true);
      if (!countPlan.ok) continue;
      expect(
        countPlanner.evaluate(
          countPlan.value,
          source([
            { id: 'missing', day: '2026-01-01', balance: 1, numerator: null, denominator: 4, usd: 1, eur: 1, raw: 1 },
            { id: 'present', day: '2026-01-02', balance: 1, numerator: 2, denominator: 8, usd: 1, eur: 1, raw: 1 },
          ]),
        ),
      ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.missing-value' }] });
    }

    const mean = variadicMeanMetric('orders.mean.variadic', 'exclude-pair');
    const meanPlanner = plannerFor(catalog([mean]));
    const meanPlan = meanPlanner.plan(analyze(mean.id));
    expect(meanPlan.ok, JSON.stringify(meanPlan)).toBe(true);
    if (!meanPlan.ok) return;
    expect(
      meanPlanner.evaluate(
        meanPlan.value,
        source([
          { id: 'one', day: '2026-01-01', balance: 1, numerator: 2, denominator: 100, usd: 1, eur: 1, raw: 1 },
          { id: 'two', day: '2026-01-02', balance: 1, numerator: 6, denominator: null, usd: 1, eur: 1, raw: 1 },
        ]),
      ),
    ).toMatchObject({ ok: true, value: { rows: [{ 'orders.mean.variadic': 36 }] } });

    const rejectMean = variadicMeanMetric('orders.mean.variadic.reject', 'reject');
    const rejectPlanner = plannerFor(catalog([rejectMean]));
    const rejectPlan = rejectPlanner.plan(analyze(rejectMean.id));
    expect(rejectPlan.ok, JSON.stringify(rejectPlan)).toBe(true);
    if (!rejectPlan.ok) return;
    expect(
      rejectPlanner.evaluate(
        rejectPlan.value,
        source([
          {
            id: 'missing-later',
            day: '2026-01-01',
            balance: 1,
            numerator: 2,
            denominator: null,
            usd: 1,
            eur: 1,
            raw: 1,
          },
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.missing-value' }] });
  });

  it('rejects mixed currency and physical units without an explicit conversion', () => {
    const value = catalog([], true);
    const planner = plannerFor(value);
    const query = (left: string, right: string): RelationalQuery => ({
      root: 'metrics',
      select: [{ id: 'total', expression: plainField('total') }],
      aggregates: [
        {
          id: 'total',
          function: ref('core.add'),
          arguments: [field('metrics', left), field('metrics', right)],
        },
      ],
      pins: { catalogRevision: value.revision, functionRegistryDigest: registry.digest },
    });
    expect(planner.plan(query('usd', 'eur'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.unit-mismatch' }],
    });
    expect(planner.plan(query('meters', 'seconds'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.unit-mismatch' }],
    });
  });

  it('requires explicit calendar, timezone and week boundaries', () => {
    const value = catalog();
    const planner = plannerFor(value);
    const explicit: QuerySpec = {
      ...analyze('inventory.balance', {
        field: 'day',
        grain: 'week',
        calendar: 'gregorian',
        timezone: 'UTC',
        weekStartsOn: 1,
      }),
      measures: [],
    };
    const explicitPlan = planner.plan(explicit);
    expect(explicitPlan.ok, JSON.stringify(explicitPlan)).toBe(true);
    if (explicitPlan.ok) {
      const result = planner.evaluate(
        explicitPlan.value,
        source([
          { id: 'sun', day: '2026-01-04', balance: 1, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
          { id: 'mon', day: '2026-01-05', balance: 1, numerator: 1, denominator: 1, usd: 1, eur: 1, raw: 1 },
        ]),
      );
      expect(result).toMatchObject({ ok: true, value: { rows: [{ day: '2025-12-29' }, { day: '2026-01-05' }] } });
    }
    expect(
      planner.plan({
        ...explicit,
        timeBucket: { field: 'day', grain: 'week', calendar: 'gregorian', timezone: 'UTC' },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.unsupported' }] });
  });

  it('does not promote a partial population into a complete metric', () => {
    const ratio = ratioMetric('orders.rate', 'core.ratio-of-sums.null', 'propagate');
    const planner = plannerFor(catalog([ratio]));
    const plan = planner.plan(analyze('orders.rate'));
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(
      planner.evaluate(
        plan.value,
        source(
          [{ id: 'page', day: '2026-01-01', balance: 1, numerator: 2, denominator: 4, usd: 1, eur: 1, raw: 1 }],
          false,
        ),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.incomplete-input' }] });
  });

  it('does not aggregate a bare numeric field without a registered meaning', () => {
    const planner = plannerFor(catalog());
    expect(planner.plan(analyze('raw'))).toMatchObject({ ok: false, diagnostics: [{ code: 'query.meaning' }] });
  });
});
