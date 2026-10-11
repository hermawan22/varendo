import { describe, expect, it } from 'vitest';
import type { Intent } from '@varendo/core';
import { createWorkspaceFixture } from './fixtures/workspace.js';

describe('T09 workspace composition', () => {
  it('changes layout through a registered intent without changing scope or selection', async () => {
    const f = createWorkspaceFixture();
    try {
      await expect(f.surface.request(f.intents.browse)).resolves.toMatchObject({ status: 'committed' });
      const selected = await f.view.selectThroughControl(['ada', 'sam']);
      expect(selected.status).toBe('committed');
      const before = f.scope.getSnapshot();

      await expect(f.surface.request(f.intents.compare)).resolves.toMatchObject({ status: 'committed' });
      const after = f.view.snapshot();
      expect(after?.layout).toBe('compare');
      expect(after?.selectedIds).toEqual(['ada', 'sam']);
      expect(after?.scopeInstanceId).toBe(before.scopeInstanceId);
      expect(after?.scopeEpoch).toBe(before.activationEpoch);
      expect(after?.runtimeId).toBe(before.runtimeId);
      expect(after?.children.map((child) => child.nodeId)).toEqual(['primary', 'secondary']);
      expect(new Set(after?.children.map((child) => child.ownerSurfaceId)).size).toBe(2);
      expect(after?.children.every((child) => child.address.scopeInstanceId === before.scopeInstanceId)).toBe(true);
    } finally {
      f.dispose();
    }
  });

  it('supports single, split, and compare plans with stable child addresses', async () => {
    const f = createWorkspaceFixture();
    try {
      await f.surface.request(f.intents.browse);
      const single = f.view.snapshot();
      expect(single?.layout).toBe('single');
      await f.view.selectThroughControl(['ada', 'sam']);
      await f.surface.request(f.intents.split);
      const split = f.view.snapshot();
      await f.surface.request(f.intents.compare);
      const compare = f.view.snapshot();
      expect(split?.layout).toBe('split');
      expect(compare?.layout).toBe('compare');
      expect(split?.children.map((child) => child.address)).toEqual(compare?.children.map((child) => child.address));
      expect(compare?.plan.nodes.filter((node) => node.children.length === 0)).toHaveLength(2);
    } finally {
      f.dispose();
    }
  });

  it('retains the previous authorized layout when preparation fails or is cancelled', async () => {
    const f = createWorkspaceFixture();
    try {
      await f.surface.request(f.intents.browse);
      const before = f.view.snapshot();
      f.renderer.failNext();
      await expect(f.surface.request(f.intents.split)).resolves.toMatchObject({ status: 'failed' });
      expect(f.view.snapshot()?.plan).toEqual(before?.plan);

      const release = f.renderer.holdNext();
      const pending = f.surface.request(f.intents.split);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const replacement = f.surface.request(f.intents.browse);
      release();
      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      await expect(replacement).resolves.toMatchObject({ status: 'committed' });
      expect(f.view.snapshot()?.layout).toBe('single');
    } finally {
      f.dispose();
    }
  });

  it('fails closed for unknown custom intents and preserves the current plan', async () => {
    const f = createWorkspaceFixture();
    try {
      await f.surface.request(f.intents.browse);
      const before = f.view.snapshot();
      const unknown: Intent = {
        version: '1',
        id: 'orders-unknown',
        resource: 'people',
        kind: 'custom' as const,
        intent: { id: 'orders.unknown-layout', revision: '1' },
        input: { mode: 'compare' },
      };
      await expect(f.surface.request(unknown)).resolves.toMatchObject({ status: 'failed' });
      expect(f.view.snapshot()?.plan).toEqual(before?.plan);
    } finally {
      f.dispose();
    }
  });
});
