import { expect, it } from 'vitest';
import { actionPost, createActionHttpFixture } from './fixtures/action-http.js';

const refundRequest = {
  requestId: 'http-refund-request',
  action: { id: 'billing.refund', revision: '1' },
  input: { invoiceId: 'invoice-1', amount: 25 },
  entity: { key: 'invoice-1', revision: 'invoice-revision-1' },
  idempotencyKey: 'refund-operation-1',
};

function responseId(body: Record<string, unknown>, field: 'previewId' | 'receiptId'): string {
  const value = body[field];
  if (typeof value !== 'string') throw new Error(`HTTP response is missing ${field}.`);
  return value;
}

it('rejects anonymous requests on every action endpoint before any effect', async () => {
  const fixture = await createActionHttpFixture();
  try {
    const requests = [
      ['/actions/preview', refundRequest],
      ['/actions/confirm', { previewId: 'untrusted-preview' }],
      ['/actions/execute', { receiptId: 'untrusted-receipt' }],
      ['/actions/inspect', { idempotencyKey: 'refund-operation-1' }],
    ] as const;

    for (const [path, body] of requests) {
      const response = await actionPost(fixture.origin, path, body, 'anonymous');
      expect(response.status, `${path} should require client authentication`).toBe(401);
    }
    expect(fixture.backend.effects).toHaveLength(0);
  } finally {
    await fixture.dispose();
  }
});

it('rechecks authorization revision at server confirmation after a remote preview', async () => {
  const fixture = await createActionHttpFixture();
  try {
    const preview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(preview.status).toBe(200);
    expect(preview.body.sideEffect).toBe('domain-write');
    expect(fixture.backend.effects).toHaveLength(0);

    fixture.host.revokeExecution();
    const denied = await actionPost(fixture.origin, '/actions/confirm', {
      previewId: responseId(preview.body, 'previewId'),
    });

    expect(denied.status).toBe(409);
    expect(denied.body).toMatchObject({ ok: false });
    expect(JSON.stringify(denied.body)).toMatch(/action\.(denied|stale)/u);
    expect(fixture.backend.effects).toHaveLength(0);
  } finally {
    await fixture.dispose();
  }
});

it('rejects a confirmed receipt after the host entity revision changes', async () => {
  const fixture = await createActionHttpFixture();
  try {
    const preview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(preview.status).toBe(200);
    const previewId = responseId(preview.body, 'previewId');
    expect((await actionPost(fixture.origin, '/host/approve', { previewId }, 'host')).status).toBe(200);
    const confirmation = await actionPost(fixture.origin, '/actions/confirm', { previewId });
    expect(confirmation.status).toBe(200);

    fixture.host.changeEntityRevision('invoice-revision-2');
    const execution = await actionPost(fixture.origin, '/actions/execute', {
      receiptId: responseId(confirmation.body, 'receiptId'),
    });

    expect(execution.status).toBe(409);
    expect(JSON.stringify(execution.body)).toContain('action.stale');
    expect(fixture.backend.effects).toHaveLength(0);
  } finally {
    await fixture.dispose();
  }
});

it('requires an authenticated host approval and safely replays across HTTP and ActionPort restart', async () => {
  const fixture = await createActionHttpFixture();
  try {
    const preview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(preview.status).toBe(200);
    const previewId = responseId(preview.body, 'previewId');

    const clientApproval = await actionPost(fixture.origin, '/host/approve', { previewId }, 'client');
    expect(clientApproval.status).toBe(401);
    const unapprovedConfirmation = await actionPost(fixture.origin, '/actions/confirm', { previewId });
    expect(unapprovedConfirmation.status).toBe(409);
    expect(fixture.backend.effects).toHaveLength(0);

    const approval = await actionPost(fixture.origin, '/host/approve', { previewId }, 'host');
    expect(approval.status).toBe(200);
    const confirmation = await actionPost(fixture.origin, '/actions/confirm', { previewId });
    expect(confirmation.status).toBe(200);
    const firstExecution = await actionPost(fixture.origin, '/actions/execute', {
      receiptId: responseId(confirmation.body, 'receiptId'),
    });
    expect(firstExecution.status).toBe(200);
    expect(firstExecution.body).toMatchObject({ ok: true, value: { state: 'executed' } });
    expect(fixture.backend.effects).toHaveLength(1);

    fixture.restartPort();
    const replayPreview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(replayPreview.status).toBe(200);
    const replayId = responseId(replayPreview.body, 'previewId');
    expect((await actionPost(fixture.origin, '/host/approve', { previewId: replayId }, 'host')).status).toBe(200);
    const replayConfirmation = await actionPost(fixture.origin, '/actions/confirm', { previewId: replayId });
    expect(replayConfirmation.status).toBe(200);
    const replay = await actionPost(fixture.origin, '/actions/execute', {
      receiptId: responseId(replayConfirmation.body, 'receiptId'),
    });

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ ok: true, value: { state: 'executed', output: { refundId: 'refund-1' } } });
    expect(fixture.backend.effects).toHaveLength(1);
  } finally {
    await fixture.dispose();
  }
});

it('inspects an ambiguous server result and recovers it after ActionPort restart without a duplicate effect', async () => {
  const fixture = await createActionHttpFixture();
  try {
    const preview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(preview.status).toBe(200);
    const previewId = responseId(preview.body, 'previewId');
    expect((await actionPost(fixture.origin, '/host/approve', { previewId }, 'host')).status).toBe(200);
    const confirmation = await actionPost(fixture.origin, '/actions/confirm', { previewId });
    expect(confirmation.status).toBe(200);

    fixture.backend.forceAmbiguous();
    const execution = await actionPost(fixture.origin, '/actions/execute', {
      receiptId: responseId(confirmation.body, 'receiptId'),
    });
    expect(execution.status).toBe(200);
    expect(execution.body).toMatchObject({ ok: true, value: { state: 'ambiguous' } });
    expect(fixture.backend.effects).toHaveLength(1);

    const inspection = await actionPost(fixture.origin, '/actions/inspect', {
      idempotencyKey: 'refund-operation-1',
    });
    expect(inspection.status).toBe(200);
    expect(inspection.body).toMatchObject({ ok: true, value: { state: 'ambiguous', outputAvailable: false } });

    fixture.restartPort();
    const retryPreview = await actionPost(fixture.origin, '/actions/preview', refundRequest);
    expect(retryPreview.status).toBe(200);
    const retryPreviewId = responseId(retryPreview.body, 'previewId');
    expect((await actionPost(fixture.origin, '/host/approve', { previewId: retryPreviewId }, 'host')).status).toBe(200);
    const retryConfirmation = await actionPost(fixture.origin, '/actions/confirm', {
      previewId: retryPreviewId,
    });
    expect(retryConfirmation.status).toBe(200);
    const retry = await actionPost(fixture.origin, '/actions/execute', {
      receiptId: responseId(retryConfirmation.body, 'receiptId'),
    });

    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      ok: true,
      value: { state: 'executed', output: { refundId: 'refund-1' } },
    });
    expect(fixture.backend.effects).toHaveLength(1);
  } finally {
    await fixture.dispose();
  }
});
