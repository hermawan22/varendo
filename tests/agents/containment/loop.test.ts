import { describe, expect, it } from 'vitest';
import { containAgentProposal } from '../../../packages/agent/src/loop.js';
import type { AgentBinder } from '../../../packages/agent/src/binder-types.js';

type BindingResult = Awaited<ReturnType<AgentBinder['bind']>>;
type AgentBindingOutcome = Extract<BindingResult, { ok: true }>['value'];
type BoundOutcome = Extract<AgentBindingOutcome, { state: 'bound' }>;

const budget = (
  overrides: Partial<{ maxTurns: number; maxRepairs: number; maxMilliseconds: number; maxProposalBytes: number }> = {},
) => ({
  maxTurns: 4,
  maxRepairs: 2,
  maxMilliseconds: 1000,
  maxProposalBytes: 4096,
  ...overrides,
});

function binder(states: AgentBindingOutcome[], fingerprints?: string[]): AgentBinder & { bindCount: number } {
  let bindCount = 0;
  return {
    get bindCount() {
      return bindCount;
    },
    bind: async (): Promise<BindingResult> => {
      const value = states[Math.min(bindCount++, states.length - 1)]!;
      return { ok: true, value };
    },
    fingerprint: async (input): ReturnType<AgentBinder['fingerprint']> => ({
      ok: true,
      value: fingerprints?.[0] ?? (typeof input === 'string' ? input : JSON.stringify(input)),
    }),
  };
}

const invalid: AgentBindingOutcome = {
  state: 'invalid',
  diagnostics: [{ code: 'bad', message: 'repair me', retryable: true }],
};
const bound: BoundOutcome = {
  state: 'bound',
  value: {} as BoundOutcome['value'],
  interpretation: 'accepted',
  assumptions: [],
};

describe('agent proposal containment', () => {
  it('accepts a bound candidate without invoking repair', async () => {
    let proposals = 0;
    const result = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget(),
      initial: '{"candidate":1}',
      propose: async () => {
        proposals++;
        return '{"candidate":2}';
      },
      binder: binder([bound]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stop).toBe('complete');
      expect(result.value.attempts).toHaveLength(1);
      expect(result.value.attempts[0]?.proposalBytes).toBeLessThan(4096);
    }
    expect(proposals).toBe(0);
  });

  it('repairs one invalid candidate and then completes', async () => {
    let proposals = 0;
    const result = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget(),
      initial: '{"candidate":1}',
      propose: async () => {
        proposals++;
        return '{"candidate":2}';
      },
      binder: binder([invalid, bound]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stop).toBe('complete');
    expect(proposals).toBe(1);
  });

  it('stops repeated candidate fingerprints as no-progress', async () => {
    let proposals = 0;
    const result = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget(),
      initial: '{"candidate":1}',
      propose: async () => {
        proposals++;
        return '{"candidate":1}';
      },
      binder: binder([invalid], ['same']),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stop).toBe('no-progress');
      expect(result.value.attempts).toHaveLength(2);
    }
    expect(proposals).toBe(1);
  });

  it('enforces the repair and byte budgets before another bind', async () => {
    const limited = binder([invalid]);
    const repairStop = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget({ maxRepairs: 0 }),
      initial: '{"candidate":1}',
      propose: async () => '{"candidate":2}',
      binder: limited,
    });
    expect(repairStop.ok && repairStop.value.stop).toBe('repair-budget');

    const bytesStop = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget({ maxProposalBytes: 1 }),
      initial: '{"candidate":1}',
      propose: async () => '{"candidate":2}',
      binder: limited,
    });
    expect(bytesStop.ok && bytesStop.value.stop).toBe('byte-budget');
  });

  it('honors cancellation before a proposal is inspected', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget(),
      initial: '{"candidate":1}',
      signal: controller.signal,
      propose: async () => '{"candidate":2}',
      binder: binder([bound]),
    });
    expect(result.ok && result.value.stop).toBe('cancelled');
  });

  it('stops an uncooperative fingerprint boundary at the time budget', async () => {
    const hanging: AgentBinder = {
      bind: async () => ({ ok: true, value: bound }),
      fingerprint: async () => new Promise(() => {}),
    };
    const result = await containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget({ maxMilliseconds: 10 }),
      initial: '{"candidate":1}',
      propose: async () => '{"candidate":2}',
      binder: hanging,
    });
    expect(result.ok && result.value.stop).toBe('time-budget');
  });

  it('cancels an uncooperative proposal provider promptly', async () => {
    const controller = new AbortController();
    const resultPromise = containAgentProposal({
      requestId: 'request',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      budget: budget({ maxMilliseconds: 1000 }),
      signal: controller.signal,
      propose: async () => new Promise(() => {}),
      binder: binder([bound]),
    });
    setTimeout(() => controller.abort(), 10);
    const result = await resultPromise;
    expect(result.ok && result.value.stop).toBe('cancelled');
  });
});
