import { describe, expect, it } from 'vitest';
import { createHrViewSession } from '../../../examples/vertical-slice/src/view-session.js';

describe('raw HR outputs composed and committed through production runtime', () => {
  it('composes without a preset, preserves selection across queryless reorder and refuses a stale proposal', async () => {
    const session = await createHrViewSession();
    try {
      const initial = session.presentation!;
      expect(initial.environment.inlineSize.state).toBe('unknown');
      expect(initial.nodes.map((node) => node.manifest.id)).toEqual(['layout.stack', 'data.table', 'data.trend']);
      expect(initial.nodes.find((node) => node.manifest.id === 'data.trend')?.config.values).toMatchObject({
        labelField: 'date',
        seriesBy: ['employee_id'],
        series: [{ field: 'absence.rate' }],
      });
      const ranking = session.results.find((result) => result.ref.outputId === 'ranking')!;
      const selected = await session.dispatch({
        nodeId: 'view.ranking',
        portId: 'selection',
        payload: {
          kind: 'selection',
          selection: { mode: 'ids', entity: 'employees', keys: [session.selectionKey('e2')!], result: ranking.ref },
        },
      });
      expect(selected.ok, JSON.stringify(selected)).toBe(true);
      const selectedKey = session.selectionKey('e2')!;
      expect(session.selectionLabel(selectedKey)).toBe('e2');
      expect(session.selectionKey('e6')).toBeUndefined();
      const denied = await session.dispatch({
        nodeId: 'view.ranking',
        portId: 'selection',
        payload: {
          kind: 'selection',
          selection: { mode: 'ids', entity: 'employees', keys: ['outside-ranked-population'], result: ranking.ref },
        },
      });
      expect(denied.ok).toBe(false);
      expect(session.data.queryCount).toBe(2);
      const queries = session.data.queryCount;
      await session.reorder();
      expect(session.data.queryCount).toBe(queries);
      expect(session.region.snapshot().state?.task.kind).toBe('presentation');
      expect(session.presentation?.plan.nodes.find((node) => node.id === initial.plan.rootId)?.children).toEqual([
        'view.trend',
        'view.ranking',
      ]);
      expect(session.interaction?.values).toContainEqual({
        nodeId: 'view.ranking',
        portId: 'selection',
        payload: {
          kind: 'selection',
          selection: { mode: 'ids', entity: 'employees', keys: [session.selectionKey('e2')!], result: ranking.ref },
        },
      });
      const current = session.presentation?.plan;
      expect((await session.refuseStaleProposal())[0]?.code).toBe('runtime.region-stale');
      expect(session.presentation?.plan).toEqual(current);
      expect(session.data.queryCount).toBe(queries);
      session.revoke();
      expect(session.presentation).toBeUndefined();
      expect(session.results).toEqual([]);
      expect(session.selectionLabel(selectedKey)).toBeUndefined();
      expect(session.selectionKey('e2')).toBeUndefined();
    } finally {
      session.dispose();
    }
  });
});
