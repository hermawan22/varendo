import { expect, it } from 'vitest';
import { createStandardFunctionRegistry } from '../../../packages/core/dist/expressions/index.js';
import type { Catalog, Task } from '../../../packages/core/dist/index.js';
import { createResultStore } from '../../../packages/runtime/dist/results/index.js';
import { createRegionStore, type RegionAuthority } from '../../../packages/runtime/dist/regions/index.js';
import { createAgentBinder } from '../../../packages/agent/dist/binder.js';
import { containAgentProposal } from '../../../packages/agent/dist/loop.js';

async function setup() {
  const registry = createStandardFunctionRegistry();
  if (!registry.ok) throw Error('registry');
  const digest = registry.value.digest;
  const ref = {
    id: 'result',
    revision: 'source',
    sourceLineage: 'source',
    outputId: 'rows',
    queryDigest: 'query',
    scopeDigest: 'scope',
  };
  const catalog: Catalog = {
    version: '1',
    revision: 'catalog',
    functionRegistryDigest: digest,
    entities: [],
    relationships: [],
    meanings: [],
    capabilities: [],
  };
  const authority: RegionAuthority = {
    principalKey: 'principal',
    scopeDigest: 'scope',
    policyRevision: 'policy',
    catalogRevision: 'catalog',
    experienceRevision: 'experience',
    functionRegistryDigest: digest,
    results: [ref],
  };
  const task: Task = {
    version: '1',
    id: 'task',
    revision: '1',
    regionId: 'region',
    catalogRevision: 'catalog',
    functionRegistryDigest: digest,
    goal: 'Keep the current rows visible',
    kind: 'presentation',
    inputs: [ref],
    needs: [],
    assumptions: [],
  };
  let live = true;
  const results = createResultStore();
  const result = results.begin({
    principalKey: 'principal',
    scopeDigest: 'scope',
    policyRevision: 'policy',
    catalogRevision: 'catalog',
    functionRegistryDigest: digest,
    sourceRevision: 'source',
    sourceLineage: 'source',
    queryDigest: 'query',
    outputId: 'rows',
    taskId: 'task',
    requestId: 'result',
    populationDigest: 'population',
  });
  async function* events() {
    yield {
      kind: 'descriptor',
      descriptor: {
        version: '1',
        ref,
        taskId: 'task',
        fields: [{ id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' }],
        identity: ['id'],
        rowGrain: ['id'],
        counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'population' } },
        precision: { kind: 'exact' },
        coverage: { kind: 'complete', populationDigest: 'population' },
        consistency: { kind: 'snapshot', snapshotId: 'snapshot', sourceRevisions: { source: 'source' } },
        evidence: { kind: 'observed', source: { id: 'source', revision: 'source' } },
        filters: [],
        warnings: [],
        lineage: [],
      },
    };
    yield { kind: 'batch', result: ref, sequence: 0, rows: [{ id: 'a' }] };
    yield { kind: 'complete', result: ref, finalCoverage: { kind: 'complete', populationDigest: 'population' } };
  }
  for await (const _ of result.subscribe(events())) {
  }
  const regions = createRegionStore({
    readAuthority: () => ({ ok: true, value: authority }),
    authorizeCommit: () => ({ ok: true, value: undefined }),
  });
  const created = regions.create({ id: 'region', state: { task } });
  if (!created.ok) throw Error(created.diagnostics[0].message);
  const region = created.value;
  const publication = await region.publishData({ resultHandles: [result] });
  if (!publication.ok) throw Error(publication.diagnostics[0].message);
  const current = () => {
    const { dataRevision: _, ...pins } = region.snapshot().readSet!;
    return pins;
  };
  const binder = createAgentBinder({
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: 'principal',
          regionId: 'region',
          goalEpoch: 'goal',
          current: current(),
          catalog,
          functionRegistry: registry.value,
          grants: live ? ['catalog.read', 'task.propose', 'result.inspect'] : [],
        },
      }),
    },
  });
  const proposal = {
    requestId: 'proposal',
    targetRegionId: 'region',
    effect: 'read',
    preconditions: current(),
    value: task,
  };
  return {
    region,
    result,
    results,
    binder,
    proposal,
    task,
    revoke() {
      live = false;
      results.revoke({ principalKey: 'principal' });
      region.revoke('Host revoked authorization');
    },
    dispose() {
      regions.dispose();
      results.dispose();
    },
  };
}
const budget = { maxTurns: 3, maxRepairs: 1, maxMilliseconds: 1000, maxProposalBytes: 65536 };
it('retains the actual incumbent and manual controls when the model is unavailable', async () => {
  const f = await setup();
  const before = f.region.snapshot();
  const rows = f.result.snapshot().batches;
  const stopped = await containAgentProposal({
    requestId: 'loop',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    budget,
    propose: () => {
      throw Error('model offline');
    },
    binder: f.binder,
  });
  expect(stopped.ok && stopped.value.stop).toBe('unavailable');
  expect(f.region.snapshot().state).toEqual(before.state);
  expect(f.result.snapshot().batches).toBe(rows);
  const staged = await f.region.stage({
    requestId: 'manual',
    expected: f.region.snapshot().readSet!,
    state: { task: { ...f.task, revision: '2', goal: 'Manually adjusted' } },
    resultHandles: [f.result],
  });
  if (!staged.ok) throw Error(staged.diagnostics[0].message);
  const committed = await f.region.commit(staged.value);
  expect(committed.ok).toBe(true);
  expect(f.region.snapshot().state?.task.goal).toBe('Manually adjusted');
  f.dispose();
});
it('real binder failure and successful binding both leave the region uncommitted', async () => {
  const f = await setup();
  const before = f.region.snapshot();
  const invalid = await containAgentProposal({
    requestId: 'loop',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    budget,
    initial: { ...f.proposal, actor: 'model' },
    propose: () => ({ ...f.proposal, actor: 'model' }),
    binder: f.binder,
  });
  expect(invalid.ok && invalid.value.stop).toBe('no-progress');
  const bound = await containAgentProposal({
    requestId: 'loop',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    budget,
    initial: f.proposal,
    propose: () => {
      throw Error('unexpected producer');
    },
    binder: f.binder,
  });
  expect(bound).toMatchObject({ ok: true, value: { stop: 'complete' } });
  expect(f.region.snapshot().regionRevision).toBe(before.regionRevision);
  expect(f.region.snapshot().state).toEqual(before.state);
  expect(f.result.snapshot().loadedRows).toBe(1);
  f.dispose();
});
it('host revocation clears the incumbent even while a producer ignores cancellation', async () => {
  const f = await setup();
  const timer = setTimeout(() => f.revoke(), 5);
  try {
    const stopped = await containAgentProposal({
      requestId: 'loop',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      budget: { ...budget, maxMilliseconds: 30 },
      propose: () => new Promise(() => {}),
      binder: f.binder,
    });
    expect(stopped.ok && stopped.value.stop).toBe('time-budget');
    expect(f.region.snapshot().state).toBeUndefined();
    expect(f.region.snapshot().status).toBe('revoked');
    expect(f.result.snapshot().batches).toHaveLength(0);
  } finally {
    clearTimeout(timer);
    f.dispose();
  }
});
