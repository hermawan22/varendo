import { describe, expect, it } from 'vitest';
import { createResultStore, type ResultEvent } from '../../packages/runtime/src/results/index.js';

const key = (requestId: string) => ({
  principalKey: 'principal-a',
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  queryDigest: 'query-1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  sourceRevision: 'source-1',
  outputId: 'rows',
  taskId: 'task-1',
  requestId,
  populationDigest: 'population-1',
});

const ref = {
  id: 'result',
  revision: 'result-1',
  sourceLineage: 'source-1',
  outputId: 'rows',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
};
const loaded: readonly ResultEvent[] = [
  {
    kind: 'descriptor',
    descriptor: {
      version: '1',
      ref,
      taskId: 'task-1',
      fields: [{ id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } }],
      identity: ['id'],
      rowGrain: ['id'],
      counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'population-1' } },
      precision: { kind: 'exact' },
      coverage: { kind: 'complete', populationDigest: 'population-1' },
      consistency: { kind: 'snapshot', snapshotId: 'source-1', sourceRevisions: { rows: 'source-1' } },
      evidence: { kind: 'observed', source: { id: 'rows', revision: 'source-1' } },
      filters: [],
      warnings: [],
      lineage: [],
    },
  },
  { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'authorized-row' }] },
];

describe('result cleanup reentrancy', () => {
  it('clears rows before source cleanup runs during revoke', async () => {
    const store = createResultStore();
    const handle = store.begin(key('revoke'));
    let duringReturn: ReturnType<typeof handle.snapshot> | undefined;
    let index = 0;
    const source: AsyncIterator<unknown> = {
      next: () =>
        index < loaded.length
          ? Promise.resolve({ done: false, value: loaded[index++] })
          : new Promise<IteratorResult<unknown>>(() => {}),
      return: () => {
        duringReturn = handle.snapshot();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    const subscription = handle.subscribe(source);
    await subscription.next();
    await subscription.next();
    expect(handle.snapshot().loadedRows).toBe(1);
    const pending = subscription.next();
    store.revoke({ principalKey: 'principal-a' });
    expect(duringReturn?.status).toBe('denied');
    expect(duringReturn?.loadedRows).toBe(0);
    expect(duringReturn?.batches).toHaveLength(0);
    await expect(pending).resolves.toMatchObject({ done: true });
  });

  it('clears rows before source cleanup runs during dispose', async () => {
    const store = createResultStore();
    const handle = store.begin(key('dispose'));
    let duringReturn: ReturnType<typeof handle.snapshot> | undefined;
    let index = 0;
    const source: AsyncIterator<unknown> = {
      next: () =>
        index < loaded.length
          ? Promise.resolve({ done: false, value: loaded[index++] })
          : new Promise<IteratorResult<unknown>>(() => {}),
      return: () => {
        duringReturn = handle.snapshot();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    const subscription = handle.subscribe(source);
    await subscription.next();
    await subscription.next();
    expect(handle.snapshot().loadedRows).toBe(1);
    const pending = subscription.next();
    store.dispose();
    expect(duringReturn?.status).toBe('disposed');
    expect(duringReturn?.loadedRows).toBe(0);
    expect(duringReturn?.batches).toHaveLength(0);
    await expect(pending).resolves.toMatchObject({ done: true });
  });
});
