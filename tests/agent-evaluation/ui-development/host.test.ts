import { describe, expect, it } from 'vitest';
import { createUiDevelopmentHost, task, type UiDevelopmentHost } from './host.js';

type Receipt = Awaited<ReturnType<UiDevelopmentHost['propose']>>;

function requirePlan(host: UiDevelopmentHost) {
  const plan = host.plan();
  if (!plan.ok) throw new Error(plan.diagnostics[0]?.message ?? 'The development plan was not produced.');
  return plan.value;
}

function requireProposal(outcome: Receipt): {
  readonly proposalId: string;
  readonly regionRevision: string;
  readonly materializationVersion: number;
} {
  if (!outcome.ok) throw new Error(outcome.diagnostics[0]?.message ?? 'The development proposal was not produced.');
  expect(outcome.value.state, JSON.stringify(outcome.value.diagnostics)).toBe('bound');
  const value = outcome.value.value;
  if (value === undefined || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The bound proposal payload is missing.');
  const proposal = value as {
    readonly proposalId?: unknown;
    readonly regionRevision?: unknown;
    readonly materializationVersion?: unknown;
  };
  if (
    typeof proposal.proposalId !== 'string' ||
    typeof proposal.regionRevision !== 'string' ||
    typeof proposal.materializationVersion !== 'number'
  )
    throw new Error('The bound proposal payload is incomplete.');
  return {
    proposalId: proposal.proposalId,
    regionRevision: proposal.regionRevision,
    materializationVersion: proposal.materializationVersion,
  };
}

async function evaluate(host: UiDevelopmentHost): Promise<void> {
  const evaluated = await host.evaluateTask(task);
  if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message ?? 'The development task did not evaluate.');
  expect(evaluated.value.state).toBe('data-ready');
}

async function commitPlan(host: UiDevelopmentHost): Promise<{ readonly proposalId: string; readonly state: string }> {
  const plan = requirePlan(host);
  const proposal = requireProposal(await host.propose(plan));
  const committed = await host.commit(proposal.proposalId);
  if (!committed.ok) throw new Error(committed.diagnostics[0]?.message ?? 'The development proposal did not commit.');
  return { proposalId: proposal.proposalId, state: committed.value.state };
}

describe('development deterministic UI completion seam', () => {
  it('evaluates an authorized task, validates a proposal payload, and commits through the region', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      expect(host.outputs()).toHaveLength(1);
      const before = host.region.snapshot();
      const plan = requirePlan(host);
      const proposal = requireProposal(await host.propose(plan));
      expect(proposal.regionRevision).toBe(before.regionRevision);
      expect(proposal.materializationVersion).toBeGreaterThan(0);

      const committed = await host.commit(proposal.proposalId);
      expect(committed.ok).toBe(true);
      if (!committed.ok) throw new Error(committed.diagnostics[0]?.message ?? 'The presentation did not commit.');
      expect(committed.value.state).toBe('renderer-ready');
      expect(host.region.snapshot().state?.presentation?.nodes).toHaveLength(2);
      expect(host.observations.map((observation) => `${observation.stage}:${observation.status}`)).toEqual([
        'evaluate:data-ready',
        'propose:bound',
        'commit:renderer-ready',
      ]);
    } finally {
      host.dispose();
    }
  });

  it('keeps the committed region and read set unchanged while a fresh evaluation is prospective', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      expect((await commitPlan(host)).state).toBe('renderer-ready');
      const before = host.region.snapshot();
      const beforePresentation = before.state?.presentation;
      await evaluate(host);
      const after = host.region.snapshot();
      expect(after.regionRevision).toBe(before.regionRevision);
      expect(after.dataRevision).toBe(before.dataRevision);
      expect(after.state?.presentation).toEqual(beforePresentation);
      expect(host.outputs()).toHaveLength(1);
      expect(host.observations.filter((observation) => observation.stage === 'evaluate')).toHaveLength(2);
    } finally {
      host.dispose();
    }
  });

  it('rejects a concurrent evaluation without replacing the prospective generation', async () => {
    const host = createUiDevelopmentHost();
    try {
      const [first, second] = await Promise.all([host.evaluateTask(task), host.evaluateTask(task)]);
      const receipts = [first, second].filter(
        (receipt): receipt is Extract<typeof receipt, { ok: true }> => receipt.ok,
      );
      expect(receipts).toHaveLength(2);
      const states = receipts.map((receipt) => receipt.value.state);
      expect(states.filter((state) => state === 'data-ready')).toHaveLength(1);
      expect(states.filter((state) => state === 'stale')).toHaveLength(1);
      const stale = receipts.find((receipt) => receipt.value.state === 'stale');
      expect(stale?.value.diagnostics?.map((item) => item.code)).toContain('ui-development.concurrent');
      expect(host.observations.filter((observation) => observation.stage === 'evaluate')).toHaveLength(1);
      expect(host.region.snapshot().readSet?.results).toHaveLength(0);
    } finally {
      host.dispose();
    }
  });

  it('rejects malformed proposals while preserving the committed region', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      expect((await commitPlan(host)).state).toBe('renderer-ready');
      const before = host.region.snapshot();
      const beforePresentation = before.state?.presentation;
      const malformed = await host.propose({ version: '1', id: 'bad', revision: '1' });
      expect(malformed.ok).toBe(true);
      if (!malformed.ok)
        throw new Error(malformed.diagnostics[0]?.message ?? 'The malformed proposal could not be inspected.');
      expect(malformed.value.state).toBe('invalid');
      const after = host.region.snapshot();
      expect(after.regionRevision).toBe(before.regionRevision);
      expect(after.state?.presentation).toEqual(beforePresentation);
    } finally {
      host.dispose();
    }
  });

  it('rejects a superseded proposal after a newer evaluation without clearing the incumbent', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      const first = requireProposal(await host.propose(requirePlan(host)));
      await evaluate(host);
      const stale = await host.commit(first.proposalId);
      expect(stale.ok).toBe(true);
      if (!stale.ok)
        throw new Error(stale.diagnostics[0]?.message ?? 'The superseded proposal could not be inspected.');
      expect(stale.value.state).toBe('stale');
      expect(host.region.snapshot().state?.presentation).toBeUndefined();
    } finally {
      host.dispose();
    }
  });

  it('prunes retired output generations and commits a fresh evaluation', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      const first = await commitPlan(host);
      expect(first.state).toBe('renderer-ready');
      await evaluate(host);
      const second = await commitPlan(host);
      expect(second.state).toBe('renderer-ready');
      const oldProposal = await host.commit(first.proposalId);
      expect(oldProposal.ok).toBe(true);
      if (!oldProposal.ok)
        throw new Error(oldProposal.diagnostics[0]?.message ?? 'The old proposal could not be inspected.');
      expect(oldProposal.value.state).toBe('stale');
      expect(host.region.snapshot().state?.presentation).toBeDefined();
      expect(host.outputs()).toHaveLength(1);
    } finally {
      host.dispose();
    }
  });

  it('preserves interaction state through a recommit', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      expect((await commitPlan(host)).state).toBe('renderer-ready');
      const recommitted = await commitPlan(host);
      expect(recommitted.state).toBe('renderer-ready');
      expect(host.region.snapshot().state?.interaction).toBeUndefined();
    } finally {
      host.dispose();
    }
  });

  it('rejects an overlapping commit without crossing candidate state', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      const plan = requirePlan(host);
      const first = requireProposal(await host.propose(plan));
      const second = requireProposal(await host.propose(plan));
      host.holdNextCommit();
      const firstPromise = host.commit(first.proposalId);
      await host.waitForCommitAuthorization();
      const secondCommit = await host.commit(second.proposalId);
      host.releaseHeldCommit();
      const firstCommit = await firstPromise;
      if (!firstCommit.ok)
        throw new Error(firstCommit.diagnostics[0]?.message ?? 'The first presentation commit failed.');
      if (!secondCommit.ok)
        throw new Error(
          secondCommit.diagnostics[0]?.message ?? 'The overlapping presentation commit failed to return a receipt.',
        );
      expect(firstCommit.value.state).toBe('renderer-ready');
      expect(secondCommit.value.state).toBe('stale');
      expect(secondCommit.value.diagnostics.map((item) => item.code)).toContain('ui-development.concurrent');
      expect(host.observations.filter((observation) => observation.stage === 'commit')).toHaveLength(1);
      expect(host.region.snapshot().state?.presentation).toBeDefined();
    } finally {
      host.dispose();
    }
  });

  it('contains a late revoked commit without restoring region state', async () => {
    const host = createUiDevelopmentHost();
    try {
      await evaluate(host);
      const proposal = requireProposal(await host.propose(requirePlan(host)));
      host.holdNextCommit();
      const late = host.commit(proposal.proposalId);
      await host.waitForCommitAuthorization();
      host.revoke('development revocation');
      const result = await late;
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? 'The revoked commit could not be inspected.');
      expect(result.value.state).toBe('partial');
      expect(host.region.snapshot().status).toBe('revoked');
      expect(host.observations.some((observation) => observation.stage === 'revoke')).toBe(true);
    } finally {
      host.dispose();
    }
  });
});
