import { describe, expect, it } from 'vitest';
import {
  createFunctionRegistry,
  createQueryFunctionRegistry,
  queryFunctionSignatures,
} from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner, lowerQuerySpec } from '../../packages/core/src/query/index.js';
import type { Catalog, MeaningDefinition, QuerySpec } from '../../packages/core/src/contracts/types.js';
import type { RelationalQuery, QuerySource } from '../../packages/core/src/query/types.js';

const registry = createQueryFunctionRegistry();
if (!registry.ok) throw new Error('query registry fixture failed');
const queryRegistry = registry.value;
const catalog: Catalog = {
  version: '1',
  revision: 'query-catalog-1',
  functionRegistryDigest: queryRegistry.digest,
  entities: [
    {
      id: 'events',
      label: 'Events',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
        { id: 'partition', label: 'Partition', type: { value: 'text', nullable: false }, role: 'attribute' },
        { id: 'sequence', label: 'Sequence', type: { value: 'integer', nullable: false }, role: 'dimension' },
        {
          id: 'recordedOn',
          label: 'Recorded on',
          type: { value: 'date', nullable: false, temporal: { calendar: 'gregorian', timezone: 'UTC', grain: 'day' } },
          role: 'time',
        },
        { id: 'score', label: 'Score', type: { value: 'integer', nullable: false }, role: 'measure' },
        { id: 'value', label: 'Value', type: { value: 'integer', nullable: true }, role: 'measure' },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};
const field = (ref: string) => ({ kind: 'field' as const, entity: 'events', ref });
const source: QuerySource = {
  revision: 'source-1',
  catalogRevision: catalog.revision,
  relations: {
    events: {
      entity: 'events',
      complete: true,
      rows: [
        { id: 'a1', partition: 'A', sequence: 1, recordedOn: '2026-01-01', score: 100, value: 10 },
        { id: 'a2', partition: 'A', sequence: 2, recordedOn: '2026-01-02', score: 100, value: null },
        { id: 'a3', partition: 'A', sequence: 3, recordedOn: '2026-01-03', score: 90, value: 30 },
        { id: 'a4', partition: 'A', sequence: 4, recordedOn: '2026-01-04', score: 80, value: 5 },
        { id: 'b1', partition: 'B', sequence: 1, recordedOn: '2026-01-01', score: 50, value: 7 },
      ],
    },
  },
};
const pins = { catalogRevision: catalog.revision, functionRegistryDigest: queryRegistry.digest };

function literalMeaning(id: string): MeaningDefinition {
  return {
    id,
    revision: '1',
    label: id,
    explanation: id,
    output: { value: 'integer', nullable: false },
    implementation: {
      kind: 'expression',
      expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
    },
    dependencies: [],
    functionRegistryDigest: queryRegistry.digest,
    origin: 'manual',
    lifecycle: 'active',
    scope: 'organization',
    authority: 'approved',
    aggregation: 'none',
    aggregationDimensions: [],
    missingPolicy: 'propagate',
  };
}

function query(catalogRevision = catalog.revision, functionRegistryDigest = queryRegistry.digest): RelationalQuery {
  return {
    root: 'events',
    pins: { catalogRevision, functionRegistryDigest },
    select: [
      { id: 'id', expression: field('id') },
      { id: 'windowSum', expression: { kind: 'field', ref: 'windowSum' } },
      { id: 'rank', expression: { kind: 'field', ref: 'rank' } },
    ],
    windows: [
      {
        id: 'windowSum',
        function: { id: 'core.window.sum', revision: '1' },
        arguments: [field('value')],
        partitionBy: [field('partition')],
        orderBy: [
          { expression: field('sequence'), direction: 'asc', nulls: 'last' },
          { expression: field('id'), direction: 'asc', nulls: 'last' },
        ],
        frame: { preceding: 1, following: 1 },
      },
      {
        id: 'rank',
        function: { id: 'core.window.rank', revision: '1' },
        arguments: [],
        partitionBy: [field('partition')],
        orderBy: [
          { expression: field('score'), direction: 'desc', nulls: 'last' },
          { expression: field('id'), direction: 'asc', nulls: 'last' },
        ],
        frame: { preceding: 0, following: 0 },
      },
    ],
  };
}

describe('bounded query planner/evaluator', () => {
  it('rejects catalog meanings with missing or unlisted dependencies', () => {
    const missing = { ...literalMeaning('missing'), dependencies: [{ id: 'unknown', revision: '1' }] };
    expect(createQueryPlanner({ catalog: { ...catalog, meanings: [missing] }, registry: queryRegistry })).toMatchObject(
      {
        ok: false,
        diagnostics: [{ code: 'semantic.unknown-dependency' }],
      },
    );

    const listed = literalMeaning('listed');
    const unlisted: MeaningDefinition = {
      ...literalMeaning('unlisted'),
      implementation: { kind: 'expression', expression: { kind: 'definition', ref: { id: 'listed', revision: '1' } } },
    };
    expect(
      createQueryPlanner({ catalog: { ...catalog, meanings: [listed, unlisted] }, registry: queryRegistry }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.unlisted-dependency' }],
    });
  });

  it('fully validates supplied definitions against the complete meaning set', () => {
    const external = literalMeaning('external');
    const catalogDependent: MeaningDefinition = {
      ...literalMeaning('catalog-dependent'),
      implementation: {
        kind: 'expression',
        expression: { kind: 'definition', ref: { id: 'external', revision: '1' } },
      },
      dependencies: [{ id: 'external', revision: '1' }],
    };
    expect(
      createQueryPlanner({
        catalog: { ...catalog, meanings: [catalogDependent] },
        registry: queryRegistry,
        definitions: [external],
      }),
    ).toMatchObject({ ok: true });

    const suppliedDependent: MeaningDefinition = {
      ...literalMeaning('supplied-dependent'),
      implementation: {
        kind: 'expression',
        expression: { kind: 'definition', ref: { id: 'external', revision: '1' } },
      },
      dependencies: [{ id: 'external', revision: '1' }],
    };
    expect(
      createQueryPlanner({ catalog, registry: queryRegistry, definitions: [suppliedDependent, external] }),
    ).toMatchObject({ ok: true });

    const unlisted: MeaningDefinition = {
      ...literalMeaning('unlisted-supplied'),
      implementation: {
        kind: 'expression',
        expression: { kind: 'definition', ref: { id: 'external', revision: '1' } },
      },
    };
    expect(createQueryPlanner({ catalog, registry: queryRegistry, definitions: [unlisted, external] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'semantic.unlisted-dependency' }],
    });
  });

  it('carries semi-additive partition dimensions into a trusted query binding', () => {
    const balance: MeaningDefinition = {
      ...literalMeaning('partitioned-balance'),
      output: { value: 'integer', nullable: true, grain: ['id'] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [field('score')],
        },
      },
      aggregation: 'semi-additive',
      aggregationDimensions: ['id'],
    };
    const lowered = lowerQuerySpec(
      {
        entity: 'events',
        fields: ['id', 'recordedOn'],
        measures: [{ id: balance.id, revision: balance.revision }],
        relations: [],
        groupBy: ['id', 'recordedOn'],
        population: { kind: 'all-authorized' },
        order: [],
        timeBucket: { field: 'recordedOn', grain: 'month', calendar: 'gregorian', timezone: 'UTC' },
      },
      { ...catalog, meanings: [balance] },
      queryRegistry,
      [],
    );
    expect(lowered).toMatchObject({
      ok: true,
      value: {
        aggregates: [{ semantics: { aggregationDimensions: ['id'] } }],
        groupBy: [{ id: 'id' }, { id: 'recordedOn' }],
      },
    });
  });

  it('executes window null propagation and competition rank', () => {
    const planner = createQueryPlanner({ catalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(query());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((row) => row.rank)).toEqual([1, 1, 3, 4, 1]);
    expect(result.value.rows.map((row) => row.windowSum)).toEqual([null, null, null, 35, 7]);
  });

  it('rejects an altered plan even when its canonical strings are retained', () => {
    const planner = createQueryPlanner({ catalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(query());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const altered = {
      ...plan.value,
      nodes: plan.value.nodes.map((node, index) =>
        index === 0 && node.op === 'scan' ? { ...node, entity: 'forged' } : node,
      ),
    };
    const result = planner.value.evaluate(altered, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('query.plan');
  });

  it('snapshots caller-owned query input and deeply freezes the accepted plan', () => {
    const planner = createQueryPlanner({ catalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const input = query();
    const plan = planner.value.plan(input);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const canonical = plan.value.canonical;
    (input.select as unknown as Array<{ id: string }>)[0]!.id = 'forged';
    (input.windows as unknown as Array<{ frame: { preceding: number; following: number } }>)[0]!.frame.preceding = 99;
    expect(plan.value.canonical).toBe(canonical);
    expect(plan.value.nodes[0]?.op).toBe('scan');
    expect(Object.isFrozen(plan.value)).toBe(true);
    expect(Object.isFrozen(plan.value.nodes)).toBe(true);
    expect(Object.isFrozen(plan.value.nodes[0])).toBe(true);
    expect(Object.isFrozen(plan.value.nodes[0]?.inputs)).toBe(true);
  });

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid maxRows execution budget %s', (maxRows) => {
    const planner = createQueryPlanner({ catalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(query());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, source, { maxRows });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('query.budget');
  });

  it('does not execute a redefined trusted function reference', () => {
    const redefined = createFunctionRegistry({
      digest: 'redefined-query',
      signatures: queryFunctionSignatures.map((signature) =>
        signature.ref.id === 'core.add'
          ? { ...signature, operation: 'divide' as const, zeroDenominator: 'null' as const }
          : signature,
      ),
    });
    expect(redefined.ok).toBe(true);
    if (!redefined.ok) return;
    const redefinedCatalog = { ...catalog, functionRegistryDigest: redefined.value.digest };
    const planner = createQueryPlanner({ catalog: redefinedCatalog, registry: redefined.value });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(query(redefinedCatalog.revision, redefined.value.digest));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('query.unsupported');
  });

  it('evaluates approved aggregate expression trees at group grain', () => {
    const aggregateQuery: RelationalQuery = {
      root: 'events',
      pins,
      groupBy: [{ id: 'partition', expression: field('partition') }],
      select: [
        { id: 'partition', expression: field('partition') },
        { id: 'net', expression: { kind: 'field', ref: 'net' } },
      ],
      aggregates: [
        {
          id: 'net',
          function: { id: 'core.subtract', revision: '1' },
          arguments: [
            { kind: 'call', function: { id: 'core.aggregate.sum', revision: '1' }, arguments: [field('score')] },
            { kind: 'call', function: { id: 'core.aggregate.sum', revision: '1' }, arguments: [field('sequence')] },
          ],
        },
      ],
    };
    const planner = createQueryPlanner({ catalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(aggregateQuery);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, source);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.rows.map((row) => [row.partition, row.net])).toEqual([
        ['A', 360],
        ['B', 49],
      ]);
  });

  it('lowers QuerySpec meanings without discarding aggregate expression trees', () => {
    const meaningCatalog: Catalog = {
      ...catalog,
      meanings: [
        {
          id: 'net',
          revision: '1',
          label: 'Net',
          explanation: 'Revenue minus cost',
          output: { value: 'integer', nullable: true },
          implementation: {
            kind: 'expression',
            expression: {
              kind: 'call',
              function: { id: 'core.subtract', revision: '1' },
              arguments: [
                { kind: 'call', function: { id: 'core.aggregate.sum', revision: '1' }, arguments: [field('score')] },
                { kind: 'call', function: { id: 'core.aggregate.sum', revision: '1' }, arguments: [field('sequence')] },
              ],
            },
          },
          dependencies: [],
          functionRegistryDigest: queryRegistry.digest,
          origin: 'manual',
          lifecycle: 'active',
          scope: 'organization',
          authority: 'approved',
          aggregation: 'additive',
          aggregationDimensions: [],
          missingPolicy: 'propagate',
        },
      ],
    };
    const querySpec: QuerySpec = {
      entity: 'events',
      fields: ['partition'],
      measures: [{ id: 'net', revision: '1' }],
      relations: [],
      groupBy: ['partition'],
      population: { kind: 'all-authorized' },
      order: [],
    };
    const planner = createQueryPlanner({ catalog: meaningCatalog, registry: queryRegistry });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan(querySpec);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, source);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.rows.map((row) => [row.partition, row.net])).toEqual([
        ['A', 360],
        ['B', 49],
      ]);
  });
});
