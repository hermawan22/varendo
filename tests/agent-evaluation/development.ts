import { createStandardFunctionRegistry } from '@varendo/core/expressions';
import type { Task } from '@varendo/core';
import type { EvaluationFixture } from './host.js';
const registry = createStandardFunctionRegistry();
if (!registry.ok) throw Error('registry');
export const fixture: EvaluationFixture = {
  id: 'development-records',
  principalKey: 'fixture-principal',
  regionId: 'eval-region',
  goalEpoch: 'goal-1',
  scopeDigest: 'scope-1',
  sourceRevision: 'source-1',
  budget: { maxRows: 10, maxBytes: 100_000, maxMessages: 8, maxMilliseconds: 5000, maxColumns: 8 },
  catalog: {
    version: '1',
    revision: 'catalog-1',
    functionRegistryDigest: registry.value.digest,
    entities: [
      {
        id: 'items',
        label: 'Synthetic items',
        identity: ['id'],
        rowGrain: ['id'],
        fields: [
          { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
          { id: 'group', label: 'Group', role: 'dimension', type: { value: 'text', nullable: false } },
          { id: 'value', label: 'Value', role: 'measure', type: { value: 'integer', nullable: false } },
        ],
      },
    ],
    relationships: [],
    meanings: [],
    capabilities: [],
  },
  records: {
    items: [
      { id: 'a', group: 'A', value: 9 },
      { id: 'b', group: 'B', value: 2 },
      { id: 'c', group: 'A', value: 5 },
    ],
  },
};
export const task: Task = {
  version: '1',
  id: 'task-1',
  revision: '1',
  regionId: fixture.regionId,
  catalogRevision: fixture.catalog.revision,
  functionRegistryDigest: fixture.catalog.functionRegistryDigest,
  goal: 'Show group A',
  needs: [],
  assumptions: [],
  kind: 'data',
  outputs: [
    {
      id: 'main',
      kind: 'query',
      dependsOn: [],
      delivery: 'eager',
      query: {
        entity: 'items',
        fields: ['id', 'value'],
        measures: [],
        relations: [],
        groupBy: [],
        population: { kind: 'all-authorized' },
        where: { op: 'compare', field: 'group', comparison: 'eq', value: 'A' },
        order: [{ field: 'value', direction: 'desc', nulls: 'last' }],
      },
    },
  ],
};

export const developmentCase = {
  id: 'development-records',
  partition: 'development',
  independentAuthor: 'root developer fixture; not independent',
  exposure: 'Development fixture; never a held-out headline result.',
  prompt: 'Show group A items in descending order of value, with ID and value.',
  fixture,
  explicitTask: task,
  expected: [
    {
      id: 'main',
      fields: ['id', 'value'],
      grain: ['id'],
      rows: [
        { id: 'a', value: 9 },
        { id: 'c', value: 5 },
      ],
      orderMatters: true,
      coverage: 'complete',
      quality: {
        identity: ['id'],
        populationCount: 2,
        precision: 'exact',
        sourceRevisions: { items: 'source-1' },
        evidenceKind: 'observed',
        definitions: [],
      },
    },
  ],
} as const;
