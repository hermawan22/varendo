import { expect, it, vi } from 'vitest';
import type { DataRecord } from '@varendo/runtime/data';
import { createRemotePeopleFixture } from './fixtures/remote.js';

const budget = {
  maxRows: 100,
  maxBytes: 100_000,
  maxMessages: 16,
  maxMilliseconds: 5_000,
  maxColumns: 16,
} as const;

function planBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1',
    requestId: 'remote-server-plan',
    catalogRevision: '1',
    target: { taskId: 'remote-server-task', outputId: 'primary' },
    query: {
      entity: 'people',
      fields: ['id'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
      page: { size: 25 },
    },
    budget,
    ...overrides,
  };
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function rowId(row: DataRecord): string {
  if (typeof row.id !== 'string') throw new Error('Expected an id projection.');
  return row.id;
}

it('isolates tenants and rejects a cursor outside the authenticated principal', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 100, pageSize: 10, aggregate: false });
  const tenantA = await f.requestPage({ principal: 'tenant-a' });
  const tenantB = await f.requestPage({ principal: 'tenant-b' });
  expect(tenantA.rows.map(rowId)).not.toEqual(tenantB.rows.map(rowId));
  expect(tenantA.rows.every((row) => rowId(row).startsWith('tenant-a-'))).toBe(true);
  expect(tenantB.rows.every((row) => rowId(row).startsWith('tenant-b-'))).toBe(true);
  if (tenantA.cursor === undefined) throw new Error('Tenant A must receive a continuation cursor.');
  await expect(f.requestPage({ principal: 'tenant-b', cursor: tenantA.cursor })).rejects.toThrow(
    'cursor does not belong',
  );
  await f.dispose();
});

it('does not accept authority spoofing and enforces method, origin, content type, and body limits', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 10, pageSize: 5, aggregate: false });
  const base = f.server.origin;
  const spoofed = await fetch(`${base}/adc/plan`, {
    method: 'POST',
    headers: { authorization: 'Bearer tenant-a', 'content-type': 'application/json' },
    body: JSON.stringify(planBody({ principal: 'tenant-b', scopeDigest: 'remote-scope-tenant-b' })),
  });
  expect(spoofed.status).toBe(400);

  const method = await fetch(`${base}/adc/plan`, { headers: { authorization: 'Bearer tenant-a' } });
  expect(method.status).toBe(405);

  const origin = await fetch(`${base}/adc/plan`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer tenant-a',
      origin: 'http://evil.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(planBody()),
  });
  expect(origin.status).toBe(403);

  const contentType = await fetch(`${base}/adc/plan`, {
    method: 'POST',
    headers: { authorization: 'Bearer tenant-a', 'content-type': 'text/plain' },
    body: JSON.stringify(planBody()),
  });
  expect(contentType.status).toBe(415);

  const tooLarge = await fetch(`${base}/adc/plan`, {
    method: 'POST',
    headers: { authorization: 'Bearer tenant-a', 'content-type': 'application/json' },
    body: `${JSON.stringify(planBody())}${' '.repeat(110_000)}`,
  });
  expect(tooLarge.status).toBe(413);
  await f.dispose();
});

it('returns structured stale errors for malformed cursors and observes real cancellation', async () => {
  const f = await createRemotePeopleFixture({
    logicalRows: 100,
    pageSize: 10,
    aggregate: false,
    waitForCancellationAfterDescriptor: true,
  });
  const malformed = await f.client.plan({
    version: '1',
    requestId: 'remote-malformed-cursor',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-cursor-task', outputId: 'primary' },
    query: {
      entity: 'people',
      fields: ['id'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
      page: { size: 10, cursor: 'not-a-valid-cursor' },
    },
    budget,
  });
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) expect(malformed.diagnostics[0]?.code).toBe('data.stale-cursor');

  const planned = await f.client.plan({
    version: '1',
    requestId: 'remote-cancel',
    catalogRevision: f.feature.catalog.revision,
    target: { taskId: 'remote-cancel-task', outputId: 'primary' },
    query: {
      entity: 'people',
      fields: ['id'],
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      order: [{ field: 'id', direction: 'asc', nulls: 'last' }],
      page: { size: 10 },
    },
    budget,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0]?.message);
  const controller = new AbortController();
  const events = f.client.execute(planned.value, { signal: controller.signal });
  const iterator = events[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    expect(first.done).toBe(false);
    controller.abort();
    await iterator.next();
    await vi.waitFor(() => expect(f.server.cancelledRequests).toContain('remote-cancel'));
  } finally {
    controller.abort();
    await iterator.return?.();
    await f.dispose();
  }
});

it('rejects malformed request envelopes with a correlated diagnostic', async () => {
  const f = await createRemotePeopleFixture({ logicalRows: 10, pageSize: 5, aggregate: false });
  const response = await fetch(`${f.server.origin}/adc/plan`, {
    method: 'POST',
    headers: { authorization: 'Bearer tenant-a', 'content-type': 'application/json' },
    body: JSON.stringify({ ...planBody(), requestId: 'malformed-request', query: { fields: ['id'] } }),
  });
  expect(response.status).toBe(400);
  const body = await jsonResponse(response);
  expect(body.requestId).toBe('unknown-request');
  expect(Array.isArray(body.diagnostics)).toBe(true);
  await f.dispose();
});
