import { expect, it } from 'vitest';
import { createActionFixture } from './fixtures/actions.js';

it('does not execute a preview after host authorization changes', async () => {
  const fixture = createActionFixture();
  const preview = await fixture.previewRefund();
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;

  fixture.host.revokeExecution();
  const result = await fixture.confirmAndExecute(preview.value);

  expect(result.ok).toBe(false);
  if (!result.ok) expect(['action.denied', 'action.stale']).toContain(result.diagnostics[0]?.code);
  expect(fixture.backend.effects).toHaveLength(0);
  fixture.dispose();
});

it('allows one execution when the same preview is submitted twice', async () => {
  const fixture = createActionFixture();
  const preview = await fixture.previewRefund();
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;

  const results = await Promise.all([
    fixture.confirmAndExecute(preview.value),
    fixture.confirmAndExecute(preview.value),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toHaveLength(1);
  expect(fixture.backend.effects).toHaveLength(1);
  fixture.dispose();
});

it('rejects changed payloads and entity revisions before a second effect', async () => {
  const fixture = createActionFixture();
  const firstPreview = await fixture.previewRefund({ amount: 25 });
  expect(firstPreview.ok).toBe(true);
  if (!firstPreview.ok) return;
  const first = await fixture.confirmAndExecute(firstPreview.value);
  expect(first.ok).toBe(true);

  const changedPayload = await fixture.previewRefund({ amount: 30 });
  expect(changedPayload.ok).toBe(true);
  if (!changedPayload.ok) return;
  const changed = await fixture.confirmAndExecute(changedPayload.value);
  expect(changed.ok).toBe(false);
  if (!changed.ok) expect(changed.diagnostics[0]?.code).toBe('action.idempotency');

  const stalePreview = await fixture.previewRefund({ amount: 40 });
  expect(stalePreview.ok).toBe(true);
  if (!stalePreview.ok) return;
  fixture.host.changeEntityRevision('invoice-revision-2');
  const stale = await fixture.confirmAndExecute(stalePreview.value);
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.diagnostics[0]?.code).toBe('action.stale');
  expect(fixture.backend.effects).toHaveLength(1);
  fixture.dispose();
});

it('retains ambiguity for inspect-before-retry and survives an action-port restart', async () => {
  const fixture = createActionFixture();
  const preview = await fixture.previewRefund();
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  fixture.backend.forceAmbiguous();
  const ambiguous = await fixture.confirmAndExecute(preview.value);
  expect(ambiguous.ok).toBe(true);
  if (ambiguous.ok) expect(ambiguous.value.state).toBe('ambiguous');

  const inspection = await fixture.port.inspect('refund-operation-1');
  expect(inspection).toMatchObject({ ok: true, value: { state: 'ambiguous', outputAvailable: false } });

  const restarted = fixture.restart();
  const retryPreview = await restarted.previewRefund();
  expect(retryPreview.ok).toBe(true);
  if (!retryPreview.ok) return;
  const retry = await restarted.confirmAndExecute(retryPreview.value);
  expect(retry.ok).toBe(true);
  if (retry.ok) expect(retry.value.state).toBe('executed');
  expect(restarted.backend.effects).toHaveLength(1);
  fixture.dispose();
  restarted.dispose();
});

it('reports cancellation after dispatch as ambiguity and does not claim a clean failure', async () => {
  const fixture = createActionFixture();
  const preview = await fixture.previewRefund();
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  const confirmation = await fixture.port.confirm(preview.value);
  expect(confirmation.ok).toBe(true);
  if (!confirmation.ok) return;

  const abort = new AbortController();
  abort.abort();
  const result = await fixture.port.execute(confirmation.value, { signal: abort.signal });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0]?.code).toBe('action.cancelled');
  expect(fixture.backend.effects).toHaveLength(0);
  fixture.dispose();
});
