import { parseIntent, type Intent, type Outcome } from '@varendo/core';
import type { AgentModelToolEndpoint } from '@varendo/agent/protocol';
import type { WebMcpAdapter, WebMcpEvidence } from '@varendo/agent/webmcp';
import type { AeliqoApp, WebRenderReceipt } from '@varendo/web/app';
import { playgroundContext } from './context.js';
import { failure } from './guards.js';

export type BrowserToolState = 'invoking' | 'ready' | 'applied' | 'failed';
type PlaygroundRender = (target: HTMLElement, intent: Intent, signal?: AbortSignal) => Promise<WebRenderReceipt>;
type WebMcpConnection = { readonly registrations: number; readonly evidence: WebMcpEvidence };

interface AgentConnectionOptions {
  readonly app: AeliqoApp;
  readonly regionId: string;
  readonly getTarget: () => HTMLElement | undefined;
  readonly render: PlaygroundRender;
  readonly onAgentRender?: (intent: Intent, receipt: WebRenderReceipt) => void | Promise<void>;
  readonly state: { enabled: boolean };
}

function observedEndpoint(endpoint: AgentModelToolEndpoint, onState?: (state: BrowserToolState) => void) {
  return Object.freeze({
    ...endpoint,
    async invoke(...args: Parameters<AgentModelToolEndpoint['invoke']>) {
      onState?.('invoking');
      const receipt = await endpoint.invoke(...args);
      if (!receipt.ok) onState?.('failed');
      else onState?.(receipt.value.state === 'renderer-ready' ? 'applied' : 'ready');
      return receipt;
    },
  });
}

/** A tab owns one registration. Reset, disconnect and disposal fence pending setup and calls. */
export function createPlaygroundAgentConnections(options: AgentConnectionOptions) {
  let generation = 0;
  let adapter: WebMcpAdapter | undefined;
  const disconnect = () => {
    generation++;
    adapter?.close();
    adapter = undefined;
    options.state.enabled = false;
  };
  const connectWebMcp = async (onState?: (state: BrowserToolState) => void): Promise<Outcome<WebMcpConnection>> => {
    disconnect();
    const operation = generation;
    if (options.getTarget() === undefined)
      return failure('playground.webmcp-region', 'Render a scenario before connecting WebMCP.');
    const [{ createAppToolEndpoint }, { registerWebMcpTools }] = await Promise.all([
      import('@varendo/agent/app'),
      import('@varendo/agent/webmcp'),
    ]);
    if (operation !== generation) return failure('playground.cancelled', 'Connection setup was cancelled.');
    options.state.enabled = true;
    const endpoint = createAppToolEndpoint({
      runtime: options.app.runtime,
      regionId: options.regionId,
      context: playgroundContext(options.app, options.regionId),
      render: {
        async render(input): Promise<WebRenderReceipt> {
          const parsed = parseIntent(input.intent);
          const target = options.getTarget();
          if (!parsed.ok)
            return {
              status: 'failed',
              requestId: 'webmcp-render',
              regionId: options.regionId,
              diagnostics: parsed.diagnostics,
            };
          if (target === undefined || operation !== generation)
            return {
              status: 'cancelled',
              requestId: 'webmcp-render',
              regionId: options.regionId,
              diagnostics: [{ code: 'playground.cancelled', message: 'This tool session ended.', retryable: false }],
            };
          const receipt = await options.render(target, parsed.value, input.signal);
          if (operation === generation) await options.onAgentRender?.(parsed.value, receipt);
          return receipt;
        },
      },
      goalEpoch: crypto.randomUUID(),
      transport: 'webmcp',
      expiresAt: Date.now() + 15 * 60_000,
      maxPending: 2,
      maxMilliseconds: 15_000,
      maxInputBytes: 32_000,
      maxOutputBytes: 64_000,
    });
    if (!endpoint.ok) {
      options.state.enabled = false;
      return endpoint;
    }
    const registered = await registerWebMcpTools({
      endpoint: observedEndpoint(endpoint.value, onState),
      document,
      evidence: 'native',
    });
    if (!registered.ok) {
      endpoint.value.close();
      if (operation === generation) options.state.enabled = false;
      return registered;
    }
    if (operation !== generation) {
      registered.value.adapter.close();
      return failure('playground.cancelled', 'Connection setup was cancelled.');
    }
    adapter = registered.value.adapter;
    return { ok: true, value: { registrations: registered.value.registrations.length, evidence: adapter.evidence } };
  };
  return { connectWebMcp, disconnectWebMcp: disconnect, dispose: disconnect };
}
