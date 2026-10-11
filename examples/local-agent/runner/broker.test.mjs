import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserSessionBroker } from './broker.mjs';

test('bridges a bounded tool outcome to the matching pending call', async () => {
  const broker = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000 });
  let sent;
  const attachment = broker.attach(
    (_event, value) => {
      sent = value;
    },
    () => {},
  );
  assert.notEqual(attachment, undefined);
  const pending = broker.endpoint('mcp').discover();
  assert.equal(sent.operation, 'discover');
  assert.equal(sent.transport, 'mcp');
  assert.equal(broker.acknowledge(sent.id, { ok: true, value: [{ name: 'aeliqo_context' }] }), true);
  assert.deepEqual(await pending, { ok: true, value: [{ name: 'aeliqo_context' }] });
  broker.dispose();
});

test('rejects stale acknowledgments and isolates a replacement stream', async () => {
  const broker = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000 });
  let firstClosed = false;
  const first = broker.attach(
    () => {},
    () => {
      firstClosed = true;
    },
  );
  const second = broker.attach(
    () => {},
    () => {},
  );
  assert.equal(firstClosed, true);
  broker.detach(first);
  assert.equal(broker.connected, true);
  broker.detach(second);
  assert.equal(broker.connected, false);
  assert.equal(broker.acknowledge('unknown', { ok: true, value: {} }), false);
});

test('cancels in-flight work without accepting a late result', async () => {
  const broker = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000 });
  const events = [];
  broker.attach(
    (event, value) => events.push({ event, value }),
    () => {},
  );
  const controller = new AbortController();
  const pending = broker.endpoint('byok').authorizeModel({ signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'playground.local-cancelled');
  assert.equal(events.at(-1).event, 'cancel');
  assert.equal(broker.acknowledge(events[0].value.id, { ok: true, value: { principalKey: 'late' } }), false);
  broker.dispose();
});

test('fails immediately when work is already cancelled or the browser stream cannot write', async () => {
  const cancelled = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000 });
  const events = [];
  cancelled.attach(
    (event, value) => events.push({ event, value }),
    () => {},
  );
  const controller = new AbortController();
  controller.abort();
  const aborted = await cancelled.endpoint('mcp').discover({ signal: controller.signal });
  assert.equal(aborted.ok, false);
  assert.equal(aborted.diagnostics[0].code, 'playground.local-cancelled');
  assert.deepEqual(events, []);
  cancelled.dispose();

  const disconnected = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000, maxPending: 1 });
  disconnected.attach(
    () => {
      throw new Error('stream closed');
    },
    () => {},
  );
  const failed = await disconnected.endpoint('mcp').discover();
  assert.equal(failed.ok, false);
  assert.equal(failed.diagnostics[0].code, 'playground.local-disconnected');
  disconnected.dispose();
});

test('expires and enforces the pending-call limit', async () => {
  const expired = new BrowserSessionBroker({ expiresAt: Date.now() - 1 });
  assert.equal(
    expired.attach(
      () => {},
      () => {},
    ),
    undefined,
  );
  assert.equal((await expired.endpoint('mcp').discover()).ok, false);

  const broker = new BrowserSessionBroker({ expiresAt: Date.now() + 60_000, maxPending: 1 });
  let sent;
  broker.attach(
    (_event, value) => {
      sent = value;
    },
    () => {},
  );
  const first = broker.endpoint('mcp').discover();
  const second = await broker.endpoint('mcp').discover();
  assert.equal(second.ok, false);
  assert.equal(second.diagnostics[0].code, 'playground.local-busy');
  broker.acknowledge(sent.id, { ok: true, value: [] });
  await first;
  broker.dispose();
});

test('replacement and expiry cancel pending work and reject stale acknowledgments', async () => {
  const broker = new BrowserSessionBroker({ expiresAt: Date.now() + 100 });
  let sent;
  broker.attach(
    (_event, value) => {
      sent = value;
    },
    () => {},
  );
  const pending = broker.endpoint('mcp').discover();
  broker.attach(
    () => {},
    () => {},
  );
  assert.equal(broker.acknowledge(sent.id, { ok: true, value: [] }), false);
  assert.equal((await pending).ok, false);
  const expiring = broker.endpoint('mcp').discover();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(broker.connected, false);
  assert.equal((await expiring).ok, false);
  broker.dispose();
});
