import { describe, expect, it } from 'vitest';
import { parseWireValue, type Outcome } from '../../../packages/core/src/index.js';
import type { OperationGrant } from '../../../packages/core/src/contracts/agent/index.js';
import { createAgentCapabilityRegistry } from '../../../packages/agent/src/capabilities/registry.js';
import type { AgentCapabilityManifest } from '../../../packages/agent/src/capabilities/types.js';
import { createAgentToolEndpoint } from '../../../packages/agent/src/protocol/endpoint.js';
import type { AgentToolEndpointOptions } from '../../../packages/agent/src/protocol/types.js';

function fixture(
  overrides: Partial<AgentToolEndpointOptions> = {},
  invoke: AgentCapabilityManifest['invoke'] = () => ({ state: 'data-ready', value: { count: 2 } }),
) {
  let grants: readonly OperationGrant[] = ['catalog.read', 'model.egress'];
  let principalKey = 'owner';
  let time = 1;
  const registry = createAgentCapabilityRegistry([
    {
      ref: { id: 'summary', revision: '1' },
      operation: 'catalog.read',
      label: 'Summary',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke,
    },
  ]);
  if (!registry.ok) throw new Error('registry');
  const options: AgentToolEndpointOptions = {
    transport: 'mcp',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    principalKey: 'owner',
    expiresAt: 1000,
    now: () => time,
    registry: registry.value,
    tools: [
      {
        name: 'summary',
        capability: { id: 'summary', revision: '1' },
        operation: 'catalog.read',
        inputSchema: { type: 'object' },
      },
    ],
    host: { readContext: () => ({ ok: true, value: { principalKey, regionId: 'region', goalEpoch: 'goal', grants } }) },
    ...overrides,
  };
  const outcome = createAgentToolEndpoint(options);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return {
    endpoint: outcome.value,
    options,
    grants: (next: readonly OperationGrant[]) => {
      grants = next;
    },
    principal: (next: string) => {
      principalKey = next;
    },
    time: (next: number) => {
      time = next;
    },
  };
}

describe('paired protocol endpoint', () => {
  it('discovers only currently granted tools and independently admits model egress', async () => {
    const f = fixture();
    expect(await f.endpoint.discover()).toMatchObject({ ok: true, value: [{ name: 'summary' }] });
    f.grants(['model.egress']);
    expect(await f.endpoint.discover()).toEqual({ ok: true, value: [] });
    expect(await f.endpoint.authorizeModel()).toEqual({ ok: true, value: { principalKey: 'owner' } });
    f.grants(['catalog.read']);
    expect(await f.endpoint.discover()).toMatchObject({ ok: false });
    expect(await f.endpoint.authorizeModel()).toMatchObject({ ok: false });
  });

  it('uses registered parsing and bound authority without model-supplied routing', async () => {
    let calls = 0;
    const f = fixture({}, (_input, context) => {
      calls++;
      return { state: 'data-ready', value: { region: context.targetRegionId, transport: context.transport } };
    });
    expect(await f.endpoint.invoke('summary', {}, { requestId: 'one' })).toMatchObject({
      ok: true,
      value: { value: { region: 'region', transport: 'mcp' } },
    });
    expect(await f.endpoint.invoke('summary', { approved: true }, { requestId: 'two' })).toMatchObject({ ok: false });
    expect(await f.endpoint.invoke('unknown', {}, { requestId: 'three' })).toMatchObject({ ok: false });
    f.principal('someone-else');
    expect(await f.endpoint.invoke('summary', {}, { requestId: 'four' })).toMatchObject({
      ok: true,
      value: { state: 'denied' },
    });
    expect(calls).toBe(1);
  });

  it('closes in-flight discovery and rejects later calls', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let observed: AbortSignal | undefined;
    const f = fixture({
      host: {
        readContext: (request) => {
          observed = request.signal;
          entered();
          return new Promise(() => {});
        },
      },
    });
    const pending = f.endpoint.discover();
    await started;
    f.endpoint.close();
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.cancelled' }] });
    expect(observed?.aborted).toBe(true);
    expect(await f.endpoint.discover()).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.stale' }] });
  });

  it('bounds concurrency and host wait time', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = fixture({
      maxPending: 1,
      maxMilliseconds: 20,
      host: {
        readContext: () => {
          entered();
          return new Promise(() => {});
        },
      },
    });
    const first = f.endpoint.discover();
    await started;
    expect(await f.endpoint.discover()).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.budget' }] });
    expect(await first).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.time-budget' }] });
  });

  it('rejects expiry and suppresses output after scope changes', async () => {
    const f = fixture({}, () => {
      f.principal('other');
      return { state: 'data-ready', value: { secret: 'private' } };
    });
    const result = await f.endpoint.invoke('summary', {}, { requestId: 'one' });
    expect(result).toMatchObject({ ok: true, value: { state: 'partial' } });
    expect(JSON.stringify(result)).not.toContain('private');
    f.time(1000);
    expect(await f.endpoint.discover()).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.stale' }] });
  });

  it('rejects non-string names, external schema refs, stale leases, and oversized discovery', async () => {
    const f = fixture();
    const tool = f.options.tools[0]!;
    expect(createAgentToolEndpoint({ ...f.options, tools: [{ ...tool, name: 12 as unknown as string }] }).ok).toBe(
      false,
    );
    expect(
      createAgentToolEndpoint({
        ...f.options,
        tools: [
          { ...tool, inputSchema: { type: 'object', properties: { query: { $ref: 'https://example.com/schema' } } } },
        ],
      }).ok,
    ).toBe(false);
    expect(createAgentToolEndpoint({ ...f.options, expiresAt: 1 }).ok).toBe(false);
    const small = fixture({ maxOutputBytes: 10 });
    expect(await small.endpoint.discover()).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'agent.protocol.bytes' }],
    });
  });
});

describe('endpoint revocation and timing regressions', () => {
  it('allows manual discovery without model egress', async () => {
    const f = fixture({ transport: 'manual' });
    f.grants(['catalog.read']);
    expect(await f.endpoint.discover()).toMatchObject({ ok: true, value: [{ name: 'summary' }] });
    expect(await f.endpoint.authorizeModel()).toMatchObject({ ok: false });
  });
  it('propagates invocation abort to the handler and blocks late output', async () => {
    const caller = new AbortController();
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: AbortSignal | undefined,
      effects = 0;
    const f = fixture({}, async (_input, context) => {
      observed = context.signal;
      entered();
      await gate;
      if (!context.signal.aborted) effects++;
      return { state: 'data-ready', value: { secret: 'late' } };
    });
    const pending = f.endpoint.invoke('summary', {}, { requestId: 'cancelled', signal: caller.signal });
    await ready;
    caller.abort();
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.cancelled' }] });
    expect(observed?.aborted).toBe(true);
    release();
    await Promise.resolve();
    expect(effects).toBe(0);
    expect(JSON.stringify(outcome)).not.toContain('late');
  });
  it('redacts endpoint output when egress is revoked at the handler', async () => {
    const f = fixture({}, () => {
      f.grants(['catalog.read']);
      return { state: 'data-ready', value: { secret: 'private' } };
    });
    const outcome = await f.endpoint.invoke('summary', {}, { requestId: 'revoke' });
    expect(outcome).toMatchObject({ ok: true, value: { state: 'denied' } });
    expect(JSON.stringify(outcome)).not.toContain('private');
  });
  it('does not extend the original lease when its wall clock moves backward', async () => {
    let time = 100;
    const f = fixture({ now: () => time, expiresAt: 110 });
    time = -10_000;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(await f.endpoint.discover()).toMatchObject({ ok: false, diagnostics: [{ code: 'agent.protocol.stale' }] });
  });
});
