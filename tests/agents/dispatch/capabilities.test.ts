import { describe, expect, it } from 'vitest';
import { parseWireValue, type Outcome } from '../../../packages/core/src/index.js';
import type { OperationGrant } from '../../../packages/core/src/contracts/agent/index.js';
import { createAgentCapabilityDispatcher } from '../../../packages/agent/src/capabilities/dispatcher.js';
import { createAgentCapabilityRegistry } from '../../../packages/agent/src/capabilities/registry.js';
import type {
  AgentCapabilityManifest,
  AgentCapabilityRequest,
} from '../../../packages/agent/src/capabilities/types.js';

const request = (overrides: Partial<AgentCapabilityRequest> = {}): AgentCapabilityRequest => ({
  version: '1',
  requestId: 'request-1',
  targetRegionId: 'region-1',
  goalEpoch: 'goal-1',
  capability: { id: 'catalog.summary', revision: '1' },
  operation: 'catalog.read',
  input: { query: 'events' },
  ...overrides,
});

const host = (grants: readonly OperationGrant[] = ['catalog.read']) => ({
  readContext: () => ({
    ok: true as const,
    value: {
      principalKey: 'principal-1',
      regionId: 'region-1',
      goalEpoch: 'goal-1',
      grants,
    },
  }),
});

function manifest(invoke: AgentCapabilityManifest['invoke']): AgentCapabilityManifest {
  return {
    ref: { id: 'catalog.summary', revision: '1' },
    operation: 'catalog.read',
    label: 'Catalog summary',
    parse: (input) => parseWireValue(input) as Outcome<never>,
    invoke,
  };
}

describe('capability dispatcher', () => {
  it('uses one authority checked path for direct and manual ports', async () => {
    let calls = 0;
    const registry = createAgentCapabilityRegistry([
      manifest((_input, context) => {
        calls++;
        return { state: 'data-ready', value: { scope: context.authority.regionId, count: 2 } };
      }),
    ]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host() });
    const direct = await dispatcher.direct.invoke(request());
    const manual = await dispatcher.manual.invoke(request({ requestId: 'request-2' }));
    expect(direct).toMatchObject({
      ok: true,
      value: { state: 'data-ready', status: 'data-ready', value: { scope: 'region-1', count: 2 } },
    });
    expect(manual).toMatchObject({
      ok: true,
      value: { state: 'data-ready', status: 'data-ready', transport: 'manual' },
    });
    expect(calls).toBe(2);
  });

  it('does not invoke a handler without its independent grant', async () => {
    let invoked = false;
    const registry = createAgentCapabilityRegistry([
      manifest(() => {
        invoked = true;
        return { state: 'data-ready' };
      }),
    ]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host(['task.propose']) });
    const result = await dispatcher.dispatch(request());
    expect(result).toMatchObject({
      ok: true,
      value: { state: 'denied', diagnostics: [{ code: 'agent.capability.grant' }] },
    });
    expect(invoked).toBe(false);
  });

  it('rejects forged authority and unknown registered schema before handler execution', async () => {
    let invoked = false;
    const registry = createAgentCapabilityRegistry([
      manifest(() => {
        invoked = true;
        return { state: 'data-ready' };
      }),
    ]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host() });
    const forged = await dispatcher.dispatch({ ...request(), actor: 'human' });
    expect(forged.ok).toBe(false);
    const nested = await dispatcher.dispatch(request({ input: { config: { approved: true } } }));
    expect(nested.ok).toBe(false);
    expect(invoked).toBe(false);
    const unknown = await dispatcher.dispatch(request({ capability: { id: 'catalog.unknown', revision: '1' } }));
    expect(unknown).toMatchObject({ ok: true, value: { state: 'unsupported' } });
  });

  it('keeps evaluation and presentation grants separate and bounds a handler', async () => {
    let evaluated = 0;
    const evaluation = manifest((_input) => {
      evaluated++;
      return { state: 'data-ready', value: { rows: 1 } };
    });
    const presentation: AgentCapabilityManifest = {
      ref: { id: 'experience.commit', revision: '1' },
      operation: 'experience.commit',
      label: 'Commit experience',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke: () => ({ state: 'renderer-ready', regionRevision: 'region-2' }),
    };
    const registry = createAgentCapabilityRegistry([evaluation, presentation]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host(['catalog.read']) });
    const read = await dispatcher.dispatch(request());
    expect(read).toMatchObject({ ok: true, value: { state: 'data-ready' } });
    const commit = await dispatcher.dispatch(request({ capability: presentation.ref, operation: 'experience.commit' }));
    expect(commit).toMatchObject({ ok: true, value: { state: 'denied' } });
    expect(evaluated).toBe(1);
  });

  it('returns an ambiguous recovery stage when authority changes after a handler', async () => {
    let reads = 0;
    const registry = createAgentCapabilityRegistry([manifest(() => ({ state: 'data-ready', value: { rows: 1 } }))]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({
      registry: registry.value,
      host: {
        readContext: () => {
          reads++;
          return {
            ok: true as const,
            value: {
              principalKey: 'principal-1',
              regionId: 'region-1',
              goalEpoch: 'goal-1',
              grants: reads < 2 ? ['catalog.read' as const] : ['task.propose' as const],
            },
          };
        },
      },
    });
    const result = await dispatcher.dispatch(request());
    expect(result).toMatchObject({
      ok: true,
      value: { state: 'partial', diagnostics: [{ code: 'agent.capability.recovery' }] },
    });
  });

  it('does not turn result inspection into model egress', async () => {
    const inspect: AgentCapabilityManifest = {
      ref: { id: 'result.inspect', revision: '1' },
      operation: 'result.inspect',
      label: 'Inspect result',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke: () => ({ state: 'data-ready', value: { rows: [{ id: 'hidden' }] } }),
    };
    const registry = createAgentCapabilityRegistry([inspect]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host(['result.inspect']) });
    const denied = await dispatcher
      .port('mcp')
      .invoke(request({ capability: inspect.ref, operation: 'result.inspect' }));
    expect(denied).toMatchObject({
      ok: true,
      value: { state: 'denied', diagnostics: [{ code: 'agent.capability.egress' }] },
    });
  });

  it('uses the trusted port transport instead of request transport metadata', async () => {
    const registry = createAgentCapabilityRegistry([manifest(() => ({ state: 'data-ready', value: { rows: 1 } }))]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host(['catalog.read']) });
    const result = await dispatcher.dispatch(request({ transport: 'mcp' }));
    expect(result).toMatchObject({ ok: true, value: { transport: 'direct', state: 'data-ready' } });
    const external = await dispatcher.mcp.invoke(request({ transport: 'direct' }));
    expect(external).toMatchObject({
      ok: true,
      value: { transport: 'mcp', state: 'denied', diagnostics: [{ code: 'agent.capability.egress' }] },
    });
  });

  it('rechecks model egress after a data handler completes', async () => {
    let reads = 0;
    const inspect: AgentCapabilityManifest = {
      ref: { id: 'result.inspect', revision: '1' },
      operation: 'result.inspect',
      label: 'Inspect result',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke: () => ({ state: 'data-ready', value: { rows: [{ id: 'hidden' }] } }),
    };
    const registry = createAgentCapabilityRegistry([inspect]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({
      registry: registry.value,
      host: {
        readContext: () => {
          reads++;
          return {
            ok: true as const,
            value: {
              principalKey: 'principal-1',
              regionId: 'region-1',
              goalEpoch: 'goal-1',
              grants: reads < 2 ? ['result.inspect' as const, 'model.egress' as const] : ['result.inspect' as const],
            },
          };
        },
      },
    });
    const result = await dispatcher.mcp.invoke(request({ capability: inspect.ref, operation: 'result.inspect' }));
    expect(result).toMatchObject({
      ok: true,
      value: { state: 'denied', diagnostics: [{ code: 'agent.capability.egress' }] },
    });
    expect(result.ok && result.value.value).toBeUndefined();
  });

  it('rejects data-bearing output references outside the current scope', async () => {
    const inspect: AgentCapabilityManifest = {
      ref: { id: 'result.inspect', revision: '1' },
      operation: 'result.inspect',
      label: 'Inspect result',
      parse: (input) => parseWireValue(input) as Outcome<never>,
      invoke: () => ({
        state: 'data-ready',
        affectedResults: [
          { id: 'result-1', revision: '1', outputId: 'rows', queryDigest: 'query-1', scopeDigest: 'scope-other' },
        ],
      }),
    };
    const current = {
      scopeDigest: 'scope-current',
      policyRevision: 'policy-1',
      taskRevision: 'task-1',
      regionRevision: 'region-1',
      catalogRevision: 'catalog-1',
      experienceRevision: 'experience-1',
      functionRegistryDigest: 'functions-1',
      results: [],
    };
    const registry = createAgentCapabilityRegistry([inspect]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const dispatcher = createAgentCapabilityDispatcher({
      registry: registry.value,
      host: {
        readContext: () => ({
          ok: true as const,
          value: {
            principalKey: 'principal-1',
            regionId: 'region-1',
            goalEpoch: 'goal-1',
            grants: ['result.inspect' as const],
            current,
          },
        }),
      },
    });
    const result = await dispatcher.dispatch(request({ capability: inspect.ref, operation: 'result.inspect' }));
    expect(result).toMatchObject({
      ok: true,
      value: { state: 'denied', diagnostics: [{ code: 'agent.capability.scope' }] },
    });
  });
});

describe('capability output authority', () => {
  it('does not hide model egress inside a proposal operation', async () => {
    const proposal: AgentCapabilityManifest = {
      ...manifest(() => ({ state: 'bound', value: { contextHint: 'private derived value' } })),
      operation: 'task.propose',
    };
    const registry = createAgentCapabilityRegistry([proposal]);
    if (!registry.ok) throw new Error('registry');
    const dispatcher = createAgentCapabilityDispatcher({ registry: registry.value, host: host(['task.propose']) });
    expect(await dispatcher.mcp.invoke(request({ operation: 'task.propose' }))).toMatchObject({
      ok: true,
      value: { state: 'denied' },
    });
  });
  it('rejects removal of pinned authority after a handler', async () => {
    const current = {
      scopeDigest: 's',
      policyRevision: 'p',
      taskRevision: 't',
      regionRevision: 'r',
      catalogRevision: 'c',
      experienceRevision: 'e',
      functionRegistryDigest: 'f',
      results: [],
    };
    let calls = 0;
    const registry = createAgentCapabilityRegistry([manifest(() => ({ state: 'data-ready', value: { rows: 1 } }))]);
    if (!registry.ok) throw new Error('registry');
    const dispatcher = createAgentCapabilityDispatcher({
      registry: registry.value,
      host: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'p',
            regionId: 'region-1',
            goalEpoch: 'goal-1',
            grants: ['catalog.read'],
            ...(++calls === 1 ? { current } : {}),
          },
        }),
      },
    });
    const result = await dispatcher.direct.invoke(request());
    expect(result).toMatchObject({ ok: true, value: { state: 'partial' } });
    expect(result.ok && result.value.value).toBeUndefined();
  });
  it('retains distinct reference tuples with delimiter characters', () => {
    const first = { ...manifest(() => ({ state: 'accepted' })), ref: { id: 'a@b', revision: 'c' } };
    const second = { ...first, ref: { id: 'a', revision: 'b@c' } };
    const registry = createAgentCapabilityRegistry([first, second]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(registry.value.get(first.ref)?.ref).toEqual(first.ref);
    expect(registry.value.get(second.ref)?.ref).toEqual(second.ref);
  });
});

it('rejects invented same-scope refs and permits freshly authorized evaluation outputs', async () => {
  const ref = { id: 'new', revision: '1', outputId: 'rows', queryDigest: 'q', scopeDigest: 's' };
  const current = {
    scopeDigest: 's',
    policyRevision: 'p',
    taskRevision: 't',
    regionRevision: 'r',
    catalogRevision: 'c',
    experienceRevision: 'e',
    functionRegistryDigest: 'f',
    results: [],
  };
  const registry = createAgentCapabilityRegistry([
    {
      ...manifest(() => ({ state: 'data-ready', value: { result: ref }, affectedResults: [ref] })),
      operation: 'task.evaluate',
    },
  ]);
  if (!registry.ok) throw new Error('registry');
  for (const publish of [false, true]) {
    let reads = 0;
    const dispatcher = createAgentCapabilityDispatcher({
      registry: registry.value,
      host: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'p',
            regionId: 'region-1',
            goalEpoch: 'goal-1',
            grants: ['task.evaluate'],
            current: { ...current, results: ++reads > 1 && publish ? [ref] : [] },
          },
        }),
      },
    });
    const outcome = await dispatcher.dispatch(request({ operation: 'task.evaluate' }));
    expect(outcome).toMatchObject({ ok: true, value: { state: publish ? 'data-ready' : 'denied' } });
  }
});

describe('external diagnostic egress', () => {
  it('redacts handler diagnostics, reasons and revisions without egress, including after revocation', async () => {
    const secret = 'SECRET-ROW-42';
    const registry = createAgentCapabilityRegistry([
      manifest(() => ({
        state: 'invalid',
        reason: secret,
        regionRevision: secret,
        diagnostics: [{ code: secret, message: secret, path: [secret], remedies: [secret], retryable: false }],
      })),
    ]);
    if (!registry.ok) throw new Error('registry');
    for (const transport of ['mcp', 'webmcp', 'byok'] as const) {
      let reads = 0;
      const dispatcher = createAgentCapabilityDispatcher({
        registry: registry.value,
        host: {
          readContext: () => {
            reads++;
            return host(reads === 1 ? ['catalog.read', 'model.egress'] : ['catalog.read']).readContext();
          },
        },
      });
      const receipt = await dispatcher.port(transport).invoke(request({ metadata: { note: secret } }));
      expect(receipt).toMatchObject({
        ok: true,
        value: { state: 'invalid', diagnostics: [{ code: 'agent.capability.invalid' }] },
      });
      expect(JSON.stringify(receipt)).not.toContain(secret);
    }
    const local = await createAgentCapabilityDispatcher({ registry: registry.value, host: host() }).manual.invoke(
      request(),
    );
    expect(JSON.stringify(local)).toContain(secret);
    const authorized = await createAgentCapabilityDispatcher({
      registry: registry.value,
      host: host(['catalog.read', 'model.egress']),
    }).mcp.invoke(request());
    expect(JSON.stringify(authorized)).toContain(secret);
  });

  it('never echoes custom host, parser or failed-outcome diagnostics across external boundaries', async () => {
    const secret = 'SECRET-ROW-42';
    const failure = { ok: false, diagnostics: [{ code: secret, message: secret, retryable: false }] } as const;
    for (const origin of ['host', 'parser', 'handler']) {
      const entry = {
        ...manifest(() => (origin === 'handler' ? failure : { state: 'accepted' as const })),
        ...(origin === 'parser' ? { parse: () => failure } : {}),
      };
      const registry = createAgentCapabilityRegistry([entry]);
      if (!registry.ok) throw new Error('registry');
      const dispatcher = createAgentCapabilityDispatcher({
        registry: registry.value,
        host: origin === 'host' ? { readContext: () => failure } : host(),
      });
      expect(JSON.stringify(await dispatcher.mcp.invoke(request()))).not.toContain(secret);
    }
  });
});
