import type { Outcome } from '@varendo/core';
import { isRecord } from './guards.js';
import {
  abortBridgeCalls,
  cancelBridgeCall,
  dispatchBridgeCall,
  parseChannelEvent,
  type BridgeCall,
  type BridgeEndpoints,
  type BridgeOperation,
  type BridgeTransport,
} from './bridge-calls.js';
import type { LocalSession } from './session.js';

const BRIDGE_CALL_KEYS = new Set(['id', 'transport', 'operation', 'name', 'input', 'requestId']);

const LOCAL_REJECTION: Outcome<unknown> = {
  ok: false,
  diagnostics: [
    { code: 'playground.local-call', message: 'The browser rejected the local host call.', retryable: false },
  ],
};

export interface LocalHostConnection {
  close(): void;
}

function hasUnknownBridgeFields(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).some((key) => !BRIDGE_CALL_KEYS.has(key));
}

function isBridgeTransport(value: unknown): value is BridgeTransport {
  return value === 'byok' || value === 'mcp';
}

function isBridgeOperation(value: unknown): value is BridgeOperation {
  return value === 'authorize' || value === 'discover' || value === 'invoke';
}

function hasValidInvokeArguments(operation: BridgeOperation, value: Readonly<Record<string, unknown>>): boolean {
  return operation !== 'invoke' || (typeof value.name === 'string' && typeof value.requestId === 'string');
}

function bridgeCall(value: unknown): BridgeCall | undefined {
  if (!isRecord(value)) return undefined;
  const call = value;
  if (hasUnknownBridgeFields(call)) return undefined;
  if (typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(call.id)) return undefined;
  if (!isBridgeTransport(call.transport) || !isBridgeOperation(call.operation)) return undefined;
  if (!hasValidInvokeArguments(call.operation, call)) return undefined;
  return {
    id: call.id,
    transport: call.transport,
    operation: call.operation,
    ...(typeof call.name === 'string' ? { name: call.name } : {}),
    ...(Object.hasOwn(call, 'input') ? { input: call.input } : {}),
    ...(typeof call.requestId === 'string' ? { requestId: call.requestId } : {}),
  };
}

async function acknowledge(id: string, outcome: Outcome<unknown>): Promise<void> {
  const response = await fetch('/api/varendo/ack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, outcome }),
  });
  if (!response.ok) throw new Error(`Local host acknowledgment failed (${response.status}).`);
}

async function connectEndpoints(session: LocalSession): Promise<BridgeEndpoints> {
  const [byok, mcp] = await Promise.all([
    session.connectAgent('byok', 'local-agent'),
    session.connectAgent('mcp', 'local-agent'),
  ]);
  if (byok.ok && mcp.ok) return { byok: byok.value, mcp: mcp.value };
  if (byok.ok) byok.value.close();
  if (mcp.ok) mcp.value.close();
  let message = 'The browser Region could not be paired.';
  if (!byok.ok) message = byok.diagnostics[0]?.message ?? message;
  else if (!mcp.ok) message = mcp.diagnostics[0]?.message ?? message;
  throw new Error(message);
}

/** Pairs the local process with the browser-owned Region; no model key enters the page. */
export async function connectLocalHost(session: LocalSession, onDisconnect: () => void): Promise<LocalHostConnection> {
  const endpoints = await connectEndpoints(session);
  const pending = new Map<string, AbortController>();
  const events = new EventSource('/api/varendo/events');
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('The local host event stream did not become ready.')),
      5_000,
    );
    events.addEventListener(
      'open',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    events.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        reject(new Error('The local host event stream is unavailable.'));
      },
      { once: true },
    );
  }).catch((cause: unknown) => {
    events.close();
    endpoints.byok.close();
    endpoints.mcp.close();
    throw cause;
  });

  events.addEventListener('call', (event) => {
    const call = bridgeCall(parseChannelEvent(event));
    if (call !== undefined) dispatchBridgeCall(call, endpoints, pending, acknowledge, LOCAL_REJECTION);
  });
  events.addEventListener('cancel', (event) => cancelBridgeCall(pending, parseChannelEvent(event)));

  let closed = false;
  const connection = Object.freeze({
    close() {
      if (closed) return;
      closed = true;
      events.close();
      abortBridgeCalls(pending);
      endpoints.byok.close();
      endpoints.mcp.close();
      void fetch('/api/varendo/disconnect', { method: 'POST', keepalive: true }).catch(() => undefined);
    },
  });
  events.addEventListener('error', () => {
    if (closed) return;
    connection.close();
    onDisconnect();
  });
  return connection;
}
