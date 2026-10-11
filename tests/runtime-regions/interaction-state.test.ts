import { describe, expect, it } from 'vitest';
import type { InteractionState, Task } from '../../packages/core/src/index.js';
import { createRegionStore } from '../../packages/runtime/src/regions/index.js';

const ref = { id: 'result', revision: '1', outputId: 'employees', queryDigest: 'query', scopeDigest: 'scope' } as const;
const task: Task = {
  version: '1',
  id: 'task',
  revision: '1',
  regionId: 'region',
  catalogRevision: 'catalog',
  functionRegistryDigest: 'functions',
  goal: 'View employees',
  needs: [],
  assumptions: [],
  kind: 'presentation',
  inputs: [],
};
const state: InteractionState = {
  version: '1',
  values: [
    {
      nodeId: 'table',
      portId: 'selection',
      payload: { kind: 'selection', selection: { mode: 'ids', entity: 'employees', keys: ['e1'], result: ref } },
    },
  ],
  drafts: [
    {
      domain: 'employee-records',
      entity: 'employees',
      key: 'e1',
      field: 'name',
      value: 'private-draft-value',
      entityRevision: '1',
    },
  ],
};
const setup = () => {
  const authority = {
    principalKey: 'principal',
    scopeDigest: 'scope',
    policyRevision: 'policy',
    catalogRevision: 'catalog',
    experienceRevision: 'experience',
    functionRegistryDigest: 'functions',
    results: [ref],
  };
  const store = createRegionStore({
    readAuthority: () => ({ ok: true, value: authority }),
    authorizeCommit: () => ({ ok: true, value: undefined }),
  });
  const created = store.create({ id: 'region', state: { task, interaction: state } });
  if (!created.ok) throw new Error(created.diagnostics[0]!.message);
  return { store, region: created.value };
};

describe('interaction state in region transactions', () => {
  it('publishes interaction values atomically with the region and preserves them across layout changes', async () => {
    const { region } = setup();
    const changed = { ...state, drafts: [{ ...state.drafts[0]!, value: 'edited-draft' }] };
    const observed: unknown[] = [];
    region.observe((update) => {
      observed.push(update.snapshot.state?.interaction);
      expect(region.snapshot().state?.interaction).toBe(update.snapshot.state?.interaction);
    });
    const staged = await region.stage({
      requestId: 'edit',
      expected: region.snapshot().readSet!,
      state: { task, interaction: changed },
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect((await region.commit(staged.value)).ok).toBe(true);
    expect(observed).toEqual([changed]);
    const layout = await region.stage({
      requestId: 'layout',
      expected: region.snapshot().readSet!,
      state: {
        task: { ...region.snapshot().state!.task, viewPreference: { representation: 'table', strength: 'explicit' } },
      },
    });
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect((await region.commit(layout.value)).ok).toBe(true);
    expect(region.snapshot().state?.interaction).toEqual(changed);
    expect(region.snapshot().state?.interaction?.drafts[0]).not.toHaveProperty('conflict');
  });

  it('derives result dependencies from retained selection and excludes drafts from metadata export', async () => {
    const { region } = setup();
    expect(JSON.stringify(region.export())).not.toContain('private-draft-value');
    expect(region.export()).not.toHaveProperty('interaction');
    const omitted = await region.stage({
      requestId: 'omitted-ref',
      expected: { ...region.snapshot().readSet!, results: [] },
      state: { task },
    });
    expect(omitted.ok).toBe(false);
    const forged = await region.stage({
      requestId: 'forged-state',
      expected: region.snapshot().readSet!,
      state: { task, interaction: { ...state, approved: true } },
    } as never);
    expect(forged.ok).toBe(false);
  });

  it('clears state on reentrant revocation and accepts explicit state clearing', async () => {
    const { region } = setup();
    const cleared = await region.stage({
      requestId: 'clear',
      expected: region.snapshot().readSet!,
      state: { task, interaction: { version: '1', values: [], drafts: [] } },
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect((await region.commit(cleared.value)).ok).toBe(true);
    expect(region.snapshot().state?.interaction).toEqual({ version: '1', values: [], drafts: [] });
    const changed = await region.stage({
      requestId: 'revoke-during-notify',
      expected: region.snapshot().readSet!,
      state: { task, interaction: state },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    region.observe((update) => {
      if (update.kind === 'commit') region.revoke();
    });
    await region.commit(changed.value);
    expect(region.snapshot()).toMatchObject({ status: 'revoked' });
    expect(region.snapshot().state).toBeUndefined();
  });
});
