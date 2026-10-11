import { describe, expect, it, vi } from 'vitest';
import type { WebAppContext, WebRegion } from '../../../packages/web/src/app/context.js';
import { adaptRegion } from '../../../packages/web/src/app/render.js';

describe('web app lifecycle', () => {
  it('ignores delayed adaptation from a released region after same-id remount', async () => {
    const regionId = 'released-region';
    const released = {
      id: regionId,
      resourceId: 'people',
      target: { ownerDocument: { activeElement: null } },
      element: { presentation: undefined, results: [], interaction: undefined },
      sequence: 4,
      category: 'narrow',
      composing: false,
      pendingAdapt: true,
      actionPending: false,
      actionSequence: 0,
      values: new Map(),
      drafts: new Map(),
      last: {
        receipt: { regionId },
        results: [],
        descriptors: [],
      },
    } as unknown as WebRegion;
    const remounted = { ...released, sequence: 1 } as WebRegion;
    const snapshot = vi.fn(() => undefined);
    const context = {
      disposed: false,
      regions: new Map([[regionId, remounted]]),
      runtime: { snapshot },
    } as unknown as WebAppContext;

    const result = await adaptRegion(context, released);

    expect(result).toBeUndefined();
    expect(released.sequence).toBe(4);
    expect(released.pendingAdapt).toBe(true);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
