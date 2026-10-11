import { parseWireValue, WIRE_LIMITS } from '@varendo/core';
import type { AgentJsonValue } from '../capabilities/types.js';
import {
  createToolModelConnection,
  type OpaqueModelSecret,
  type ToolModelAuth,
  type ToolModelAuthScheme,
  type ToolModelConnectionBudget,
  type ToolModelConnectionPolicy,
  type ToolModelCostPolicy,
  type ToolModelFetch,
  type ToolModelProviderObservation,
  type ToolModelRetryPolicy,
} from './connection.js';
import type { ToolModelCapability, ToolModelProtocolAdapter, ToolModelResponseContext } from './protocol.js';
import type { ToolModelCall, ToolModelPort, ToolModelRequest, ToolModelResponse, ToolModelUsage } from './types.js';
import { createToolModelContinuation, readToolModelContinuation } from './continuation.js';
import { isRecord } from '../guards.js';

export const OPENAI_COMPATIBLE_CHAT_PROTOCOL = 'openai-compatible-chat' as const;

const MAX_RESPONSE_CHOICES = 8;
const MAX_TOOL_CALLS = 8;
const MAX_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = WIRE_LIMITS.text;

function boundedText(value: unknown, maximum: number = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function validInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('The protocol value is not JSON serializable.');
  return encoded;
}

function inputMessage(message: ToolModelRequest['messages'][number]): Record<string, unknown> {
  if (message.role === 'system' || message.role === 'user') return { role: message.role, content: message.text };
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: json(message.output) };
  const continuation =
    message.continuation === undefined
      ? undefined
      : readToolModelContinuation(message.continuation, OPENAI_COMPATIBLE_CHAT_PROTOCOL);
  const reasoningContent = continuationText(continuation);
  return {
    role: 'assistant',
    ...(message.text === undefined ? { content: null } : { content: message.text }),
    ...(reasoningContent === undefined ? {} : { reasoning_content: reasoningContent }),
    ...(message.calls.length === 0
      ? {}
      : {
          tool_calls: message.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: json(call.input) },
          })),
        }),
  };
}

function continuationText(continuation: unknown): string | undefined {
  if (continuation === undefined) return undefined;
  if (!isRecord(continuation) || !boundedText(continuation.reasoningContent))
    return malformed('reasoning continuation');
  return continuation.reasoningContent;
}

function functionTool(tool: ToolModelRequest['tools'][number]): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function encodeRequest(input: { readonly request: ToolModelRequest; readonly model: string }): unknown {
  return {
    model: input.model,
    messages: input.request.messages.map(inputMessage),
    tools: input.request.tools.map(functionTool),
    tool_choice: input.request.toolChoice ?? 'auto',
    parallel_tool_calls: false,
    max_tokens: input.request.maxOutputTokens,
    stream: false,
  };
}

function estimateRequestBytes(request: ToolModelRequest): number {
  return new TextEncoder().encode(json(encodeRequest({ request, model: 'model' }))).byteLength;
}

function estimateInputTokens(request: ToolModelRequest): number {
  return Math.max(1, Math.min(1_000_000, Math.ceil(estimateRequestBytes(request) / 4)));
}

function malformed(message: string): never {
  // The connection normalizes arbitrary adapter failures. This error message
  // is intentionally generic so provider payloads cannot become diagnostics.
  throw new Error(message);
}

function tokenEstimate(value: unknown, maximum: number): number {
  try {
    return Math.max(1, Math.min(maximum, Math.ceil(new TextEncoder().encode(json(value)).byteLength / 4)));
  } catch {
    return 1;
  }
}

interface TokenCount {
  readonly value: number;
  readonly source: 'provider' | 'estimated';
}

function usageCount(
  usage: Record<string, unknown> | undefined,
  key: string,
  maximum: number,
  fallback: number,
): TokenCount {
  const value = usage?.[key];
  if (validInteger(value, maximum)) return { value, source: 'provider' };
  return { value: fallback, source: 'estimated' };
}

function nestedUsageCount(
  usage: Record<string, unknown> | undefined,
  parentKey: string,
  childKey: string,
  maximum: number,
): number | undefined {
  const parent = usage?.[parentKey];
  if (!isRecord(parent)) return undefined;
  const value = parent[childKey];
  return validInteger(value, maximum) ? value : undefined;
}

function providerUsage(
  raw: unknown,
  context: ToolModelResponseContext,
  text: string | undefined,
  calls: readonly ToolModelCall[],
): ToolModelUsage {
  const provider = isRecord(raw) ? raw : undefined;
  const input = usageCount(provider, 'prompt_tokens', 1_000_000, context.estimatedInputTokens);
  const output = usageCount(
    provider,
    'completion_tokens',
    100_000,
    tokenEstimate({ text: text ?? null, calls }, 100_000),
  );
  const cachedInputTokens = nestedUsageCount(provider, 'prompt_tokens_details', 'cached_tokens', input.value);
  const reasoningOutputTokens = nestedUsageCount(
    provider,
    'completion_tokens_details',
    'reasoning_tokens',
    output.value,
  );
  const total = usageCount(provider, 'total_tokens', 1_100_000, input.value + output.value);
  return Object.freeze({
    inputTokens: input.value,
    outputTokens: output.value,
    totalTokens: total.value,
    inputTokenSource: input.source,
    outputTokenSource: output.source,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
  });
}

function responseMessage(input: unknown): {
  readonly envelope: Record<string, unknown>;
  readonly message: Record<string, unknown>;
} {
  if (
    !isRecord(input) ||
    !Array.isArray(input.choices) ||
    input.choices.length === 0 ||
    input.choices.length > MAX_RESPONSE_CHOICES
  )
    return malformed('choices');
  const choice = input.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return malformed('message');
  return { envelope: input, message: choice.message };
}

function contentText(message: Record<string, unknown>): string | undefined {
  const content = message.content;
  if (content === null || content === undefined || content === '') return undefined;
  if (boundedText(content)) return content;
  return malformed('content');
}

function parseToolCall(item: unknown): ToolModelCall {
  if (
    !isRecord(item) ||
    item.type !== 'function' ||
    !boundedText(item.id, MAX_ID_LENGTH) ||
    !isRecord(item.function) ||
    !boundedText(item.function.name, MAX_ID_LENGTH) ||
    typeof item.function.arguments !== 'string' ||
    new TextEncoder().encode(item.function.arguments).byteLength > WIRE_LIMITS.bytes
  )
    return malformed('tool call');
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.function.arguments);
  } catch {
    return malformed('tool arguments');
  }
  const checked = parseWireValue(parsed);
  if (!checked.ok) return malformed('tool arguments');
  return { id: item.id, name: item.function.name, input: checked.value as AgentJsonValue };
}

function responseCalls(message: Record<string, unknown>): readonly ToolModelCall[] {
  const raw = message.tool_calls;
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw) || raw.length > MAX_TOOL_CALLS) return malformed('tool calls');
  return Object.freeze(raw.map(parseToolCall));
}

function reasoningText(message: Record<string, unknown>): string | undefined {
  const reasoning = message.reasoning_content;
  if (reasoning === null || reasoning === undefined || reasoning === '') return undefined;
  if (boundedText(reasoning)) return reasoning;
  return malformed('reasoning content');
}

function decodeResponse(input: unknown, context: ToolModelResponseContext): ToolModelResponse {
  const { envelope, message } = responseMessage(input);
  const text = contentText(message);
  const calls = responseCalls(message);
  const usage = providerUsage(envelope.usage, context, text, calls);
  const providerModel = boundedText(envelope.model, MAX_ID_LENGTH) ? envelope.model : undefined;
  const responseId = boundedText(envelope.id, MAX_ID_LENGTH) ? envelope.id : undefined;
  const reasoning = reasoningText(message);
  const continuation =
    reasoning === undefined
      ? undefined
      : createToolModelContinuation(OPENAI_COMPATIBLE_CHAT_PROTOCOL, { reasoningContent: reasoning });
  const provider: ToolModelResponse['provider'] = {
    protocol: OPENAI_COMPATIBLE_CHAT_PROTOCOL,
    ...(providerModel === undefined ? {} : { model: providerModel }),
    ...(responseId === undefined ? {} : { responseId }),
    usage,
  };
  return Object.freeze({
    ...(text === undefined ? {} : { text }),
    calls: Object.freeze(calls),
    usage,
    ...(continuation === undefined ? {} : { continuation }),
    provider: Object.freeze(provider),
  });
}

export const openAICompatibleChatAdapter: ToolModelProtocolAdapter = Object.freeze({
  id: OPENAI_COMPATIBLE_CHAT_PROTOCOL,
  endpointPath: '/chat/completions',
  capabilities: Object.freeze([
    'tool-calls',
    'usage',
    'input-token-estimate',
    'request-cancellation',
    'request-retry',
  ] as const),
  encodeRequest,
  estimateInputTokens,
  decodeResponse,
});

export interface OpenAICompatibleToolModelOptions {
  readonly baseURL: string;
  readonly model: string;
  /** Required for bearer/header auth; omitted only for explicit `auth: { scheme: 'none' }`. */
  readonly secret?: OpaqueModelSecret;
  readonly auth?:
    | {
        readonly scheme?: Exclude<ToolModelAuthScheme, 'none'>;
        readonly headerName?: string;
      }
    | { readonly scheme: 'none' };
  /** Required endpoint features, declared by the application configuration. */
  readonly capabilities: readonly ToolModelCapability[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly policy: ToolModelConnectionPolicy;
  readonly budget?: ToolModelConnectionBudget;
  readonly timeoutMs?: number;
  readonly retry?: ToolModelRetryPolicy;
  readonly cost?: ToolModelCostPolicy;
  readonly fetch?: ToolModelFetch;
  readonly onResponse?: (observation: ToolModelProviderObservation) => void;
}

function modelAuth(options: OpenAICompatibleToolModelOptions): ToolModelAuth {
  const scheme = options.auth?.scheme ?? 'bearer';
  if (scheme === 'none') {
    if (options.secret !== undefined) throw new Error('No-auth model connections cannot include a credential.');
    return { scheme: 'none' };
  }
  if (options.secret === undefined)
    throw new Error('Bearer/header model connections require an explicit server-owned credential.');
  if (scheme === 'header') {
    const headerName =
      options.auth !== undefined && options.auth.scheme !== 'none' ? options.auth.headerName : undefined;
    return { scheme: 'header', secret: options.secret, headerName: headerName ?? '' };
  }
  return { scheme: 'bearer', secret: options.secret };
}

function connectionExtras(options: OpenAICompatibleToolModelOptions): object {
  return {
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.cost === undefined ? {} : { cost: options.cost }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.onResponse === undefined ? {} : { onResponse: options.onResponse }),
  };
}

/**
 * Generic OpenAI-compatible chat-completions connection. It intentionally does
 * not identify or branch on a vendor; compatible gateways use the same adapter.
 */
export function createOpenAICompatibleToolModel(options: OpenAICompatibleToolModelOptions): ToolModelPort {
  return createToolModelConnection({
    adapter: openAICompatibleChatAdapter,
    baseURL: options.baseURL,
    model: options.model,
    auth: modelAuth(options),
    capabilities: options.capabilities,
    policy: options.policy,
    ...connectionExtras(options),
  });
}
