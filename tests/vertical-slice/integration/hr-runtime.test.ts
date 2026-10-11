import { describe, expect, it } from 'vitest';
import type { Task } from '../../../packages/core/dist/index.js';
import type { ResultHandle } from '../../../packages/runtime/dist/results/index.js';
import { createHrDataSession } from '../../../examples/vertical-slice/src/data-session.js';
import { initialTask, raw, snapshot, trendQuery } from '../../../examples/vertical-slice/src/hr.js';

const rows = (handle: ResultHandle) => handle.snapshot().batches.flatMap((batch) => batch.rows);

describe.each(['local', 'http'] as const)('raw HR named outputs through %s ADC', (transport) => {
  it('evaluates ranking before weekly trend and binds original ADC descriptors to the semantic task', async () => {
    const session = createHrDataSession(transport);
    try {
      const task = initialTask();
      const evaluated = await session.evaluate(task);
      expect(evaluated.outputs.map((output) => output.outputId)).toEqual(['ranking', 'trend']);
      expect(session.queryCount).toBe(2);
      const ranking = evaluated.get('ranking')!;
      const trend = evaluated.get('trend')!;
      expect(rows(ranking.handle).map((row) => row.employee_id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
      expect(rows(trend.handle)).toHaveLength(60);
      expect(new Set(rows(trend.handle).map((row) => row.employee_id))).toEqual(
        new Set(['e1', 'e2', 'e3', 'e4', 'e5']),
      );
      expect(trend.descriptor?.rowGrain).toEqual(['employee_id', 'date']);
      expect(trend.descriptor?.taskId).toBe(task.id);
      expect(ranking.descriptor?.taskId).toBe(task.id);
      expect(trend.descriptor?.ref.queryDigest).toBe(trend.accepted?.queryDigest);
      expect(trend.descriptor?.lineage).toEqual([{ output: 'trend', inputs: [ranking.ref] }]);
      expect(trend.accepted?.query.population).toMatchObject({ kind: 'fixed', source: ranking.ref });
      expect(trend.descriptor?.fields.find((field) => field.id === 'date')?.type.temporal).toEqual({
        calendar: 'iso8601',
        timezone: 'Asia/Jakarta',
        grain: 'week',
      });
      expect(rows(trend.handle).find((row) => row.employee_id === 'e1' && row.date === '2026-01-05')).toMatchObject({
        'absence.absent': 2,
        'absence.expected': 5,
        'absence.rate': 0.4,
      });
      evaluated.release();
    } finally {
      session.dispose();
    }
  });

  it('keeps a fixed cohort after a source revision while a live task recomputes membership', async () => {
    const session = createHrDataSession(transport);
    try {
      const original = await session.evaluate(initialTask());
      const ranking = original.get('ranking')!;
      const population = original.get('trend')!.accepted!.query.population;
      expect(population.kind).toBe('fixed');
      const changed = raw.observations.map((row) => (row.employee_id === 'e6' ? { ...row, status: 'absent' } : row));
      session.replaceSnapshot(snapshot('hr-source-2', changed));
      const base = initialTask();
      const fixed: Task = {
        ...base,
        needs: [],
        outputs: [
          { id: 'ranking', kind: 'reuse', result: ranking.ref, dependsOn: [] },
          {
            id: 'trend',
            kind: 'query',
            query: { ...trendQuery(), population },
            dependsOn: ['ranking'],
            delivery: 'eager',
          },
        ],
      };
      const followup = await session.evaluate(fixed);
      expect(new Set(rows(followup.get('trend')!.handle).map((row) => row.employee_id))).toEqual(
        new Set(['e1', 'e2', 'e3', 'e4', 'e5']),
      );
      expect(followup.get('trend')?.descriptor?.consistency).toMatchObject({
        kind: 'snapshot',
        snapshotId: 'hr-source-2',
      });
      expect(followup.get('trend')?.descriptor?.lineage).toEqual([{ output: 'trend', inputs: [ranking.ref] }]);
      const live = await session.evaluate(initialTask());
      expect(rows(live.get('ranking')!.handle).map((row) => row.employee_id)).toEqual(['e6', 'e1', 'e2', 'e3', 'e4']);
      original.release();
      followup.release();
      live.release();
      session.revoke();
      expect(ranking.handle.snapshot().descriptor).toBeUndefined();
      await expect(session.evaluate(fixed)).rejects.toThrow();
    } finally {
      session.dispose();
    }
  });
  it('keeps a missing source observation unknown in a fixed employee-week result', async () => {
    const session = createHrDataSession(transport);
    try {
      const original = await session.evaluate(initialTask());
      const source = original.get('ranking')!;
      const missing = raw.observations.find((row) => row.employee_id === 'e1' && row.date === '2026-01-05')!;
      expect(missing).toBeDefined();
      session.replaceSnapshot(
        snapshot(
          'hr-missing-observation',
          raw.observations.filter((row) => row.id !== missing.id),
        ),
      );
      const fixed: Task = {
        ...initialTask(),
        needs: [],
        outputs: [
          {
            id: 'trend',
            kind: 'query',
            query: { ...trendQuery(), population: original.get('trend')!.accepted!.query.population },
            dependsOn: [],
            delivery: 'eager',
          },
        ],
      };
      const updated = await session.evaluate(fixed);
      expect(
        rows(updated.get('trend')!.handle).find((row) => row.employee_id === 'e1' && row.date === '2026-01-05'),
      ).toMatchObject({ 'absence.expected': 5, 'absence.unknown': 1, 'absence.rate': null });
      expect(updated.get('trend')?.descriptor?.lineage).toEqual([{ output: 'trend', inputs: [source.ref] }]);
      updated.release();
      original.release();
    } finally {
      session.dispose();
    }
  });
});
