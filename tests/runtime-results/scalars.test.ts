import { expect, it } from 'vitest';
import {
  createResultStore,
  type ResultBeginInput,
  type ResultEvent,
} from '../../packages/runtime/src/results/index.js';
const key: ResultBeginInput = {
  principalKey: 'a',
  scopeDigest: 'scope',
  policyRevision: 'policy',
  queryDigest: 'query',
  catalogRevision: 'catalog',
  functionRegistryDigest: 'registry',
  sourceRevision: 'source',
  outputId: 'rows',
  taskId: 'task',
  requestId: 'request',
  populationDigest: 'population',
};
const ref = {
  id: 'result',
  revision: 'source',
  sourceLineage: 'source',
  outputId: 'rows',
  queryDigest: 'query',
  scopeDigest: 'scope',
};
async function accept(ids: readonly string[]) {
  const handle = createResultStore().begin(key);
  const coverage = { kind: 'complete', populationDigest: 'population' } as const;
  const events: ResultEvent[] = [
    {
      kind: 'descriptor',
      descriptor: {
        version: '1',
        ref,
        taskId: 'task',
        fields: [{ id: 'id', label: 'Instant', role: 'identity', type: { value: 'instant', nullable: false } }],
        identity: ['id'],
        rowGrain: ['id'],
        counts: {
          loaded: ids.length,
          population: { kind: 'exact', value: ids.length, populationDigest: 'population' },
        },
        precision: { kind: 'exact' },
        coverage,
        consistency: { kind: 'snapshot', snapshotId: 'source', sourceRevisions: { events: 'source' } },
        evidence: { kind: 'observed', source: { id: 'events', revision: 'source' } },
        filters: [],
        warnings: [],
        lineage: [],
      },
    },
    { kind: 'batch', result: ref, sequence: 0, rows: ids.map((id) => ({ id })) },
    { kind: 'complete', result: ref, finalCoverage: coverage },
  ];
  async function* stream() {
    yield* events;
  }
  for await (const _ of handle.subscribe(stream())) {
    /* consume validated updates */
  }
  return handle.snapshot();
}
it('preserves supported submillisecond identity precision through the result store', async () => {
  const result = await accept(['2026-01-01T00:00:00.000001Z', '2026-01-01T00:00:00.000002Z']);
  expect(result.status).toBe('ready');
  expect(result.loadedRows).toBe(2);
});
it('rejects equivalent instant identities across offset and fraction spellings', async () => {
  const result = await accept(['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00']);
  expect(result.status).toBe('failed');
  expect(result.diagnostics[0]?.code).toBe('data.result-identity');
});
