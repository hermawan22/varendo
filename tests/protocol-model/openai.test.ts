import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { createOpenAIToolModel } from '../../packages/agent/src/model/openai.js';
import type { ToolModelRequest } from '../../packages/agent/src/model/types.js';

const request: ToolModelRequest = {
  messages: [
    { role: 'user', text: 'Summarize' },
    { role: 'assistant', calls: [{ id: 'call_previous', name: 'summary', input: { entity: 'orders' } }] },
    { role: 'tool', callId: 'call_previous', output: { count: 2 } },
  ],
  tools: [
    {
      name: 'summary',
      description: 'Read summary',
      capability: { id: 'summary', revision: '1' },
      operation: 'catalog.read',
      inputSchema: { type: 'object' },
    },
  ],
  toolChoice: 'required',
  maxOutputTokens: 100,
};

async function localProvider(
  test: (port: ReturnType<typeof createOpenAIToolModel>, bodies: Record<string, unknown>[]) => Promise<void>,
  malformed = false,
) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    bodies.push(JSON.parse(body) as Record<string, unknown>);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.endsWith('/input_tokens')
          ? { object: 'response.input_tokens', input_tokens: 42 }
          : {
              id: 'resp_fixture',
              object: 'response',
              created_at: 1,
              status: 'completed',
              model: 'fixture-model',
              output: [
                {
                  type: 'function_call',
                  call_id: 'call_next',
                  name: 'summary',
                  arguments: malformed ? '{' : '{"entity":"orders"}',
                  status: 'completed',
                },
              ],
              usage: {
                input_tokens: 42,
                output_tokens: 8,
                total_tokens: 50,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
      ),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = new OpenAI({
      apiKey: 'synthetic-local-test-key',
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    });
    await test(createOpenAIToolModel({ client, environment: 'trusted-server', model: 'fixture-model' }), bodies);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('official OpenAI SDK against a local protocol fixture, not live provider evidence', () => {
  it('projects correlated function calls through the official count and Responses HTTP APIs', async () => {
    await localProvider(async (port, bodies) => {
      const signal = new AbortController().signal;
      if (port.countInputTokens === undefined)
        throw new Error('The official reference port must expose provider token counting.');
      expect(await port.countInputTokens(request, { signal })).toBe(42);
      expect(await port.complete(request, { signal })).toMatchObject({
        calls: [{ id: 'call_next', name: 'summary', input: { entity: 'orders' } }],
        usage: { inputTokens: 42, outputTokens: 8 },
      });
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toMatchObject({
        store: false,
        stream: false,
        tool_choice: 'required',
        parallel_tool_calls: false,
        max_output_tokens: 100,
        model: 'fixture-model',
        input: [
          { role: 'user', content: 'Summarize' },
          { type: 'function_call', call_id: 'call_previous', name: 'summary' },
          { type: 'function_call_output', call_id: 'call_previous', output: '{"count":2}' },
        ],
      });
      expect(bodies[0]?.input).toEqual(bodies[1]?.input);
      expect(bodies[0]?.tools).toEqual(bodies[1]?.tools);
      expect(JSON.stringify(bodies)).not.toContain('synthetic-local-test-key');
    });
  });
  it('rejects malformed provider arguments before tool execution', async () => {
    await localProvider(async (port) => {
      await expect(port.complete(request, { signal: new AbortController().signal })).rejects.toThrow(
        'malformed tool arguments',
      );
    }, true);
  });
});
