import { expect, it } from 'vitest';
import { createScopeFixture } from './fixtures/scope.js';

it('keeps the dirty A controller and draft for Stay and missing guard input', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  f.host.setDirty(true);
  f.host.setGuard({ status: 'stay' });

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'cancelled',
    diagnosticCode: 'scope.guard-stay',
  });
  expect(f.currentOrders()).toBe(a);
  expect(f.scope.getSnapshot().selector).toEqual({ kind: 'workspace', id: 'acme' });

  f.host.setGuard({ status: 'needs-input' });
  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'needs-input',
    diagnosticCode: 'scope.guard-required',
    choices: ['save', 'discard', 'stay'],
  });
  expect(f.currentOrders()).toBe(a);
  await f.dispose();
});

it('activates B only after explicit Discard or a real successful Save', async () => {
  const discarded = await createScopeFixture();
  await discarded.activate('acme');
  discarded.host.setDirty(true);
  discarded.host.setGuard({ status: 'discard' });
  await expect(discarded.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'active',
  });
  await discarded.dispose();

  const saved = await createScopeFixture();
  await saved.activate('acme');
  saved.host.setDirty(true);
  let saveCalls = 0;
  saved.host.setGuard({
    status: 'save',
    save: async () => {
      saveCalls += 1;
      return { ok: true, value: undefined };
    },
  });
  await expect(saved.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'active',
  });
  expect(saveCalls).toBe(1);
  await saved.dispose();
});

it('does not activate B after a failed save or a draft edit during a pending guard', async () => {
  const failed = await createScopeFixture();
  await failed.activate('acme');
  failed.host.setDirty(true);
  failed.host.setGuard({
    status: 'save',
    save: () => ({
      ok: false,
      diagnostics: [{ code: 'scope.save-failed', message: 'Save failed.', retryable: true }],
    }),
  });
  await expect(failed.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'needs-input',
    diagnosticCode: 'scope.save-failed',
  });
  expect(failed.scope.getSnapshot().selector).toEqual({ kind: 'workspace', id: 'acme' });
  await failed.dispose();

  const edited = await createScopeFixture();
  await edited.activate('acme');
  edited.host.setDirty(true);
  const guard = edited.host.deferGuard();
  const pending = edited.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await guard.started;
  edited.host.setDirty(true);
  guard.resolve({ status: 'discard' });
  await expect(pending).resolves.toMatchObject({ status: 'stale', diagnosticCode: 'scope.transition-stale' });
  expect(edited.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(edited.scope.getSnapshot().pending).toBeUndefined();
  await edited.dispose();
});

it.each([
  [
    'throw',
    (): never => {
      throw new Error('save failed');
    },
  ],
  ['reject', (): Promise<never> => Promise.reject(new Error('save failed'))],
  ['undefined', (): undefined => undefined],
  ['empty diagnostics', (): unknown => ({ ok: false, diagnostics: [] })],
] as const)('contains a %s save outcome and retains authorized A', async (_label, save) => {
  const f = await createScopeFixture();
  await f.activate('acme');
  f.host.setDirty(true);
  f.host.setRawGuard({ status: 'save', save });

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'needs-input',
    diagnosticCode: 'scope.save-failed',
    choices: ['save', 'discard', 'stay'],
  });
  expect(f.host.events).not.toContain('activate:globex');
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('forces logout through an open guard and partitions opt-in recovery to old A', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  await a.request({ kind: 'browse' });
  f.host.setDirty(true);
  f.host.enableRecovery();
  const guard = f.host.deferGuard();
  const pending = f.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await guard.started;

  f.scope.invalidate('logout');
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'denied', selector: null, invalidationReason: 'logout' });
  expect(f.view.readRows()).toEqual([]);
  expect(['denied', 'disposed']).toContain(a.getSnapshot().phase);
  expect(a.getSnapshot()).toMatchObject({ state: { rows: [], selection: [] } });
  expect(f.host.recoveries).toEqual([{ selector: { kind: 'workspace', id: 'acme' }, policyRevision: 'policy-1' }]);
  guard.resolve({ status: 'stay' });
  await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
  expect(f.scope.getSnapshot().selector).toBeNull();
  await f.dispose();
});

it('rejects an unknown invalidation reason without changing the active scope', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const before = f.scope.getSnapshot();

  expect(() => f.scope.invalidate('host-invented-reason' as never)).toThrow(
    'Scope invalidation reasons must use the closed runtime contract.',
  );
  expect(f.scope.getSnapshot()).toBe(before);
  expect(f.currentOrders().getSnapshot().phase).not.toBe('disposed');
  await f.dispose();
});

it('masks A synchronously even when recovery and deactivation hooks throw', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  const a = f.currentOrders();
  await a.request({ kind: 'browse' });
  f.host.enableRecovery();
  f.host.failRecovery();
  f.host.failDeactivate();

  expect(() => f.scope.invalidate('revoked')).not.toThrow();
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'denied', selector: null });
  expect(['denied', 'disposed']).toContain(a.getSnapshot().phase);
  expect(a.getSnapshot()).toMatchObject({ state: { rows: [] } });
  expect(f.view.readRows()).toEqual([]);
  await f.dispose();
});

it('cleans pending state and returns a typed failure when capture-time host state throws', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  f.host.throwLeaveStateAfter(0);

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'failed',
    diagnosticCode: 'scope.guard-failed',
  });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('fails closed when capture throws and current A authority cannot be proved', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  f.host.throwLeaveStateAfter(0);
  f.host.throwAuthorize('acme');

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'denied',
  });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'denied', selector: null });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('contains repeated host leave-state failures during guard rechecks', async () => {
  const f = await createScopeFixture();
  await f.activate('acme');
  f.host.throwLeaveStateAfter(1);

  await expect(f.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toMatchObject({
    status: 'failed',
  });
  expect(f.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  expect(f.scope.getSnapshot().pending).toBeUndefined();
  await f.dispose();
});

it('rejects malformed JavaScript leave state and guard decisions without leaving A', async () => {
  const invalidState = await createScopeFixture();
  await invalidState.activate('acme');
  invalidState.host.setRawLeaveState({ kind: 'clean' });
  await expect(invalidState.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'needs-input',
    diagnosticCode: 'scope.guard-invalid',
    choices: ['save', 'discard', 'stay'],
  });
  expect(invalidState.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await invalidState.dispose();

  const invalidDecision = await createScopeFixture();
  await invalidDecision.activate('acme');
  invalidDecision.host.setDirty(true);
  invalidDecision.host.setRawGuard({ status: 'unexpected' });
  await expect(invalidDecision.scope.requestChange({ kind: 'workspace', id: 'globex' })).resolves.toEqual({
    status: 'needs-input',
    diagnosticCode: 'scope.guard-invalid',
    choices: ['save', 'discard', 'stay'],
  });
  expect(invalidDecision.scope.getSnapshot()).toMatchObject({ status: 'active', selector: { id: 'acme' } });
  await invalidDecision.dispose();
});
