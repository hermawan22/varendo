import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelAdapter } from './model-adapter.mjs';
import { readModelConfiguration } from './model-config.mjs';

const env = {
  AELIQO_MODEL_BASE_URL: 'https://model.example/v1/',
  AELIQO_MODEL: 'tools-model',
  AELIQO_MODEL_PROTOCOL: 'openai-compatible-chat',
  AELIQO_MODEL_AUTH_SCHEME: 'bearer',
  AELIQO_MODEL_API_KEY: 'server-only-secret',
  AELIQO_MODEL_CAPABILITIES: 'tool-calls,usage',
};

test('the generic chat profile sends the credential only to its configured provider endpoint', async () => {
  const calls = [];
  const model = createModelAdapter(readModelConfiguration(env), {
    fetch: async (url, init) => {
      calls.push({ url: String(url), authorization: init.headers.authorization, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({
          id: 'response-1',
          model: 'tools-model',
          choices: [{ message: { content: 'Ready', tool_calls: [] } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const response = await model.complete(
    {
      messages: [{ role: 'user', text: 'Hello' }],
      tools: [],
      maxOutputTokens: 10,
    },
    { signal: new AbortController().signal },
  );
  assert.equal(response.text, 'Ready');
  assert.equal(response.provider.model, 'tools-model');
  assert.deepEqual(calls, [
    {
      url: 'https://model.example/v1/chat/completions',
      authorization: 'Bearer server-only-secret',
      body: {
        model: 'tools-model',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        max_tokens: 10,
        stream: false,
      },
    },
  ]);
});

test('the explicit Responses profile uses one bounded completion request without a counting round trip', async () => {
  const calls = [];
  const model = createModelAdapter(
    readModelConfiguration({
      ...env,
      AELIQO_MODEL_PROTOCOL: 'openai-compatible-responses',
      AELIQO_MODEL_CAPABILITIES: 'tool-calls,usage,input-token-estimate',
    }),
    {
      fetch: async (url, init) => {
        calls.push({ url: String(url), authorization: init.headers.authorization });
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [],
            output_text: 'Ready',
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    },
  );
  const request = { messages: [{ role: 'user', text: 'Hello' }], tools: [], maxOutputTokens: 10 };
  assert.ok(model.estimateInputTokens(request) > 0);
  const response = await model.complete(request, { signal: new AbortController().signal });
  assert.equal(response.text, 'Ready');
  assert.deepEqual(calls, [
    {
      url: 'https://model.example/v1/responses',
      authorization: 'Bearer server-only-secret',
    },
  ]);
});
