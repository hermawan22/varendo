import { expect, it } from 'vitest';
import { createRemotePeopleFixture } from './fixtures/remote.js';

/**
 * T18's enterprise UI is backed by the same HTTP DataService contract used by
 * the remote-data suite. This keeps the journey evidence about a real paged
 * transport rather than a browser-only label or a local-array substitute.
 */
it('runs two independently addressed enterprise windows through the remote HTTP fixture', async () => {
  const remote = await createRemotePeopleFixture({ logicalRows: 50, pageSize: 2, aggregate: false });
  const left = remote.createPrincipalSurface('tenant-a');
  const right = remote.createPrincipalSurface('tenant-b');
  try {
    const [leftReceipt, rightReceipt] = await Promise.all([
      left.surface.request({ kind: 'browse', resource: 'people', page: { size: 2 } }),
      right.surface.request({ kind: 'browse', resource: 'people', page: { size: 2 } }),
    ]);
    expect(leftReceipt.status).toBe('committed');
    expect(rightReceipt.status).toBe('committed');
    expect(left.surface.address).not.toEqual(right.surface.address);
    expect(left.surface.getSnapshot().state).toMatchObject({ loaded: 2, coverage: { kind: 'partial' } });
    expect(right.surface.getSnapshot().state).toMatchObject({ loaded: 2, population: { kind: 'unknown' } });
    expect(remote.server.observedRequests.filter((request) => request.kind === 'plan')).toHaveLength(2);
    expect(remote.server.observedRequests.filter((request) => request.kind === 'execute')).toHaveLength(2);
  } finally {
    left.dispose();
    right.dispose();
    await remote.dispose();
  }
});
