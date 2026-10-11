/** Dispatch bounded local host calls to the browser-owned application endpoint. */
import type { Outcome } from '@varendo/core';
import type { AgentModelToolEndpoint, AgentToolEndpoint } from '@varendo/agent/protocol';
import { isRecord } from './guards.js';

export type BridgeTransport = 'byok' | 'mcp';
export type BridgeOperation = 'authorize' | 'discover' | 'invoke';

export interface BridgeCall {
  readonly id: string;
  readonly transport: BridgeTransport;
  readonly operation: BridgeOperation;
  readonly name?: string;
  readonly input?: unknown;
  readonly requestId?: string;
}

export type BridgeEndpoints = Readonly<Record<BridgeTransport, AgentModelToolEndpoint>>;

const AUTHORIZE_NOT_FOR_MCP: Outcome<unknown> = {
  ok: false,
  diagnostics: [
    { code: 'playground.local-operation', message: 'MCP does not expose model authorization.', retryable: false },
  ],
};

/** Parses one channel MessageEvent payload; non-text or non-JSON frames are ignored. */
export function parseChannelEvent(event: Event): unknown {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return undefined;
  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    return undefined;
  }
}

async function invokeBridgeCall(
  call: BridgeCall,
  endpoints: BridgeEndpoints,
  signal: AbortSignal,
): Promise<Outcome<unknown>> {
  const endpoint: AgentToolEndpoint = endpoints[call.transport];
  if (call.operation === 'authorize') {
    if (call.transport !== 'byok') return AUTHORIZE_NOT_FOR_MCP;
    return endpoints.byok.authorizeModel({ signal });
  }
  if (call.operation === 'discover') return endpoint.discover({ signal });
  return endpoint.invoke(call.name ?? '', call.input, { requestId: call.requestId ?? call.id, signal });
}

/**
 * Runs one parsed call against the endpoints and acknowledges the result —
 * or the supplied safe rejection — on the channel's own ack endpoint.
 */
export function dispatchBridgeCall(
  call: BridgeCall,
  endpoints: BridgeEndpoints,
  pending: Map<string, AbortController>,
  acknowledge: (id: string, outcome: Outcome<unknown>) => Promise<void>,
  rejection: Outcome<unknown>,
): void {
  const controller = new AbortController();
  pending.set(call.id, controller);
  void invokeBridgeCall(call, endpoints, controller.signal)
    .then((outcome) => acknowledge(call.id, outcome))
    .catch(() => acknowledge(call.id, rejection))
    .catch(() => undefined)
    .finally(() => pending.delete(call.id));
}

/** Cancels one in-flight call; accepts any `{id}`-shaped channel payload. */
export function cancelBridgeCall(pending: Map<string, AbortController>, value: unknown): void {
  if (!isRecord(value)) return;
  const id = Object.hasOwn(value, 'id') ? value.id : undefined;
  if (typeof id === 'string') pending.get(id)?.abort();
}

export function abortBridgeCalls(pending: Map<string, AbortController>): void {
  for (const controller of pending.values()) controller.abort();
  pending.clear();
}
