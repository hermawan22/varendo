import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import { evaluateLogicalPlan } from '../../packages/core/src/query/evaluator.js';
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

const registry = unwrap(createQueryFunctionRegistry());
const ref = (id: string) => ({ id, revision: '1' }) as const;
const field = (entity: string, name: string): Expression => ({ kind: 'field', entity, ref: name });
const literal = (value: number, type: SemanticType = { value: 'integer', nullable: false }): Expression => ({
  kind: 'literal',
  value,
  type,
});
const catalog: Catalog = {
  version: '1',
  revision: 'execution-budgets',
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
        { id: 'group', label: 'Group', role: 'attribute', type: { value: 'text', nullable: false } },
        { id: 'sequence', label: 'Sequence', role: 'dimension', type: { value: 'integer', nullable: false } },
        { id: 'payload', label: 'Payload', role: 'attribute', type: { value: 'text', nullable: false } },
      ],
    },
    {
      id: 'labels',
      label: 'Labels',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'factId', label: 'Fact ID', role: 'attribute', type: { value: 'text', nullable: false } },
        { id: 'label', label: 'Label', role: 'attribute', type: { value: 'text', nullable: false } },
      ],
    },
  ],
  relationships: [
    {
      id: 'fact-label',
      revision: '1',
      sourceEntity: 'facts',
      targetEntity: 'labels',
      keys: [{ sourceField: 'id', targetField: 'factId' }],
      cardinality: 'many-to-one',
      optional: true,
      joinPolicy: 'validated',
    },
  ],
  meanings: [],
  capabilities: [],
};

const pins = { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest };
const rows = (count: number, payload = 'x'): QueryRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `f${index}`,
    value: index,
    group: `g${index}`,
    sequence: index,
    payload,
  }));
const labelRows = (count: number): QueryRow[] =>
  Array.from({ length: count }, (_, index) => ({ id: `l${index}`, factId: `f${index}`, label: `label-${index}` }));
const source = (facts: readonly QueryRow[], labels: readonly QueryRow[] = []): QuerySource => ({
  revision: 'execution-source',
  catalogRevision: catalog.revision,
  relations: {
    facts: { entity: 'facts', complete: true, rows: facts },
    labels: { entity: 'labels', complete: true, rows: labels },
  },
});

const projection = (extra: Partial<RelationalQuery> = {}): RelationalQuery => ({
  root: 'facts',
  pins,
  select: [{ id: 'id', expression: field('facts', 'id') }],
  ...extra,
});

function planner(limits: Parameters<typeof createQueryPlanner>[0]['limits'] = {}) {
  return unwrap(createQueryPlanner({ catalog, registry, limits }));
}

function planFor(engine: ReturnType<typeof planner>, query: RelationalQuery = projection()) {
  return unwrap(engine.plan(query));
}

function diagnosticCode(result: Outcome<unknown>): string | undefined {
  return result.ok ? undefined : result.diagnostics[0]?.code;
}

describe('bounded query execution budgets', () => {
  it('rejects a source larger than planner maxRows even when filter/projection/top-k output is small', () => {
    const engine = planner({ maxRows: 2, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const query = projection({
      filter: { op: 'compare', left: field('facts', 'value'), comparison: 'gte', right: literal(0) },
      topK: 1,
      orderBy: [{ expression: { kind: 'field', ref: 'id' }, direction: 'asc', nulls: 'last' }],
    });
    const plan = planFor(engine, query);
    const result = engine.evaluate(plan, source(rows(100)));
    expect(result.ok).toBe(false);
    expect(diagnosticCode(result)).toBe('query.budget');
  });

  it('bounds total rows across joined scans instead of applying maxRows per relation', () => {
    const engine = planner({ maxRows: 100, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const query = projection({
      joins: [{ id: 'fact-label', rightEntity: 'labels', relationship: ref('fact-label'), kind: 'left' }],
      select: [
        { id: 'id', expression: field('facts', 'id') },
        { id: 'labelId', expression: field('labels', 'id') },
        { id: 'label', expression: field('labels', 'label') },
      ],
    });
    const plan = planFor(engine, query);
    const result = engine.evaluate(plan, source(rows(60), labelRows(60)));
    expect(result.ok).toBe(false);
    expect(diagnosticCode(result)).toBe('query.budget');
  });

  it('does not let caller context expand configured row, byte or operation limits', () => {
    const rowEngine = planner({ maxRows: 2, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const rowPlan = planFor(rowEngine);
    expect(diagnosticCode(rowEngine.evaluate(rowPlan, source(rows(3)), { maxRows: 100 }))).toBe('query.budget');

    const byteEngine = planner({ maxRows: 10, maxBytes: 64, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const bytePlan = planFor(byteEngine);
    expect(
      diagnosticCode(byteEngine.evaluate(bytePlan, source(rows(1, 'x'.repeat(512)), []), { maxBytes: 1_000_000 })),
    ).toBe('query.budget');

    const operationEngine = planner({ maxRows: 4, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 8 });
    const operationPlan = planFor(operationEngine);
    expect(operationPlan.cost.operations).toBe(8);
    expect(diagnosticCode(operationEngine.evaluate(operationPlan, source(rows(4)), { maxOperations: 1_000_000 }))).toBe(
      'query.budget',
    );
  });

  it('charges row work during scan and projection, grouping, and windows', () => {
    const scanEngine = planner({ maxRows: 4, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000 });
    const scanPlan = planFor(scanEngine);
    expect(
      diagnosticCode(scanEngine.evaluate(scanPlan, source(rows(4)), { maxOperations: scanPlan.cost.operations - 1 })),
    ).toBe('query.budget');

    const groupEngine = planner({ maxRows: 4, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000 });
    const groupPlan = planFor(
      groupEngine,
      projection({
        groupBy: [{ id: 'group', expression: field('facts', 'group') }],
        aggregates: [{ id: 'n', function: ref('core.aggregate.count'), arguments: [field('facts', 'value')] }],
        select: [
          { id: 'group', expression: { kind: 'field', ref: 'group' } },
          { id: 'n', expression: { kind: 'field', ref: 'n' } },
        ],
      }),
    );
    expect(
      diagnosticCode(
        groupEngine.evaluate(groupPlan, source(rows(4)), { maxOperations: groupPlan.cost.operations - 1 }),
      ),
    ).toBe('query.budget');

    const windowEngine = planner({ maxRows: 4, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000 });
    const windowPlan = planFor(
      windowEngine,
      projection({
        windows: [
          {
            id: 'running',
            function: ref('core.window.sum'),
            arguments: [field('facts', 'value')],
            partitionBy: [],
            orderBy: [
              { expression: field('facts', 'sequence'), direction: 'asc', nulls: 'last' },
              { expression: field('facts', 'id'), direction: 'asc', nulls: 'last' },
            ],
            frame: { preceding: 1, following: 0 },
          },
        ],
        select: [
          { id: 'id', expression: field('facts', 'id') },
          { id: 'running', expression: { kind: 'field', ref: 'running' } },
        ],
      }),
    );
    expect(
      diagnosticCode(
        windowEngine.evaluate(windowPlan, source(rows(4)), { maxOperations: windowPlan.cost.operations - 1 }),
      ),
    ).toBe('query.budget');
  });

  it('interrupts row work through an injected monotonic deadline or cancellation view', () => {
    const engine = planner({ maxRows: 100, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const plan = planFor(engine);
    let now = 0;
    const deadline = engine.evaluate(plan, source(rows(100)), { clock: () => now++, maxMilliseconds: 2 });
    expect(diagnosticCode(deadline)).toBe('query.budget');

    const cancellation = { aborted: false };
    let clockReads = 0;
    const cancelled = engine.evaluate(plan, source(rows(100)), {
      cancellation,
      clock: () => {
        clockReads += 1;
        if (clockReads > 5) cancellation.aborted = true;
        return clockReads;
      },
    });
    expect(diagnosticCode(cancelled)).toBe('query.cancelled');
  });

  it('checks source bytes before projection can hide a large raw payload', () => {
    const engine = planner({ maxRows: 10, maxBytes: 1_000_000, maxJoinRows: 1_000, maxOperations: 1_000_000 });
    const plan = planFor(engine);
    const result = engine.evaluate(plan, source(rows(1, 'x'.repeat(512))), { maxBytes: 64 });
    expect(result.ok).toBe(false);
    expect(diagnosticCode(result)).toBe('query.budget');
  });

  it('rejects sparse and accessor-backed source arrays without invoking getters', () => {
    const engine = planner();
    const plan = planFor(engine);
    const sparse = new Array<QueryRow>(1);
    const sparseResult = engine.evaluate(plan, source(sparse));
    expect(sparseResult.ok).toBe(false);

    let accessed = false;
    const accessorRows: QueryRow[] = [];
    Object.defineProperty(accessorRows, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessed = true;
        return rows(1)[0];
      },
    });
    const accessorResult = engine.evaluate(plan, source(accessorRows));
    expect(accessorResult.ok).toBe(false);
    expect(accessed).toBe(false);
  });

  it('keeps standalone evaluateLogicalPlan bounded by default', () => {
    const engine = planner();
    const plan = planFor(
      engine,
      projection({ topK: 1, orderBy: [{ expression: { kind: 'field', ref: 'id' }, direction: 'asc', nulls: 'last' }] }),
    );
    const result = evaluateLogicalPlan(plan, source(rows(10_001)), catalog, registry);
    expect(result.ok).toBe(false);
    expect(diagnosticCode(result)).toBe('query.budget');
  });
});
