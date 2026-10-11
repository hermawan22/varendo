import {
  createStandardFunctionRegistry } from '@varendo/core/expressions';
import type {
  Catalog,
  Outcome,
  QuerySpec,
} from '@varendo/core';
import type {DataRecord, LocalSnapshot, QueryBudget, ReadGrant} from '@varendo/runtime/data';

export function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.code).join(', '));
  return result.value;
}

export const functions = value(createStandardFunctionRegistry('release-scenarios-functions'));

export const catalog = {
  version: '1',
  revision: 'release-scenarios-catalog',
  functionRegistryDigest: functions.digest,
  entities: [{
    id: 'items',
    label: 'Items',
    identity: ['id'],
    rowGrain: ['id'],
    fields: [
      {id: 'id', label: 'ID', role: 'identity', type: {value: 'text', nullable: false}},
      {id: 'owner', label: 'Owner', role: 'attribute', type: {value: 'text', nullable: false}},
      {id: 'amount', label: 'Amount', role: 'measure', type: {value: 'integer', nullable: false}},
    ],
  }],
  relationships: [],
  meanings: [],
  capabilities: [],
} as const satisfies Catalog;

export const rows: readonly DataRecord[] = [
  {id: 'a', owner: 'alice', amount: 2},
  {id: 'b', owner: 'bob', amount: 3},
];

export const source = {
  revision: 'release-scenarios-source',
  catalogRevision: catalog.revision,
  scopeDigest: 'scope-alice',
  policyRevision: 'policy-1',
  relations: {items: {entity: 'items', complete: true, rows}},
};

export const budget: QueryBudget = {
  maxRows: 20,
  maxBytes: 100_000,
  maxMessages: 8,
  maxMilliseconds: 5_000,
  maxColumns: 10,
};

export const query = (overrides: Partial<QuerySpec> = {}): QuerySpec => ({
  entity: 'items',
  fields: ['id', 'owner', 'amount'],
  measures: [],
  relations: [],
  groupBy: [],
  population: {kind: 'all-authorized'},
  order: [],
  ...overrides,
});

export const snapshot = (): LocalSnapshot => ({
  catalog,
  sourceRevision: source.revision,
  records: {items: [...rows]},
});

export const grant = (scopeDigest: string, permitted: ReadonlySet<string>): Outcome<ReadGrant> => ({
  ok: true,
  value: {
    scopeDigest,
    policyRevision: 'policy-1',
    rowPolicy: ({row}) => permitted.has(String(row.id)),
  },
});
