import { type Catalog, type QuerySpec, type Result, type ResultRef } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import type { DataRecord, LocalSnapshot, QueryBudget } from '../../packages/runtime/src/data/index.js';
import { collectResultEvents } from '../../packages/testkit/src/index.js';

const registry = createStandardFunctionRegistry();
if (!registry.ok) throw new Error('The standard function registry is unavailable.');

export const functionRegistryDigest = registry.value.digest;

export const securityCatalog: Catalog = {
  version: '1',
  revision: 'security-catalog-1',
  functionRegistryDigest,
  entities: [
    {
      id: 'employees',
      label: 'Employees',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'Employee ID', type: { value: 'text', nullable: false }, role: 'identity' },
        { id: 'owner', label: 'Owner', type: { value: 'text', nullable: false }, role: 'attribute' },
        { id: 'secret', label: 'Secret', type: { value: 'text', nullable: false }, role: 'attribute' },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

export const securityRows: readonly DataRecord[] = [
  { id: 'row-alice', owner: 'alice', secret: 'alice-secret' },
  { id: 'row-bob', owner: 'bob', secret: 'bob-secret' },
];

export const budget: QueryBudget = {
  maxRows: 20,
  maxBytes: 256_000,
  maxMessages: 8,
  maxMilliseconds: 10_000,
  maxColumns: 8,
};

export function query(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    entity: 'employees',
    fields: ['id', 'owner', 'secret'],
    measures: [],
    relations: [],
    groupBy: [],
    population: { kind: 'all-authorized' },
    order: [],
    ...overrides,
  };
}

export function snapshot(
  rows: readonly DataRecord[] = securityRows,
  sourceRevision = 'security-source-1',
): LocalSnapshot {
  return { catalog: securityCatalog, sourceRevision, records: { employees: rows } };
}

export const collect = collectResultEvents;

export function resultRef(overrides: Partial<ResultRef> = {}): ResultRef {
  return {
    id: 'security-result',
    revision: 'security-result-1',
    outputId: 'rows',
    queryDigest: 'security-query',
    scopeDigest: 'scope-alice',
    ...overrides,
  };
}

export function resultDescriptor(ref: ResultRef = resultRef()): Result {
  const text = { value: 'text' as const, nullable: false };
  return {
    version: '1',
    ref,
    taskId: 'security-task',
    fields: [
      { id: 'id', label: 'ID', type: text, role: 'identity' },
      { id: 'owner', label: 'Owner', type: text, role: 'attribute' },
      { id: 'secret', label: 'Secret', type: text, role: 'attribute' },
    ],
    identity: ['id'],
    rowGrain: ['id'],
    counts: { loaded: 2, population: { kind: 'exact', value: 2, populationDigest: 'security-population' } },
    precision: { kind: 'exact' },
    coverage: { kind: 'complete', populationDigest: 'security-population' },
    consistency: {
      kind: 'snapshot',
      snapshotId: 'security-source-1',
      sourceRevisions: { source: 'security-source-1' },
    },
    evidence: { kind: 'observed', source: { id: 'source', revision: 'security-source-1' } },
    filters: [],
    warnings: [],
    lineage: [],
  };
}
