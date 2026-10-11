import { expect, it } from 'vitest';
import { parseWireValue, type Outcome } from '../../../packages/core/src/index.js';
import { createAgentCapabilityDispatcher } from '../../../packages/agent/src/capabilities/dispatcher.js';
import { createAgentCapabilityRegistry } from '../../../packages/agent/src/capabilities/registry.js';
import type { AgentJsonValue } from '../../../packages/agent/src/capabilities/types.js';
import { createAgentToolEndpoint } from '../../../packages/agent/src/protocol/endpoint.js';

it('dispatches an immutable admitted snapshot when caller data changes during authority reads', async () => {
  let start: () => void = () => undefined;
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seenInput: AgentJsonValue | undefined;
  const registry = createAgentCapabilityRegistry([
    {
      ref: { id: 'echo', revision: '1' },
      operation: 'catalog.read',
      label: 'Echo',
      parse: (input) => parseWireValue(input) as Outcome<AgentJsonValue>,
      invoke(input) {
        seenInput = input;
        return { state: 'accepted', value: input };
      },
    },
  ]);
  if (!registry.ok) throw new Error('Fixture registry rejected');
  let reads = 0;
  const dispatcher = createAgentCapabilityDispatcher({
    registry: registry.value,
    maxInputBytes: 64,
    host: {
      async readContext() {
        if (++reads === 1) {
          start();
          await released;
        }
        return {
          ok: true,
          value: { principalKey: 'user', regionId: 'region', goalEpoch: 'goal', grants: ['catalog.read'] },
        };
      },
    },
  });
  const input: { nested: { text: string; actor?: string }; numbers: number[] } = {
    nested: { text: 'safe' },
    numbers: [-0],
  };
  const metadata = { trace: ['original'] };
  const result = dispatcher.manual.invoke({
    version: '1',
    requestId: 'request',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    capability: { id: 'echo', revision: '1' },
    operation: 'catalog.read',
    input,
    metadata,
  });
  await started;
  input.nested.text = 'x'.repeat(1_000);
  input.nested.actor = 'administrator';
  input.numbers[0] = 1;
  metadata.trace[0] = 'changed';
  release();
  const outcome = await result;
  expect(outcome).toMatchObject({ ok: true, value: { state: 'accepted', metadata: { trace: ['original'] } } });
  expect(seenInput).toEqual({ nested: { text: 'safe' }, numbers: [-0] });
  expect(Object.isFrozen(seenInput)).toBe(true);
  expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(input.nested)).toBe(false);
  if (seenInput === null || typeof seenInput !== 'object' || !('nested' in seenInput)) throw new Error('Missing input');
  expect(Object.isFrozen(seenInput.nested)).toBe(true);
  expect(Object.isFrozen(seenInput.numbers)).toBe(true);
});

it('snapshots a tool request before its first scheduled boundary', async () => {
  const registry = createAgentCapabilityRegistry([
    {
      ref: { id: 'echo', revision: '1' },
      operation: 'catalog.read',
      label: 'Echo',
      parse: (input) => parseWireValue(input) as Outcome<AgentJsonValue>,
      invoke: (input) => ({ state: 'accepted', value: input }),
    },
  ]);
  if (!registry.ok) throw new Error('Fixture registry rejected');
  const endpoint = createAgentToolEndpoint({
    transport: 'manual',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    principalKey: 'user',
    expiresAt: Date.now() + 60_000,
    registry: registry.value,
    maxInputBytes: 32,
    tools: [
      {
        name: 'echo',
        capability: { id: 'echo', revision: '1' },
        operation: 'catalog.read',
        inputSchema: { type: 'object' },
      },
    ],
    host: {
      readContext: () => ({
        ok: true,
        value: { principalKey: 'user', regionId: 'region', goalEpoch: 'goal', grants: ['catalog.read'] },
      }),
    },
  });
  if (!endpoint.ok) throw new Error('Fixture endpoint rejected');
  try {
    const input = { text: 'safe' };
    const options = { requestId: 'original' };
    const outcome = endpoint.value.invoke('echo', input, options);
    input.text = 'changed';
    options.requestId = 'replaced';
    expect(await outcome).toMatchObject({
      ok: true,
      value: { requestId: 'original', state: 'accepted', value: { text: 'safe' } },
    });
    const cyclic: { child?: unknown } = {};
    cyclic.child = cyclic;
    expect(await endpoint.value.invoke('echo', cyclic, { requestId: 'invalid' })).toMatchObject({ ok: false });
  } finally {
    endpoint.value.close();
  }
});
