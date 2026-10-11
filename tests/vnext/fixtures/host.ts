import type { Intent } from '@varendo/core';
import type {
  ExternalSurfaceStore,
  ExternalSurfaceSnapshot,
  LocalSurfaceScope,
  SurfaceAddress,
  SurfaceController,
  SurfaceProposal,
} from '@varendo/runtime';
import { createPeopleFixture, fixtureRows, type PeopleSurfaceState } from './people.js';

export interface ControlledProposal<I> {
  readonly id: string;
  readonly intent: I;
  readonly expectedRevision: string;
}

export interface ControlledHostFixtureContract<I, S> {
  readonly getSnapshot: () => S;
  readonly subscribe: (listener: () => void) => () => void;
  readonly proposals: readonly ControlledProposal<I>[];
  readonly accept: (proposalId: string) => Promise<void>;
  readonly reject: (proposalId: string) => Promise<void>;
}

type AcceptanceResult =
  { readonly status: 'accepted' } | { readonly status: 'stale'; readonly diagnosticCode: 'surface.proposal-stale' };

function sameAddress(left: SurfaceAddress, right: SurfaceAddress): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.scopeInstanceId === right.scopeInstanceId &&
    left.activationEpoch === right.activationEpoch &&
    left.surfaceId === right.surfaceId &&
    left.surfaceGeneration === right.surfaceGeneration
  );
}

class ControlledHostStore implements ExternalSurfaceStore<Intent, PeopleSurfaceState> {
  private readonly listeners = new Set<() => void>();
  private readonly recorded: SurfaceProposal<Intent>[] = [];
  private snapshot: ExternalSurfaceSnapshot<Intent, PeopleSurfaceState>;

  constructor(id: string, address: SurfaceAddress) {
    this.snapshot = Object.freeze({
      id,
      address,
      revision: '0',
      phase: 'idle',
      intent: Object.freeze({ version: '1', id: 'initial', resource: 'people', kind: 'browse' }),
      state: Object.freeze({ rows: fixtureRows, selection: Object.freeze([]) }),
    });
  }

  get proposals(): readonly SurfaceProposal<Intent>[] {
    return Object.freeze([...this.recorded]);
  }

  getSnapshot(): ExternalSurfaceSnapshot<Intent, PeopleSurfaceState> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(proposal: SurfaceProposal<Intent>): void {
    this.recorded.push(proposal);
  }

  async accept(proposalId: string): Promise<AcceptanceResult> {
    const proposal = this.recorded.find((candidate) => candidate.proposalId === proposalId);
    if (
      proposal === undefined ||
      proposal.expectedRevision !== this.snapshot.revision ||
      !sameAddress(proposal.address, this.snapshot.address)
    )
      return { status: 'stale', diagnosticCode: 'surface.proposal-stale' };
    this.snapshot = Object.freeze({
      ...this.snapshot,
      revision: String(Number(this.snapshot.revision) + 1),
      phase: 'ready',
      intent: proposal.intent,
      proposalDecision: Object.freeze({
        proposalId: proposal.proposalId,
        address: proposal.address,
        expectedRevision: proposal.expectedRevision,
        status: 'accepted' as const,
      }),
    });
    for (const listener of [...this.listeners]) listener();
    return { status: 'accepted' };
  }

  async reject(proposalId: string): Promise<void> {
    const proposal = this.recorded.find((candidate) => candidate.proposalId === proposalId);
    if (proposal === undefined) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      proposalDecision: Object.freeze({
        proposalId: proposal.proposalId,
        address: proposal.address,
        expectedRevision: proposal.expectedRevision,
        status: 'rejected' as const,
      }),
    });
    for (const listener of [...this.listeners]) listener();
  }

  publishCurrent(): void {
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export function createControlledFixture(options: { readonly throwAfterProposal?: boolean } = {}): {
  readonly surface: SurfaceController<Intent, PeopleSurfaceState>;
  readonly hostStore: ControlledHostStore;
  readonly scope: LocalSurfaceScope;
  readonly dispose: () => void | Promise<void>;
} {
  const people = createPeopleFixture();
  const scope = people.scope.getSnapshot();
  const address = Object.freeze({
    runtimeId: people.runtimeId,
    scopeInstanceId: scope.scopeInstanceId,
    activationEpoch: scope.activationEpoch,
    surfaceId: 'controlled',
    surfaceGeneration: 1,
  });
  const hostStore = new ControlledHostStore('controlled', address);
  const surface = people.runtime.createSurface({
    scope: people.scope,
    id: 'controlled',
    feature: people.feature,
    bindings: people.bindings,
    ownership: {
      mode: 'external',
      store: hostStore,
      onProposal: (proposal) => {
        hostStore.record(proposal);
        if (options.throwAfterProposal === true) throw new Error('host proposal failure');
      },
    },
  });
  return { surface, hostStore, scope: people.scope, dispose: people.dispose };
}
