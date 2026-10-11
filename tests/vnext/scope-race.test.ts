import { expect, it } from 'vitest';
import { createScopeFixture } from './fixtures/scope.js';

it('never retargets a captured A handle or accepts its late result after A-B-A', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a1 = f.currentOrders();
  const deferred = f.source.deferNext();
  const pending = a1.request({ kind: 'browse' });
  await deferred.started;
  expect((await f.scope.requestChange({ kind: 'workspace', id: 'globex' })).status).toBe('active');
  expect(f.view.readRows()).not.toContainEqual(f.source.acmePrivateRow);
  expect(['stale', 'cancelled', 'disposed']).toContain((await a1.request({ kind: 'browse' })).status);
  expect((await f.scope.requestChange({ kind: 'workspace', id: 'acme' })).status).toBe('active');
  const a2 = f.currentOrders();
  expect(a2.address.activationEpoch).toBeGreaterThan(a1.address.activationEpoch);
  expect(a2).not.toBe(a1);
  await a2.request({ kind: 'browse' }); // a fresh A2 read, not the deferred A1 read
  const beforeLateA1 = a2.getSnapshot();
  await f.release('acme'); // wait for the observed A1 transport completion, ignoring cancellation
  const outcome = await pending;
  expect(['stale', 'cancelled']).toContain(outcome.status);
  expect(a2.getSnapshot()).toBe(beforeLateA1);
  await f.dispose();
});

it('clears a cancelled pending resolution and fences an observed in-flight request', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  expect(f.fenceSubscriptions()).toBe(0);
  const source = f.source.deferNext();
  const read = f.currentOrders().request({ kind: 'browse' });
  await source.started;
  expect(f.fenceSubscriptions()).toBe(1);

  const delayed = f.host.deferResolve('globex');
  const controller = new AbortController();
  const pending = f.scope.requestChange({ kind: 'workspace', id: 'globex' }, { signal: controller.signal });
  await delayed.started;
  controller.abort();
  delayed.resolve();
  await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  source.resolve();
  await read;
  expect(f.fenceSubscriptions()).toBe(0);
  await f.dispose();
});

it('reauthorizes B after the final awaited A check before starting any B effect', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const finalA = f.host.deferAuthorize('acme', 2);
  const pending = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await finalA.started;
  f.host.revoke('globex');
  finalA.resolve();

  await expect(pending).resolves.toMatchObject({ status: 'denied' });
  expect(f.host.events).not.toContain('activate:globex');
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('rechecks the captured A draft synchronously after final B authorization', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const finalB = f.host.deferAuthorize('globex', 1);
  const pending = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await finalB.started;
  f.host.setDirty(true);
  finalB.resolve();

  await expect(pending).resolves.toEqual({ status: 'stale', diagnosticCode: 'scope.transition-stale' });
  expect(f.host.events).not.toContain('activate:globex');
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await f.dispose();
});

it('atomically rejects revoked A or B authority at the synchronous preparation boundary', async () => {
  const revokedA = await createScopeFixture();
  await revokedA.activate('acme');
  const finalB = revokedA.host.deferAuthorize('globex', 1);
  const pending = revokedA.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await finalB.started;
  revokedA.host.revoke('acme');
  finalB.resolve();

  await expect(pending).resolves.toMatchObject({ status: 'denied' });
  expect(revokedA.host.events).not.toContain('activate:globex');
  expect(revokedA.scope.getSnapshot()).toMatchObject({ status: 'denied', selector: null });
  await revokedA.dispose();

  const revokedB = await createScopeFixture();
  await revokedB.activate('acme');
  revokedB.host.revokeAfterAuthorize('globex', 1);
  await expect(revokedB.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'denied',
  });
  expect(revokedB.host.events).not.toContain('activate:globex');
  expect(revokedB.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await revokedB.dispose();
});

it('returns a pre-aborted request without changing the active transition', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const b = f.host.deferResolve('globex');
  const pendingB = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await b.started;
  const aborted = new AbortController();
  aborted.abort();

  await expect(
    f.scope.requestChange({ kind: 'workspace', id: 'initech' }, { signal: aborted.signal }),
  ).resolves.toEqual({ status: 'cancelled', diagnosticCode: 'scope.transition-cancelled' });
  expect(f.scope.getSnapshot()).toMatchObject({ pending: { selector: { id: 'globex' } } });
  b.resolve();
  await expect(pendingB).resolves.toMatchObject({ status: 'active', selector: { id: 'globex' } });
  await f.dispose();
});

it('does not start a transition for a pre-aborted request', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  const aborted = new AbortController();
  aborted.abort();

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' }, { signal: aborted.signal })).resolves.toEqual(
    { status: 'cancelled', diagnosticCode: 'scope.transition-cancelled' },
  );
  expect(f.currentOrders()).toBe(a);
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('does not supersede live work when selector normalization aborts the new request', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const delayedB = f.host.deferResolve('globex');
  const pendingB = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await delayedB.started;
  const controller = new AbortController();
  const selector = {
    get kind() {
      controller.abort();
      return 'workspace';
    },
    id: 'initech',
  };

  await expect(f.scope.requestChange(selector, { signal: controller.signal })).resolves.toEqual({
    status: 'cancelled',
    diagnosticCode: 'scope.transition-cancelled',
  });
  expect(f.scope.getSnapshot()).toMatchObject({ pending: { selector: { id: 'globex' } } });
  delayedB.resolve();
  await expect(pendingB).resolves.toMatchObject({ status: 'active', selector: { id: 'globex' } });

  const same = new AbortController();
  const activeSelector = {
    get kind() {
      same.abort();
      return 'workspace';
    },
    id: 'globex',
  };
  await expect(f.scope.requestChange(activeSelector, { signal: same.signal })).resolves.toEqual({
    status: 'cancelled',
    diagnosticCode: 'scope.transition-cancelled',
  });
  await f.dispose();
});

it('rejects non-string selector parts and malformed trusted-host resolutions', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const resolveCalls = f.host.resolveCalls;

  await expect(f.scope.requestChange({ kind: 42, id: 'globex' } as never)).rejects.toThrow(
    'Scope selectors require bounded kind and id values.',
  );
  expect(f.host.resolveCalls).toBe(resolveCalls);

  const invalidPolicy = f.host.deferResolve('globex');
  const policyTransition = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await invalidPolicy.started;
  invalidPolicy.resolve({
    ok: true,
    value: {
      selector: { kind: 'workspace', id: 'globex' },
      permissionRevision: 1,
      policyRevision: 42,
      allowedFeatures: ['orders'],
    } as never,
  });
  await expect(policyTransition).resolves.toEqual({ status: 'failed', diagnosticCode: 'scope.resolve-invalid' });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });

  const invalidFeature = f.host.deferResolve('initech');
  const featureTransition = f.scope.requestChange({ kind: 'workspace', id: 'initech' });
  await invalidFeature.started;
  invalidFeature.resolve({
    ok: true,
    value: {
      selector: { kind: 'workspace', id: 'initech' },
      permissionRevision: 1,
      policyRevision: 'policy-1',
      allowedFeatures: [42],
    } as never,
  });
  await expect(featureTransition).resolves.toEqual({ status: 'failed', diagnosticCode: 'scope.resolve-invalid' });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });

  const invalidFeatureList = f.host.deferResolve('umbrella');
  const featureListTransition = f.scope.requestChange({ kind: 'workspace', id: 'umbrella' });
  await invalidFeatureList.started;
  invalidFeatureList.resolve({
    ok: true,
    value: {
      selector: { kind: 'workspace', id: 'umbrella' },
      permissionRevision: 1,
      policyRevision: 'policy-1',
      allowedFeatures: 'orders',
    } as never,
  });
  await expect(featureListTransition).resolves.toEqual({
    status: 'failed',
    diagnosticCode: 'scope.resolve-invalid',
  });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await f.dispose();
});

it('reports resolver and target-permission exceptions at their actual transition stage', async () => {
  const resolver = await createScopeFixture();
  await resolver.activate('acme');
  resolver.host.throwResolve('globex');
  await expect(resolver.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'failed',
    diagnosticCode: 'scope.transition-failed',
  });
  expect(resolver.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await resolver.dispose();

  const permission = await createScopeFixture();
  await permission.activate('acme');
  permission.host.throwAuthorize('globex');
  await expect(permission.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'failed',
    diagnosticCode: 'scope.permission-check-failed',
  });
  expect(permission.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await permission.dispose();
});

it('contains getter-throwing resolve and permission outcomes at their host stage', async () => {
  const throwingOutcome = () =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') return undefined;
          throw new Error('outcome getter failed');
        },
      },
    );

  const resolver = await createScopeFixture();
  await resolver.activate('acme');
  const delayed = resolver.host.deferResolve('globex');
  const resolving = resolver.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await delayed.started;
  delayed.resolve(throwingOutcome() as never);
  await expect(resolving).resolves.toEqual({ status: 'failed', diagnosticCode: 'scope.resolve-invalid' });
  expect(resolver.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(resolver.scope.getSnapshot().pending).toBeUndefined();
  await resolver.dispose();

  const permission = await createScopeFixture();
  await permission.activate('acme');
  permission.host.setRawAuthorize('globex', throwingOutcome());
  await expect(permission.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'failed',
    diagnosticCode: 'scope.permission-check-failed',
  });
  expect(permission.host.events).not.toContain('activate:globex');
  expect(permission.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await permission.dispose();
});

it('lets C win out-of-order A-B-C membership resolution and disposes fenced children', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  const b = f.host.deferResolve('globex');
  const bPending = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await b.started;
  const c = f.host.deferResolve('initech');
  const cPending = f.scope.requestChange({ kind: 'workspace', id: 'initech' });
  await c.started;
  c.resolve();
  await expect(cPending).resolves.toMatchObject({ status: 'active', selector: { id: 'initech' } });
  const active = f.currentOrders();
  b.resolve();
  await expect(bPending).resolves.toMatchObject({ status: 'cancelled' });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'initech' } });
  expect(f.currentOrders()).toBe(active);
  expect(a.getSnapshot().phase).toBe('disposed');
  expect(f.fenceSubscriptions()).toBe(0);
  await f.dispose();
});

it('rejects an A cursor in B through the real runtime data and result path', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  await expect(a.request({ kind: 'browse', page: { size: 1 } })).resolves.toMatchObject({ status: 'committed' });
  const cursor = a.getSnapshot().state.cursor;
  expect(cursor).toBeTypeOf('string');
  if (cursor === undefined) throw new TypeError('Expected an A cursor.');

  await f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  const b = f.currentOrders();
  await expect(b.request({ kind: 'browse', page: { size: 1, cursor } })).resolves.not.toMatchObject({
    status: 'committed',
  });
  expect(b.getSnapshot().state.rows).toEqual([]);
  await f.dispose();
});

it('revokes A previews while preserving a late executing backend effect as A work', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const portA = f.actions.current();
  const preview = await portA.preview({
    requestId: 'preview-a',
    action: f.actions.descriptor.ref,
    input: { id: 'order-a' },
    idempotencyKey: 'preview-a',
  });
  if (!preview.ok) throw new Error(preview.diagnostics[0].message);
  await f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  const deniedConfirmation = await portA.confirm(preview.value);
  expect(deniedConfirmation).toMatchObject({ ok: false, diagnostics: [{ code: 'action.revoked' }] });
  expect(f.actions.current()).not.toBe(portA);
  await f.dispose();

  const executing = await createScopeFixture();
  await executing.activate('acme');
  const executingPort = executing.actions.current();
  const nextPreview = await executingPort.preview({
    requestId: 'execute-a',
    action: executing.actions.descriptor.ref,
    input: { id: 'order-a' },
    idempotencyKey: 'execute-a',
  });
  if (!nextPreview.ok) throw new Error(nextPreview.diagnostics[0].message);
  const receipt = await executingPort.confirm(nextPreview.value);
  if (!receipt.ok) throw new Error(receipt.diagnostics[0].message);
  const dispatch = executing.actions.deferNextDispatch();
  const running = executingPort.execute(receipt.value);
  await dispatch.started;
  await executing.scope.requestChange({ kind: 'workspace', id: 'globex' });
  dispatch.resolve({ state: 'completed', output: { saved: true } });
  await expect(running).resolves.toMatchObject({ ok: true, value: { state: 'ambiguous' } });
  expect(executing.actions.backendEffects).toEqual([{ scopeId: 'acme', input: { id: 'order-a' } }]);
  await executing.dispose();
});

it('retires a controlled A proposal before a late host acceptance', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const controlled = f.createControlledOrders();
  const proposed = await controlled.surface.request({ kind: 'browse' });
  if (proposed.status !== 'proposed') throw new Error('Expected a controlled proposal.');
  expect(f.fenceSubscriptions()).toBe(1);
  await f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  controlled.accept(proposed.proposalId);
  expect(controlled.surface.getSnapshot()).toMatchObject({ state: { rows: [] } });
  expect(['denied', 'disposed']).toContain(controlled.surface.getSnapshot().phase);
  expect(f.fenceSubscriptions()).toBe(0);
  await f.dispose();
});

it('keeps child registration and Region ownership bounded across repeated A-B-A activations', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  let previous = f.currentOrders();
  let generation = previous.address.surfaceGeneration;

  for (let index = 0; index < 20; index++) {
    const id = index % 2 === 0 ? 'globex' : 'acme';
    await expect(f.scope.requestChange({ kind: 'workspace', id })).resolves.toMatchObject({ status: 'active' });
    const current = f.currentOrders();
    expect(previous.getSnapshot().phase).toBe('disposed');
    expect(current.address.surfaceGeneration).toBeGreaterThan(generation);
    expect(f.fenceSubscriptions()).toBe(0);
    generation = current.address.surfaceGeneration;
    previous = current;
  }

  expect(f.retiredSurfaces()).toBe(20);
  await expect(f.currentOrders().request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  await f.dispose();
});

it('runtime disposal releases an active scope, live request, Region, and controlled proposal', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  await expect(f.currentOrders().request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  expect(f.runtimeState('surface-1')?.results.length).toBeGreaterThan(0);
  expect(f.actions.hasActive()).toBe(true);
  const source = f.source.deferNext();
  const read = f.currentOrders().request({ kind: 'browse' });
  await source.started;
  const controlled = f.createControlledOrders();
  const proposal = await controlled.surface.request({ kind: 'browse' });
  expect(proposal).toMatchObject({ status: 'proposed' });
  if (proposal.status !== 'proposed') throw new TypeError('Expected a controlled proposal.');

  f.disposeRuntime();
  expect(f.scope.getSnapshot().status).toBe('disposed');
  expect(f.currentOrders().getSnapshot().phase).toBe('disposed');
  expect(controlled.surface.getSnapshot().phase).toBe('disposed');
  expect(f.fenceSubscriptions()).toBe(0);
  expect(f.runtimeState('surface-1')).toBeUndefined();
  expect(f.actions.hasActive()).toBe(false);
  controlled.accept(proposal.proposalId);
  expect(controlled.surface.getSnapshot()).toMatchObject({ phase: 'disposed', state: { rows: [] } });
  source.resolve();
  await expect(read).resolves.toMatchObject({ status: expect.stringMatching(/cancelled|stale|disposed/) });
  expect(f.currentOrders().getSnapshot()).toMatchObject({ phase: 'disposed', state: { rows: [] } });
  await f.dispose();
});
