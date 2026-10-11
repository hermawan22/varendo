import { expect, it } from 'vitest';
import {
  createMeaningActivationCapability,
  createMeaningProposalCapability,
  type AgentMeaningAuthoring,
} from '../../packages/agent/src/meaning/index.js';
import type { MeaningRegistry } from '../../packages/runtime/src/meaning/index.js';
import type { AgentCapabilityContext } from '../../packages/agent/src/capabilities/types.js';
const context: AgentCapabilityContext = {
  requestId: 'request',
  targetRegionId: 'region',
  goalEpoch: 'goal',
  transport: 'manual',
  signal: new AbortController().signal,
  authority: { principalKey: 'caller', regionId: 'region', goalEpoch: 'goal', grants: ['meaning.activate'] },
};
it('passes trusted calling authority to the runtime activation boundary', async () => {
  let actual: unknown;
  const registry = {
    activate: async (_ref: unknown, options: unknown) => {
      actual = options;
      return { ok: false, diagnostics: [{ code: 'runtime.meaning-stale', message: 'Stale', retryable: false }] };
    },
  } as unknown as MeaningRegistry;
  const result = await createMeaningActivationCapability({ registry }).invoke({ id: 'm', revision: '1' }, context);
  expect(actual).toEqual({ signal: context.signal, expectedAuthority: { principalKey: 'caller' } });
  expect(result).toMatchObject({ state: 'stale' });
});
it.each([
  ['runtime.meaning-cancelled', 'cancelled'],
  ['runtime.meaning-revoked', 'stale'],
  ['runtime.meaning-conflict', 'invalid'],
  ['runtime.meaning-unknown', 'invalid'],
  ['runtime.meaning-grant', 'denied'],
  ['query.unsupported', 'unsupported'],
])('preserves activation outcome %s', async (code, state) => {
  const registry = {
    activate: async () => ({ ok: false, diagnostics: [{ code, message: 'Diagnostic', retryable: false }] }),
  } as unknown as MeaningRegistry;
  expect(
    await createMeaningActivationCapability({ registry }).invoke({ id: 'm', revision: '1' }, context),
  ).toMatchObject({ state });
});
it('reports host scope policy rejection as denied', () => {
  const authoring = {
    propose: () => ({
      ok: false,
      diagnostics: [{ code: 'agent.meaning-scope', message: 'Denied scope', retryable: false }],
    }),
  } as unknown as AgentMeaningAuthoring;
  expect(createMeaningProposalCapability({ authoring }).invoke({ meaning: {} as never }, context)).toMatchObject({
    state: 'denied',
  });
});
