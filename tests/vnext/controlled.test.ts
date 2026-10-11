import type { FeatureIntentValue } from '@varendo/core/features';
import { defineFeature } from '@varendo/core/features';
import type { ExternalSurfaceSnapshot, ExternalSurfaceStore, SurfaceProposal } from '@varendo/runtime';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createControlledFixture } from './fixtures/host.js';
import { createPeopleFixture } from './fixtures/people.js';

it('keeps a controlled request proposed until the host accepts it', async () => {
  const f = createControlledFixture();
  const before = f.surface.getSnapshot();
  const result = await f.surface.request({ kind: 'browse' });

  expect(result.status).toBe('proposed');
  expect(f.surface.getSnapshot()).toBe(before);
  expect(f.hostStore.proposals).toHaveLength(1);
  expect(f.hostStore.proposals[0]).toMatchObject({
    proposalId: result.status === 'proposed' ? result.proposalId : '',
    address: f.surface.address,
    expectedRevision: before.revision,
  });
  if (result.status === 'proposed') await f.hostStore.accept(result.proposalId);
  expect(f.surface.getSnapshot().revision).not.toBe(before.revision);
  f.dispose();
});

it('does not commit a rejected controlled proposal', async () => {
  const f = createControlledFixture();
  const before = f.surface.getSnapshot();
  const result = await f.surface.request({ kind: 'browse' });
  if (result.status !== 'proposed') throw new Error('Expected a proposal.');

  await f.hostStore.reject(result.proposalId);
  expect(f.surface.getSnapshot()).toBe(before);
  f.dispose();
});

it('rejects delayed out-of-order acceptance and does not propose again on host publication', async () => {
  const f = createControlledFixture();
  const first = await f.surface.request({
    kind: 'browse',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Design' },
  });
  const second = await f.surface.request({
    kind: 'browse',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  });
  if (first.status !== 'proposed' || second.status !== 'proposed') throw new Error('Expected proposals.');
  const secondProposal = f.hostStore.proposals.find((proposal) => proposal.proposalId === second.proposalId);
  if (secondProposal === undefined) throw new Error('Expected the second proposal to be recorded.');

  await expect(f.hostStore.accept(second.proposalId)).resolves.toEqual({ status: 'accepted' });
  const accepted = f.surface.getSnapshot();
  expect(accepted.intent).toEqual(secondProposal.intent);
  expect(accepted.revision).toBe('1');
  const proposalCount = f.hostStore.proposals.length;
  await expect(f.hostStore.accept(first.proposalId)).resolves.toEqual({
    status: 'stale',
    diagnosticCode: 'surface.proposal-stale',
  });
  expect(f.hostStore.proposals).toHaveLength(proposalCount);
  expect(f.surface.getSnapshot()).toBe(accepted);
  f.dispose();
});

it('releases the host listener after unsubscribe and idempotent teardown', () => {
  const f = createControlledFixture();
  const unsubscribe = f.surface.subscribe(() => undefined);
  expect(f.hostStore.listenerCount()).toBe(1);
  unsubscribe();
  expect(f.hostStore.listenerCount()).toBe(0);
  f.surface.dispose();
  f.surface.dispose();
  expect(f.hostStore.listenerCount()).toBe(0);
  f.dispose();
});

it('ignores late host acceptance after controlled surface disposal', async () => {
  const f = createControlledFixture();
  const result = await f.surface.request({ kind: 'browse' });
  if (result.status !== 'proposed') throw new Error('Expected a proposal.');
  f.surface.dispose();
  const disposed = f.surface.getSnapshot();
  await f.hostStore.accept(result.proposalId);
  expect(f.surface.getSnapshot()).toBe(disposed);
  expect(disposed.phase).toBe('disposed');
  f.dispose();
});

it('retires a pending proposal and masks state when permission changes before acceptance', async () => {
  const f = createControlledFixture();
  const result = await f.surface.request({ kind: 'browse' });
  if (result.status !== 'proposed') throw new Error('Expected a proposal.');
  f.scope.setFeaturePermission('people', false);

  await expect(f.hostStore.accept(result.proposalId)).resolves.toEqual({ status: 'accepted' });
  expect(f.surface.getSnapshot()).toMatchObject({ phase: 'denied', state: { rows: [], selection: [] } });

  f.scope.setFeaturePermission('people', true);
  expect(f.surface.getSnapshot()).toMatchObject({ phase: 'denied', state: { rows: [], selection: [] } });
  f.dispose();
});

it('publishes one safe denial when external acceptance loses permission', async () => {
  const f = createControlledFixture();
  const result = await f.surface.request({ kind: 'browse' });
  if (result.status !== 'proposed') throw new Error('Expected a proposal.');
  const observed: unknown[] = [];
  f.surface.subscribe(() => observed.push(f.surface.getSnapshot()));
  f.scope.setFeaturePermission('people', false);

  await expect(f.hostStore.accept(result.proposalId)).resolves.toEqual({ status: 'accepted' });
  expect(observed).toHaveLength(1);
  expect(observed[0]).toMatchObject({ phase: 'denied', state: { rows: [], selection: [] } });

  expect(f.surface.getSnapshot()).toBe(observed[0]);
  f.hostStore.publishCurrent();
  expect(f.surface.getSnapshot()).toBe(observed[0]);
  await expect(f.surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'denied' });
  expect(observed).toHaveLength(1);
  f.dispose();
});

it('detaches the external store when a listener throws during disposal', () => {
  const f = createControlledFixture();
  f.surface.subscribe(() => {
    throw new Error('observer failure');
  });
  expect(f.hostStore.listenerCount()).toBe(1);

  expect(() => f.surface.dispose()).not.toThrow();
  expect(f.hostStore.listenerCount()).toBe(0);
  f.dispose();
});

it('retires a proposal when the host callback throws', async () => {
  const f = createControlledFixture({ throwAfterProposal: true });
  const before = f.surface.getSnapshot();
  const result = await f.surface.request({ kind: 'browse' });
  expect(result).toEqual({ status: 'failed', diagnosticCode: 'surface.proposal-failed' });
  const proposal = f.hostStore.proposals[0];
  if (proposal === undefined) throw new Error('Expected the host to record the proposal before throwing.');

  await expect(f.hostStore.accept(proposal.proposalId)).resolves.toEqual({ status: 'accepted' });
  expect(f.surface.getSnapshot()).toBe(before);
  f.dispose();
});

it('constructs and accepts an external capability without predicting its address', async () => {
  const f = createPeopleFixture();
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({ value: z.string() }),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  type ReportIntent = FeatureIntentValue<typeof feature.intents>;
  type ReportState = { readonly value: string };
  const initialIntent = {
    intent: { id: 'report.open', revision: '1' },
    input: { value: 'initial' },
  } as const satisfies ReportIntent;
  let snapshot: ExternalSurfaceSnapshot<ReportIntent, ReportState> | undefined;
  const listeners = new Set<() => void>();
  const proposals: SurfaceProposal<ReportIntent>[] = [];
  const store: ExternalSurfaceStore<ReportIntent, ReportState> = {
    getSnapshot: () => {
      if (snapshot === undefined) throw new Error('Host snapshot is not initialized.');
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'external-report',
    feature,
    bindings: {
      initialIntent,
      initialState: { value: 'inert' },
      source: { kind: 'capability', read: async () => ({ value: 'must-not-run' }) },
    },
    ownership: { mode: 'external', store, onProposal: (proposal) => proposals.push(proposal) },
  });
  snapshot = Object.freeze({
    id: surface.id,
    address: surface.address,
    revision: '0',
    phase: 'idle',
    intent: initialIntent,
    state: Object.freeze({ value: 'inert' }),
  });
  const requestedIntent = {
    intent: { id: 'report.open', revision: '1' },
    input: { value: 'accepted' },
  } as const satisfies ReportIntent;

  const result = await surface.request(requestedIntent);
  if (result.status !== 'proposed') throw new Error('Expected a proposal.');
  const proposal = proposals[0];
  if (proposal === undefined) throw new Error('Expected the proposal to be recorded.');
  snapshot = Object.freeze({
    ...snapshot,
    revision: '1',
    phase: 'ready',
    intent: proposal.intent,
    state: Object.freeze({ value: 'accepted' }),
    proposalDecision: Object.freeze({
      proposalId: proposal.proposalId,
      address: proposal.address,
      expectedRevision: proposal.expectedRevision,
      status: 'accepted',
    }),
  });
  for (const listener of listeners) listener();
  expect(surface.getSnapshot()).toMatchObject({
    address: surface.address,
    revision: '1',
    phase: 'ready',
    intent: requestedIntent,
    state: { value: 'accepted' },
  });
  f.dispose();
});
