import { expect, it } from 'vitest';
import { createEvaluationHost } from './host.js';
import { fixture, task } from './development.js';
it('uses the production evaluator and dispatcher with the same exact rows', async () => {
  const host = createEvaluationHost(fixture);
  try {
    const explicit = await host.evaluate(task);
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.value[0]?.rows).toEqual([
      { id: 'a', value: 9 },
      { id: 'c', value: 5 },
    ]);
    const dispatched = await host.endpoint.invoke('evaluate_task', task, { requestId: 'manual-1' });
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;
    expect(dispatched.value.state).toBe('data-ready');
    expect(host.observations).toHaveLength(2);
    expect(host.observations.every((item) => item.outputs?.[0]?.descriptor.coverage.kind === 'complete')).toBe(true);
  } finally {
    host.dispose();
  }
});
it('rejects forged wire authority and cannot perform UI commits or business writes', async () => {
  const host = createEvaluationHost(fixture, 'byok');
  try {
    expect(
      (
        await host.endpoint.invoke(
          'evaluate_task',
          { ...task, approved: true, actor: 'human' },
          { requestId: 'forged' },
        )
      ).ok,
    ).toBe(false);
    expect((await host.endpoint.invoke('execute_action', {}, { requestId: 'write' })).ok).toBe(false);
    expect((await host.endpoint.invoke('commit_experience', {}, { requestId: 'commit' })).ok).toBe(false);
    expect(host.observations).toHaveLength(0);
  } finally {
    host.dispose();
  }
});
it('revocation clears materialized fixture handles and denies later reads', async () => {
  const host = createEvaluationHost(fixture, 'byok');
  try {
    expect((await host.evaluate(task)).ok).toBe(true);
    host.revoke();
    expect((await host.endpoint.discover()).ok).toBe(false);
    expect((await host.evaluate(task)).ok).toBe(false);
  } finally {
    host.dispose();
  }
});
it('superseded goals reject late model-tool calls', async () => {
  const host = createEvaluationHost(fixture, 'byok');
  try {
    host.supersede();
    expect(await host.endpoint.invoke('evaluate_task', task, { requestId: 'late' })).toMatchObject({
      ok: true,
      value: { state: 'denied' },
    });
    expect(host.observations).toHaveLength(0);
  } finally {
    host.dispose();
  }
});
