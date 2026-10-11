import type { SurfaceAddress, SurfaceProposal, SurfaceRevision } from './types.js';

export class ProposalSequencer<I> {
  private sequence = 0;

  create(address: SurfaceAddress, expectedRevision: SurfaceRevision, intent: I): SurfaceProposal<I> {
    const proposalId = `${address.surfaceId}:${address.surfaceGeneration}:${++this.sequence}`;
    return Object.freeze({ proposalId, address, expectedRevision, intent });
  }
}
