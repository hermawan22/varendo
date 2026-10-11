import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { parseWireValue, type Outcome } from '@varendo/core';
import { createAgentCapabilityRegistry } from '../../../packages/agent/src/capabilities/registry.js';
import type { AgentCapabilityManifest, AgentJsonValue } from '../../../packages/agent/src/capabilities/types.js';
import { createAgentToolEndpoint } from '../../../packages/agent/src/protocol/endpoint.js';
import { createToolModelConnection, openAICompatibleChatAdapter } from '../../../packages/agent/src/model/index.js';
import { runToolModel } from '../../../packages/agent/src/model/loop.js';
import type {
  ToolModelBudget,
  ToolModelCall,
  ToolModelLoopOutcome,
  ToolModelPort,
} from '../../../packages/agent/src/model/types.js';

export interface ModelProtocolFixtureOptions {
  readonly auth: 'none';
  readonly endpoint: 'local-allowlisted';
}

export interface ModelProtocolFixture {
  readonly runToolTurn: () => Promise<ToolModelLoopOutcome>;
  readonly receivedHeaders: Record<string, string | undefined>;
  readonly receivedToolCalls: readonly ToolModelCall[];
  readonly receivedToolResults: readonly { readonly callId: string; readonly output: unknown }[];
  readonly dispose: () => Promise<void>;
}

const SUMMARY_REF = Object.freeze({ id: 'fixture.summary', revision: '1' });
const SUMMARY_CALL: ToolModelCall = Object.freeze({
  id: 'call_fixture_summary',
  name: 'summary',
  input: Object.freeze({ subject: 'authorized-fixture' }),
});
const budget: ToolModelBudget = Object.freeze({
  maxTurns: 3,
  maxModelRequests: 6,
  maxToolCalls: 3,
  maxMilliseconds: 5_000,
  maxInputTokens: 2_000,
  maxOutputTokens: 256,
  maxTotalTokens: 4_000,
  maxInputBytes: 100_000,
  maxOutputBytes: 10_000,
  maxRepeatedCalls: 1,
});

function headerSnapshot(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(',') : value]),
  );
}

function summaryManifest(): AgentCapabilityManifest<AgentJsonValue, AgentJsonValue> {
  return {
    ref: SUMMARY_REF,
    operation: 'catalog.read',
    label: 'Summary',
    description: 'Read the bounded fixture summary.',
    parse: (input) => parseWireValue(input) as Outcome<AgentJsonValue>,
    invoke: () => ({ state: 'data-ready', value: { count: 1, source: 'fixture' } }),
  };
}

function modelPort(baseURL: string, origin: string, auth: ModelProtocolFixtureOptions['auth']): ToolModelPort {
  return createToolModelConnection({
    adapter: openAICompatibleChatAdapter,
    baseURL,
    model: 'fixture-model',
    auth: { scheme: auth },
    policy: {
      allowExternalEgress: true,
      allowInsecureHttp: true,
      allowedOrigins: [origin],
    },
    capabilities: ['tool-calls', 'input-token-estimate', 'request-cancellation'],
  });
}

function loopOptions(
  endpoint: ReturnType<typeof createAgentToolEndpoint> extends Outcome<infer T> ? T : never,
  model: ToolModelPort,
) {
  return {
    requestId: 'model-fixture-run',
    goal: 'chat' as const,
    prompt: 'Read the authorized summary.',
    endpoint,
    model,
    budget,
  };
}

export async function createModelProtocolFixture(options: ModelProtocolFixtureOptions): Promise<ModelProtocolFixture> {
  if (options.auth !== 'none' || options.endpoint !== 'local-allowlisted')
    throw new TypeError('The model fixture only supports its explicit local no-auth profile.');

  const receivedHeaders: Record<string, string | undefined> = {};
  const receivedToolCalls: ToolModelCall[] = [];
  const receivedToolResults: Array<{ readonly callId: string; readonly output: unknown }> = [];
  let requestCount = 0;
  const server: Server = createServer(async (incoming, outgoing) => {
    let raw = '';
    for await (const chunk of incoming) raw += String(chunk);
    const body = JSON.parse(raw) as Record<string, unknown>;
    Object.assign(receivedHeaders, headerSnapshot(incoming.headers));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of messages) {
      if (message !== null && typeof message === 'object' && (message as { role?: unknown }).role === 'tool') {
        const tool = message as { tool_call_id?: unknown; content?: unknown };
        if (typeof tool.tool_call_id === 'string')
          receivedToolResults.push({ callId: tool.tool_call_id, output: tool.content });
      }
    }
    const hasToolResult = messages.some(
      (message) => message !== null && typeof message === 'object' && (message as { role?: unknown }).role === 'tool',
    );
    const response = hasToolResult
      ? {
          id: 'fixture-response-final',
          model: 'fixture-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Unverified fixture draft.' } }],
        }
      : {
          id: 'fixture-response-tool',
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: SUMMARY_CALL.id,
                    type: 'function',
                    function: { name: SUMMARY_CALL.name, arguments: JSON.stringify(SUMMARY_CALL.input) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
    if (!hasToolResult && requestCount++ === 0) receivedToolCalls.push(SUMMARY_CALL);
    outgoing.statusCode = 200;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const endpointResult = createAgentToolEndpoint({
    transport: 'byok',
    targetRegionId: 'model-fixture-region',
    goalEpoch: 'model-fixture-goal',
    principalKey: 'model-fixture-principal',
    expiresAt: Date.now() + 60_000,
    registry: (() => {
      const registry = createAgentCapabilityRegistry([summaryManifest()]);
      if (!registry.ok) throw new TypeError('The model fixture registry could not be created.');
      return registry.value;
    })(),
    tools: [
      {
        name: 'summary',
        capability: SUMMARY_REF,
        operation: 'catalog.read',
        inputSchema: { type: 'object' },
      },
    ],
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: 'model-fixture-principal',
          regionId: 'model-fixture-region',
          goalEpoch: 'model-fixture-goal',
          grants: ['catalog.read', 'model.egress'],
        },
      }),
    },
  });
  if (!endpointResult.ok) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new TypeError('The model fixture endpoint could not be created.');
  }
  const model = modelPort(`${origin}/v1`, origin, options.auth);
  const endpoint = endpointResult.value;
  return {
    runToolTurn: () => runToolModel(loopOptions(endpoint, model)),
    receivedHeaders,
    receivedToolCalls,
    receivedToolResults,
    dispose: async () => {
      endpoint.close();
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
