import { describe, expect, it } from 'vitest';
import type { Catalog, MeaningDefinition, Result, Scalar, VisualizationSpec } from '../../packages/core/src/index.js';
import {
  compileRelationshipGeometry,
  compileTreeGeometry,
  compileTreemapGeometry,
} from '../../packages/web/src/visualization/hierarchy/geometry.js';
import { result as source } from '../contracts/fixtures.js';

const ref = { id: 'hierarchy', revision: '1', outputId: 'rows', queryDigest: 'q', scopeDigest: 's' } as const;
const text = { value: 'text', nullable: false } as const;
const nullableText = { value: 'text', nullable: true } as const;
const integer = { value: 'integer', nullable: false } as const;
const hierarchyFields = [
  { id: 'id', label: 'ID', role: 'identity' as const, type: text },
  { id: 'parent', label: 'Parent', role: 'attribute' as const, type: nullableText },
  { id: 'label', label: 'Label', role: 'attribute' as const, type: text },
  {
    id: 'amount',
    label: 'Amount',
    role: 'measure' as const,
    type: integer,
    derivation: { id: 'amount', revision: '1' },
  },
];
const hierarchyResult = (rows: number): Result => ({
  ...source,
  ref,
  fields: hierarchyFields,
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: rows, population: { kind: 'unknown' } },
  coverage: { kind: 'unknown', reason: 'Observed rows only' },
});
const input = (
  visualization: VisualizationSpec,
  result: Result,
  rows: readonly Readonly<Record<string, Scalar>>[],
  context: Record<string, unknown> = {},
) => ({
  visualization,
  context: { results: [result], ...context },
  datasets: [{ result: result.ref, rows }],
  label: 'Hierarchy',
  width: 640,
  height: 360,
  maxMarks: 100,
});

const treeSpec = (result: Result): VisualizationSpec => ({
  version: '1',
  view: 'tree',
  result: result.ref,
  node: ['id'],
  parent: ['parent'],
  label: 'label',
});
const treemapSpec = (result: Result): VisualizationSpec => ({
  version: '1',
  view: 'treemap',
  result: result.ref,
  node: ['id'],
  parent: ['parent'],
  label: 'label',
  value: 'amount',
  meaning: { id: 'amount', revision: '1' },
});

const catalogFor = (result: Result): Catalog => ({
  version: '1',
  revision: 'catalog',
  functionRegistryDigest: 'functions-1',
  entities: [{ id: 'nodes', label: 'Nodes', identity: ['id'], rowGrain: ['id'], fields: [hierarchyFields[0]!] }],
  relationships: [],
  capabilities: [],
  meanings: [
    {
      id: 'amount',
      revision: '1',
      label: 'Amount',
      explanation: 'Additive amount',
      output: result.fields.find((field) => field.id === 'amount')?.type ?? integer,
      implementation: { kind: 'host-capability', capability: { id: 'amount', revision: '1' } },
      dependencies: [],
      functionRegistryDigest: 'functions-1',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'reviewed',
      aggregation: 'additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    } as MeaningDefinition,
  ],
});

describe('hierarchy visualization geometry', () => {
  it('materializes a stable tree with parent links and bounded layout', () => {
    const result = hierarchyResult(3);
    const rows = [
      { id: 'root', parent: null, label: 'Root', amount: 3 },
      { id: 'a', parent: 'root', label: 'A', amount: 2 },
      { id: 'b', parent: 'root', label: 'B', amount: 1 },
    ];
    const checked = compileTreeGeometry(input(treeSpec(result), result, rows));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.nodes).toHaveLength(3);
    expect(checked.value.nodes.find((node) => node.identity.includes('a'))?.parentIdentity).toContain('root');
    expect(
      checked.value.nodes.every(
        (node) =>
          node.x >= 0 &&
          node.y >= 0 &&
          node.x + node.width <= checked.value.width + 1e-6 &&
          node.y + node.height <= checked.value.height + 1e-6,
      ),
    ).toBe(true);
    const reversed = compileTreeGeometry(input(treeSpec(result), result, [...rows].reverse()));
    expect(reversed.ok).toBe(true);
    if (reversed.ok)
      expect(reversed.value.nodes.map((node) => [node.identity, node.x, node.y])).toEqual(
        checked.value.nodes.map((node) => [node.identity, node.x, node.y]),
      );
  });

  it.each([
    [
      'duplicate node',
      [
        { id: 'root', parent: null, label: 'Root', amount: 1 },
        { id: 'root', parent: null, label: 'Root again', amount: 1 },
      ],
    ],
    [
      'missing parent',
      [
        { id: 'root', parent: null, label: 'Root', amount: 1 },
        { id: 'child', parent: 'missing', label: 'Child', amount: 1 },
      ],
    ],
    [
      'cycle',
      [
        { id: 'a', parent: 'b', label: 'A', amount: 1 },
        { id: 'b', parent: 'a', label: 'B', amount: 1 },
      ],
    ],
  ])('rejects %s hierarchy rows', (_name, rows) => {
    const result = hierarchyResult(rows.length);
    expect(compileTreeGeometry(input(treeSpec(result), result, rows)).ok).toBe(false);
  });

  it('retains exact rows as a data-only fallback when marks exceed the budget', () => {
    const result = hierarchyResult(3);
    const rows = [
      { id: 'root', parent: null, label: 'Root', amount: 3 },
      { id: 'a', parent: 'root', label: 'A', amount: 2 },
      { id: 'b', parent: 'root', label: 'B', amount: 1 },
    ];
    const checked = compileTreeGeometry(input(treeSpec(result), result, rows));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const dataOnly = compileTreeGeometry({ ...input(treeSpec(result), result, rows), maxMarks: 2 });
    expect(dataOnly.ok).toBe(true);
    if (!dataOnly.ok) return;
    expect(dataOnly.value.state).toBe('data-only');
    expect(dataOnly.value.nodes).toHaveLength(0);
    expect(dataOnly.value.rows).toHaveLength(3);
  });

  it('rejects partial composite parent keys', () => {
    const compositeFields = [
      { id: 'a', label: 'A', role: 'identity' as const, type: text },
      { id: 'b', label: 'B', role: 'identity' as const, type: text },
      { id: 'pa', label: 'Parent A', role: 'attribute' as const, type: nullableText },
      { id: 'pb', label: 'Parent B', role: 'attribute' as const, type: nullableText },
    ];
    const result: Result = {
      ...hierarchyResult(2),
      fields: compositeFields,
      identity: ['a', 'b'],
      rowGrain: ['a', 'b'],
    };
    const spec: VisualizationSpec = {
      version: '1',
      view: 'tree',
      result: result.ref,
      node: ['a', 'b'],
      parent: ['pa', 'pb'],
    };
    const rows = [
      { a: 'root', b: 'one', pa: null, pb: null },
      { a: 'child', b: 'one', pa: 'root', pb: null },
    ];
    expect(compileTreeGeometry(input(spec, result, rows)).ok).toBe(false);
  });

  it('uses an explicit leaf-only treemap value policy and rejects negatives', () => {
    const result = hierarchyResult(2);
    const rows = [
      { id: 'root', parent: null, label: 'Root', amount: 10 },
      { id: 'child', parent: 'root', label: 'Child', amount: 4 },
    ];
    const checked = compileTreemapGeometry(input(treemapSpec(result), result, rows, { catalog: catalogFor(result) }));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.leafValuePolicy).toBe('leaf-only');
    expect(checked.value.nodes).toHaveLength(2);
    expect(checked.value.nodes.find((node) => node.leaf)?.value).toBe(4);
    const negative = [{ id: 'root', parent: null, label: 'Root', amount: -1 }];
    expect(
      compileTreemapGeometry(input(treemapSpec(result), hierarchyResult(1), negative, { catalog: catalogFor(result) }))
        .ok,
    ).toBe(false);
  });

  it('does not invent area for all-zero siblings', () => {
    const result = hierarchyResult(3);
    const rows = [
      { id: 'root', parent: null, label: 'Root', amount: 0 },
      { id: 'a', parent: 'root', label: 'A', amount: 0 },
      { id: 'b', parent: 'root', label: 'B', amount: 0 },
    ];
    const checked = compileTreemapGeometry(input(treemapSpec(result), result, rows, { catalog: catalogFor(result) }));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.state).toBe('geometry');
    expect(checked.value.nodes.every((node) => node.width === 0 || node.height === 0)).toBe(true);
  });

  it.each([
    ['a decimal wider than floating point', { decimal: '9'.repeat(400) }],
    ['a positive decimal smaller than floating point', { decimal: `0.${'0'.repeat(400)}1` }],
  ])('uses the exact table when %s cannot be represented safely', (_name, amount) => {
    const fields = hierarchyFields.map((field) =>
      field.id === 'amount' ? { ...field, type: { value: 'decimal' as const, nullable: false } } : field,
    );
    const result: Result = { ...hierarchyResult(2), fields };
    const rows = [
      { id: 'root', parent: null, label: 'Root', amount },
      { id: 'child', parent: 'root', label: 'Child', amount: { decimal: '1' } },
    ];
    const checked = compileTreemapGeometry(input(treemapSpec(result), result, rows, { catalog: catalogFor(result) }));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.state).toBe('data-only');
    expect(checked.value.nodes).toHaveLength(0);
  });

  it('memoizes subtree weights for a deep and wide hierarchy', () => {
    const leafCount = 9_800;
    const rows: { id: string; parent: string | null; label: string; amount: number }[] = [
      { id: 'root', parent: null, label: 'Root', amount: 1 },
    ];
    let parent = 'root';
    for (let depth = 1; depth < 128; depth += 1) {
      const id = `chain-${depth}`;
      rows.push({ id, parent, label: id, amount: 1 });
      parent = id;
    }
    for (let index = 0; index < leafCount; index += 1) {
      const attach = index % 128 === 0 ? 'root' : `chain-${(index % 127) + 1}`;
      rows.push({ id: `leaf-${index}`, parent: attach, label: `Leaf ${index}`, amount: 1 });
    }
    const result = hierarchyResult(rows.length);
    const checked = compileTreemapGeometry({
      ...input(treemapSpec(result), result, rows, { catalog: catalogFor(result) }),
      maxMarks: 10_000,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.state).toBe('data-only');
    expect(checked.value.reason).toContain('density');
    expect(checked.value.rows).toHaveLength(rows.length);
    expect(checked.value.nodes).toHaveLength(0);
  });

  it('checks relationship endpoint namespaces and declared cardinality', () => {
    const result: Result = {
      ...hierarchyResult(2),
      fields: [
        { id: 'edge', label: 'Edge', role: 'identity', type: text },
        { id: 'source', label: 'Source', role: 'dimension', type: text },
        { id: 'target', label: 'Target', role: 'dimension', type: text },
      ],
      identity: ['edge'],
      rowGrain: ['edge'],
    };
    const relation: Catalog['relationships'][number] = {
      id: 'edge-rel',
      revision: '1',
      sourceEntity: 'sources',
      targetEntity: 'targets',
      keys: [{ sourceField: 'id', targetField: 'id' }],
      cardinality: 'many-to-one' as const,
      optional: false,
      joinPolicy: 'validated' as const,
    };
    const catalog: Catalog = {
      ...catalogFor(result),
      meanings: [],
      entities: [
        {
          id: 'sources',
          label: 'Sources',
          identity: ['id'],
          rowGrain: ['id'],
          fields: [{ id: 'id', label: 'ID', role: 'identity', type: text }],
        },
        {
          id: 'targets',
          label: 'Targets',
          identity: ['id'],
          rowGrain: ['id'],
          fields: [{ id: 'id', label: 'ID', role: 'identity', type: text }],
        },
      ],
      relationships: [relation],
    };
    const spec: VisualizationSpec = {
      version: '1',
      view: 'relationship',
      result: result.ref,
      source: ['source'],
      target: ['target'],
      relationship: { id: relation.id, revision: relation.revision },
    };
    const validRows = [
      { edge: 'e1', source: 's1', target: 't1' },
      { edge: 'e2', source: 's2', target: 't1' },
    ];
    const checked = compileRelationshipGeometry(
      input(spec, result, validRows, {
        catalog,
        relationships: [
          {
            result: result.ref,
            relationship: { id: relation.id, revision: relation.revision },
            source: ['source'],
            target: ['target'],
          },
        ],
      }),
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.nodes.filter((node) => node.namespace === 'source')[0]?.identity).toMatch(/^source:/u);
    expect(checked.value.nodes.filter((node) => node.namespace === 'target')[0]?.identity).toMatch(/^target:/u);
    const invalidRows = [...validRows, { edge: 'e3', source: 's1', target: 't2' }];
    expect(
      compileRelationshipGeometry(
        input(spec, { ...result, counts: { ...result.counts, loaded: 3 } }, invalidRows, {
          catalog,
          relationships: [
            {
              result: result.ref,
              relationship: { id: relation.id, revision: relation.revision },
              source: ['source'],
              target: ['target'],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });
});
