import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ActionPreview, ActionReceipt } from '@varendo/runtime/actions';
import { createActionFixture, type ActionBackend, type ActionFixture } from './actions.js';

const CLIENT_TOKEN = 'Bearer action-client-fixture';
const HOST_TOKEN = 'Bearer action-host-fixture';

type JsonObject = Record<string, unknown>;

async function readBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 16_384) throw new RangeError('Request body is too large.');
    chunks.push(value);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('Expected a JSON object.');
  return parsed as JsonObject;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required.`);
  return value;
}

export interface ActionHttpFixture {
  readonly origin: string;
  readonly backend: ActionBackend;
  readonly host: ActionFixture['host'];
  readonly restartPort: () => void;
  readonly dispose: () => Promise<void>;
}

/** Runs the production ActionPort behind a local HTTP boundary with server-owned tokens and authority. */
export async function createActionHttpFixture(): Promise<ActionHttpFixture> {
  let fixture: ActionFixture = createActionFixture({ requireHostApproval: true });
  const backend = fixture.backend;
  const previews = new Map<string, ActionPreview>();
  const receipts = new Map<string, ActionReceipt>();

  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method !== 'POST') return send(response, 405, { error: 'method' });
      const isHostApproval = path === '/host/approve';
      if (request.headers.authorization !== (isHostApproval ? HOST_TOKEN : CLIENT_TOKEN))
        return send(response, 401, { error: 'unauthorized' });
      const body = await readBody(request);

      if (path === '/actions/preview') {
        const result = await fixture.port.preview(body);
        if (!result.ok) return send(response, 409, result);
        previews.set(result.value.id, result.value);
        return send(response, 200, {
          previewId: result.value.id,
          action: result.value.action,
          sideEffect: result.value.sideEffect,
          confirmation: result.value.confirmation,
        });
      }

      if (path === '/host/approve') {
        const previewId = token(body.previewId, 'previewId');
        if (!previews.has(previewId)) return send(response, 404, { error: 'unknown-preview' });
        fixture.host.approvePreview(previewId);
        return send(response, 200, { approved: true, previewId });
      }

      if (path === '/actions/confirm') {
        const previewId = token(body.previewId, 'previewId');
        const preview = previews.get(previewId);
        if (preview === undefined) return send(response, 404, { error: 'unknown-preview' });
        const result = await fixture.port.confirm(preview);
        if (!result.ok) return send(response, 409, result);
        previews.delete(previewId);
        receipts.set(result.value.id, result.value);
        return send(response, 200, { receiptId: result.value.id });
      }

      if (path === '/actions/execute') {
        const receiptId = token(body.receiptId, 'receiptId');
        const receipt = receipts.get(receiptId);
        if (receipt === undefined) return send(response, 404, { error: 'unknown-receipt' });
        const result = await fixture.port.execute(receipt);
        receipts.delete(receiptId);
        return send(response, result.ok ? 200 : 409, result);
      }

      if (path === '/actions/inspect') {
        const result = await fixture.port.inspect(token(body.idempotencyKey, 'idempotencyKey'));
        return send(response, result.ok ? 200 : 409, result);
      }

      send(response, 404, { error: 'not-found' });
    })().catch((error: unknown) => {
      send(response, 400, { error: error instanceof Error ? error.message : 'invalid-request' });
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind a TCP port.');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    backend,
    get host() {
      return fixture.host;
    },
    restartPort: () => {
      fixture.dispose();
      fixture = createActionFixture({ backend, requireHostApproval: true });
      previews.clear();
      receipts.clear();
    },
    dispose: async () => {
      fixture.dispose();
      server.close();
      await once(server, 'close');
    },
  };
}

export async function actionPost(
  origin: string,
  path: string,
  body: JsonObject,
  role: 'anonymous' | 'client' | 'host' = 'client',
): Promise<{ readonly status: number; readonly body: JsonObject }> {
  const authorization = role === 'host' ? HOST_TOKEN : role === 'client' ? CLIENT_TOKEN : undefined;
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as JsonObject };
}
