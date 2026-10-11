import { expect, it } from 'vitest';
import { z } from 'zod';
import { defineResource, type Outcome } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import * as appTools from '../../packages/agent/src/app/index.js';
import { connectMcpHttpClient, createMcpHttpHandler } from '../../packages/agent/src/mcp/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';
import { ActionRegistry, createActionPort } from '../../packages/runtime/src/actions/index.js';
import type { OperationGrant } from '../../packages/core/src/contracts/agent/index.js';

const ownerIdentity = { principalKey: 'owner', scopeDigest: 'scope' };

function setup() {
  const authority = {
    principalKey: 'owner',
    scopeDigest: 'scope',
    grants: ['catalog.read', 'action.propose', 'action.execute', 'model.egress'] as OperationGrant[],
  };
  let now = Date.now();
  let executions = 0;
  let confirm: () => Outcome<void> | Promise<Outcome<void>> = () => ({ ok: true, value: undefined });
  const registry = new ActionRegistry();
  const registered = registry.register({
    descriptor: {
      ref: { id: 'save', revision: '1' },
      input: { id: 'in', revision: '1' },
      output: { id: 'out', revision: '1' },
      sideEffect: 'domain-write',
      confirmation: 'required',
      idempotency: 'required',
      entityRevision: 'none',
    },
    inputSchema: { ref: { id: 'in', revision: '1' }, parse: () => ({ ok: true, value: {} }) },
    outputSchema: { ref: { id: 'out', revision: '1' }, parse: () => ({ ok: true, value: { saved: true } }) },
    dispatch: () => {
      executions++;
      return { state: 'completed', output: { saved: true } };
    },
  });
  if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  const actionPort = createActionPort({
    registry,
    host: {
      readContext: () => ({
        ok: true,
        value: {
          ...authority,
          actorKey: authority.principalKey,
          policyRevision: 'policy',
          domainRevision: 'domain',
          confirmationEpoch: 'confirmation',
          grants: ['action.propose', 'action.execute'],
        },
      }),
      issueConfirmation: () => confirm(),
    },
  });
  const resource = defineResource({
    id: 'people',
    label: 'People',
    description: 'Fixture',
    revision: '1',
    identity: ['id'],
    schema: z.object({ id: z.string() }),
    fields: {},
    presentation: { allowedViews: ['table'] },
  });
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error('Fixture functions rejected');
  const data = createLocalDataService({
    snapshot: { catalog: resource.catalog, sourceRevision: '1', records: { people: [] } },
    functionRegistry: functions.value,
    authorize: () => ({ ok: true, value: { scopeDigest: authority.scopeDigest, policyRevision: 'policy' } }),
  });
  const runtime = createAeliqoRuntime({
    resources: [{ resource, data }],
    actionPort,
    authority: {
      read: () => ({
        ok: true,
        value: { ...authority, policyRevision: 'policy', experienceRevision: '1', readContext: {} },
      }),
    },
  });
  runtime.mount({ regionId: 'region', resourceId: 'people' });
  const session = appTools.createAppToolSession({
    runtime,
    regionId: 'region',
    goalEpoch: 'goal',
    transport: 'mcp',
    expiresAt: now + 60_000,
    now: () => now,
  });
  if (!session.ok) throw new Error('Fixture session rejected');
  return {
    authority,
    runtime,
    actionPort,
    session: session.value,
    executions: () => executions,
    expire: () => {
      now += 60_001;
    },
    pauseConfirmation() {
      let start: () => void = () => undefined;
      let release: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      confirm = async () => {
        start();
        await released;
        return { ok: true, value: undefined };
      };
      return { started, release };
    },
    close: () => {
      session.value.close();
      runtime.dispose();
    },
  };
}

function previewId(outcome: Awaited<ReturnType<appTools.AeliqoAppToolEndpoint['invoke']>>): string {
  if (
    !outcome.ok ||
    outcome.value.value === null ||
    typeof outcome.value.value !== 'object' ||
    Array.isArray(outcome.value.value)
  )
    throw new Error('Fixture preview failed: ' + JSON.stringify(outcome));
  if (!('previewId' in outcome.value.value)) throw new Error('Fixture preview missing');
  const id = outcome.value.value.previewId;
  if (typeof id !== 'string') throw new Error('Fixture preview missing');
  return id;
}

async function preview(session: appTools.AeliqoAppToolSession) {
  const endpoint = session.createEndpoint(ownerIdentity);
  if (!endpoint.ok) throw new Error('Fixture endpoint rejected');
  const outcome = await endpoint.value.invoke(
    'aeliqo_act',
    { mode: 'preview', action: { id: 'save', revision: '1' }, input: {}, idempotencyKey: 'save-1' },
    { requestId: 'preview' },
  );
  endpoint.value.close();
  return previewId(outcome);
}

it('preserves host-confirmed action state through fresh stock MCP HTTP endpoints and rejects replay', async () => {
  const fixture = setup();
  let closedEndpoints = 0;
  const handler = createMcpHttpHandler({
    createEndpoint: () => {
      const endpoint = fixture.session.createEndpoint(ownerIdentity);
      if (!endpoint.ok) throw new Error('Fixture endpoint rejected');
      return {
        ...endpoint.value,
        close() {
          closedEndpoints++;
          endpoint.value.close();
        },
      };
    },
    authenticate: () => ({
      token: 'fixture',
      clientId: 'fixture',
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
  });
  const client = await connectMcpHttpClient({
    url: 'https://mock.invalid/mcp',
    targetRegionId: 'region',
    goalEpoch: 'goal',
    authProvider: { token: async () => 'fixture' },
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  try {
    expect(await client.discover()).toMatchObject({ ok: true });
    const outcome = await client.invoke(
      'aeliqo_act',
      { mode: 'preview', action: { id: 'save', revision: '1' }, input: {}, idempotencyKey: 'save-1' },
      { requestId: 'preview' },
    );
    previewId(outcome);
    expect(outcome).toMatchObject({ ok: true, value: { state: 'needs-choice' } });
    const id = previewId(outcome);
    expect(await client.invoke('aeliqo_act', { mode: 'execute', previewId: id }, { requestId: 'early' })).toMatchObject(
      { ok: true, value: { state: 'needs-choice' } },
    );
    expect(await fixture.session.confirmAction(id)).toMatchObject({ ok: true });
    expect(
      await client.invoke('aeliqo_act', { mode: 'execute', previewId: id }, { requestId: 'execute' }),
    ).toMatchObject({ ok: true, value: { state: 'accepted', value: { state: 'executed' } } });
    expect(
      await client.invoke('aeliqo_act', { mode: 'execute', previewId: id }, { requestId: 'replay' }),
    ).toMatchObject({ ok: true, value: { state: 'stale' } });
    expect(fixture.executions()).toBe(1);
    expect(closedEndpoints).toBeGreaterThan(4);
  } finally {
    client.close();
    await handler.close();
    fixture.close();
  }
});

it.each(['expiry', 'principal', 'scope', 'close', 'revocation'] as const)(
  'fences retained previews after %s',
  async (boundary) => {
    const fixture = setup();
    try {
      const id = await preview(fixture.session);
      if (boundary === 'expiry') fixture.expire();
      if (boundary === 'principal') fixture.authority.principalKey = 'other';
      if (boundary === 'scope') fixture.authority.scopeDigest = 'other';
      if (boundary === 'close') fixture.session.close();
      if (boundary === 'revocation') fixture.actionPort.revoke();
      expect(await fixture.session.confirmAction(id)).toMatchObject({ ok: false });
      expect(fixture.executions()).toBe(0);
      fixture.authority.principalKey = 'owner';
      fixture.authority.scopeDigest = 'scope';
      if (boundary !== 'revocation') expect(fixture.session.createEndpoint(ownerIdentity)).toMatchObject({ ok: false });
    } finally {
      fixture.close();
    }
  },
);

it('cancels abandoned previews only when their host session closes', async () => {
  const fixture = setup();
  try {
    await preview(fixture.session);
    expect(await fixture.actionPort.history()).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ state: 'preview' })],
    });
    fixture.session.close();
    expect(await fixture.actionPort.history()).toMatchObject({
      ok: true,
      value: expect.arrayContaining([expect.objectContaining({ state: 'rejected', reasonCode: 'action.cancelled' })]),
    });
  } finally {
    fixture.close();
  }
});

it.each(['expiry', 'principal', 'scope', 'close', 'revocation', 'execute-grant'] as const)(
  'rejects confirmed execution after %s',
  async (boundary) => {
    const fixture = setup();
    try {
      const id = await preview(fixture.session);
      expect(await fixture.session.confirmAction(id)).toMatchObject({ ok: true });
      const endpoint = fixture.session.createEndpoint(ownerIdentity);
      if (!endpoint.ok) throw new Error('Fixture endpoint rejected');
      if (boundary === 'expiry') fixture.expire();
      if (boundary === 'principal') fixture.authority.principalKey = 'other';
      if (boundary === 'scope') fixture.authority.scopeDigest = 'other';
      if (boundary === 'close') fixture.session.close();
      if (boundary === 'revocation') fixture.actionPort.revoke();
      if (boundary === 'execute-grant')
        fixture.authority.grants = fixture.authority.grants.filter((grant) => grant !== 'action.execute');
      const executed = await endpoint.value.invoke(
        'aeliqo_act',
        { mode: 'execute', previewId: id },
        { requestId: 'execute' },
      );
      expect(executed.ok && executed.value.state === 'accepted').toBe(false);
      expect(fixture.executions()).toBe(0);
      endpoint.value.close();
    } finally {
      fixture.close();
    }
  },
);

it('keeps admitted session identity and expiry when caller options are later retargeted', async () => {
  const fixture = setup();
  try {
    const options = {
      runtime: fixture.runtime,
      regionId: 'region',
      goalEpoch: 'original',
      transport: 'mcp' as const,
      expiresAt: Date.now() + 60_000,
    };
    const session = appTools.createAppToolSession(options);
    if (!session.ok) throw new Error('Fixture session rejected');
    options.regionId = 'other';
    options.goalEpoch = 'other';
    options.expiresAt = Infinity;
    const endpoint = session.value.createEndpoint(ownerIdentity);
    expect(endpoint).toMatchObject({ ok: true, value: { targetRegionId: 'region', goalEpoch: 'original' } });
    session.value.close();
  } finally {
    fixture.close();
  }
});

it.each(['principal', 'scope'] as const)(
  'rejects another authenticated MCP %s without changing runtime authority',
  async (boundary) => {
    const fixture = setup();
    const id = await preview(fixture.session);
    expect(await fixture.session.confirmAction(id)).toMatchObject({ ok: true });
    let token = 'owner-token';
    const handler = createMcpHttpHandler({
      authenticate: (request) => ({
        token: request.headers.get('authorization') ?? 'missing',
        clientId: 'fixture',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        extra:
          request.headers.get('authorization') === 'Bearer owner-token'
            ? ownerIdentity
            : {
                principalKey: boundary === 'principal' ? 'other' : 'owner',
                scopeDigest: boundary === 'scope' ? 'other' : 'scope',
              },
      }),
      createEndpoint: ({ authInfo }) => {
        const endpoint = fixture.session.createEndpoint({
          principalKey: String(authInfo?.extra?.principalKey),
          scopeDigest: String(authInfo?.extra?.scopeDigest),
        });
        if (!endpoint.ok) throw new Error('Authenticated pairing denied');
        return endpoint.value;
      },
    });
    const client = await connectMcpHttpClient({
      url: 'https://mock.invalid/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      authProvider: { token: async () => token },
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    try {
      expect(await client.discover()).toMatchObject({ ok: true });
      token = 'other-token';
      const other = await client.invoke(
        'aeliqo_act',
        { mode: 'execute', previewId: id },
        { requestId: 'other-execute' },
      );
      expect(other.ok && other.value.state === 'accepted').toBe(false);
      expect(fixture.executions()).toBe(0);
      token = 'owner-token';
      expect(
        await client.invoke('aeliqo_act', { mode: 'execute', previewId: id }, { requestId: 'owner-execute' }),
      ).toMatchObject({ ok: true, value: { state: 'accepted' } });
      expect(fixture.executions()).toBe(1);
    } finally {
      client.close();
      await handler.close();
      fixture.close();
    }
  },
);

it.each([null, {}, { runtime: null }, { runtime: {} }])(
  'returns an explicit failure for malformed session options %j',
  (input) => {
    expect(appTools.createAppToolSession(input as appTools.AppToolEndpointOptions)).toMatchObject({ ok: false });
  },
);

it('closing one borrowed endpoint aborts its pending host confirmation without authorizing execution', async () => {
  const fixture = setup();
  try {
    const id = await preview(fixture.session);
    const pending = fixture.pauseConfirmation();
    const endpoint = fixture.session.createEndpoint(ownerIdentity);
    if (!endpoint.ok) throw new Error('Fixture endpoint rejected');
    const confirmation = endpoint.value.confirmAction(id);
    await pending.started;
    endpoint.value.close();
    pending.release();
    expect(await confirmation).toMatchObject({ ok: false });
    const fresh = fixture.session.createEndpoint(ownerIdentity);
    if (!fresh.ok) throw new Error('Fixture endpoint rejected');
    expect(
      await fresh.value.invoke('aeliqo_act', { mode: 'execute', previewId: id }, { requestId: 'execute' }),
    ).toMatchObject({ ok: true, value: { state: 'stale' } });
    expect(fixture.executions()).toBe(0);
    fresh.value.close();
  } finally {
    fixture.close();
  }
});
