import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createDataHttpHandler, createLocalDataService } from '@varendo/runtime/data';
import { budget, commerceFixture, hrFixture, registry } from './fixtures.mjs';

/** Local synthetic reference only. Production authentication belongs to the host. */
export async function startReferenceHost({ fixture = commerceFixture(), port = 0, authorize } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid reference port.');
  const sourceRows = Object.values(fixture.snapshot.records).reduce((total, rows) => total + rows.length, 0);
  const service = createLocalDataService({
    snapshot: fixture.snapshot,
    functionRegistry: registry,
    // Tighten the scan estimate to this immutable synthetic fixture; do not raise SDK ceilings.
    queryLimits: { maxRows: Math.max(1, sourceRows) },
    hostBudget: budget,
    authorize:
      authorize ??
      (() => ({ ok: true, value: { scopeDigest: 'synthetic-public', policyRevision: 'reference-policy-1' } })),
  });
  const handler = createDataHttpHandler({
    service,
    maxRequestBytes: 1_000_000,
    maxRequestMilliseconds: budget.maxMilliseconds,
    authenticate: () => ({ ok: true, value: { principal: 'synthetic-public' } }),
  });
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 5_000 }, async (incoming, outgoing) => {
    const abort = new AbortController();
    const cancelled = () => abort.abort();
    incoming.once('aborted', cancelled);
    outgoing.once('close', cancelled);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const method = incoming.method ?? 'GET';
      const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), {
        method,
        headers,
        signal: abort.signal,
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body === null) outgoing.end();
      else await pipeline(Readable.fromWeb(response.body), outgoing, { signal: abort.signal });
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      if (!outgoing.destroyed) outgoing.end('Reference request failed.');
    } finally {
      incoming.removeListener('aborted', cancelled);
      outgoing.removeListener('close', cancelled);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    service,
    fixture,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = await startReferenceHost({ fixture: process.argv.includes('--hr') ? hrFixture() : commerceFixture() });
  console.log(`Synthetic Varendo reference data service: ${host.url}`);
  console.log('Local fixture data only. No production authentication or data connection.');
  for (const event of ['SIGINT', 'SIGTERM'])
    process.once(event, () => {
      void host.close();
    });
}
