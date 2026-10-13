import {
  Client,
  StreamableHTTPClientTransport,
  type CacheableRequestOptions,
  type CallToolRequestOptions,
  type ClientOptions,
  type FetchLike,
  type StreamableHTTPClientTransportOptions,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Outcome } from '@varendo/core';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentToolCallOptions, AgentToolDefinition, AgentToolEndpoint } from '../protocol/types.js';
import type {
  McpClientCommonOptions,
  McpClientEndpointOptions,
  McpHttpClientOptions,
  McpStdioClientOptions,
} from './types.js';
import { VARENDO_MCP_PROTOCOL_REVISION, VARENDO_MCP_TOOL_META } from './types.js';
import {
  ADAPTER_VERSION,
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_VERSION,
  MAX_DEFINITION_COUNT,
  boundedWire,
  failure,
  isRecord,
  validId,
} from './shared.js';
import { normalizeTool } from './definitions.js';
import { resultToOutcome } from './receipts.js';
import { boundMcpAuthProvider } from './oauth-policy.js';

interface McpClientState {
  readonly options: McpClientEndpointOptions;
  closed: boolean;
  discoveredTools: Map<string, AgentToolDefinition>;
}

interface CallContext {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly options: AgentToolCallOptions;
  readonly definition: AgentToolDefinition;
}

function closedFailure<T>(): Outcome<T> {
  return failure('agent.mcp.closed', 'The MCP client endpoint is closed.');
}

function cancelledFailure<T>(message: string): Outcome<T> {
  return failure('agent.mcp.cancelled', message);
}

function discoveryInputError(state: McpClientState, signal: AbortSignal | undefined): Outcome<never> | undefined {
  if (state.closed) return closedFailure();
  if (signal?.aborted) return cancelledFailure('MCP capability discovery was cancelled.');
  return undefined;
}

async function listTools(state: McpClientState, signal: AbortSignal | undefined) {
  const options: CacheableRequestOptions = { cacheMode: 'bypass' };
  if (signal !== undefined) options.signal = signal;
  return state.options.client.listTools({}, options);
}

function normalizedDefinitions(tools: readonly import('./types.js').Tool[]): Outcome<AgentToolDefinition[]> {
  if (tools.length > MAX_DEFINITION_COUNT)
    return failure('agent.mcp.discovery', 'MCP capability discovery exceeded its tool budget.');
  const definitions: AgentToolDefinition[] = [];
  const names = new Set<string>();
  for (const tool of tools) {
    const normalized = normalizeTool(tool);
    if (!normalized.ok) return normalized;
    if (names.has(normalized.value.name))
      return failure('agent.mcp.tool', 'The MCP server returned duplicate tool names.');
    names.add(normalized.value.name);
    definitions.push(normalized.value);
  }
  return { ok: true, value: definitions };
}

function discoveryFailure(state: McpClientState, signal: AbortSignal | undefined): Outcome<never> {
  if (state.closed) return closedFailure();
  if (signal?.aborted) return cancelledFailure('MCP capability discovery was cancelled.');
  return failure('agent.mcp.discovery', 'MCP capability discovery failed.');
}

async function discover(
  state: McpClientState,
  signal: AbortSignal | undefined,
): Promise<Outcome<readonly AgentToolDefinition[]>> {
  const invalid = discoveryInputError(state, signal);
  if (invalid !== undefined) return invalid;
  state.discoveredTools = new Map();
  try {
    const result = await listTools(state, signal);
    const late = discoveryInputError(state, signal);
    if (late !== undefined) return late;
    const normalized = normalizedDefinitions(result.tools);
    if (!normalized.ok) return normalized;
    state.discoveredTools = new Map(normalized.value.map((definition) => [definition.name, definition]));
    return { ok: true, value: Object.freeze(normalized.value) };
  } catch {
    state.discoveredTools = new Map();
    return discoveryFailure(state, signal);
  }
}

function validateCall(
  state: McpClientState,
  name: string,
  input: unknown,
  options: AgentToolCallOptions,
): Outcome<CallContext> {
  if (state.closed) return closedFailure();
  if (!validId(name) || !isRecord(options) || !validId(options.requestId))
    return failure('agent.mcp.call', 'MCP tool identity is invalid.');
  if (options.signal?.aborted) return cancelledFailure('MCP tool invocation was cancelled.');
  const definition = state.discoveredTools.get(name);
  if (definition === undefined)
    return failure('agent.mcp.discovery', 'MCP tool invocation requires a current discovered tool.');
  if (!isRecord(input)) return failure('agent.mcp.input', 'MCP tool arguments must be an object.');
  if (!boundedWire(input).ok) return failure('agent.mcp.bytes', 'MCP tool arguments exceed the wire budget.');
  return { ok: true, value: { name, input, options, definition } };
}

function callRequestOptions(signal: AbortSignal | undefined): CallToolRequestOptions {
  const options: CallToolRequestOptions = {};
  if (signal !== undefined) {
    options.signal = signal;
    options.requestSignal = signal;
  }
  return options;
}

async function invokeCall(state: McpClientState, call: CallContext): Promise<Outcome<AgentCapabilityReceipt>> {
  const { options, definition, name, input } = call;
  const result = await state.options.client.callTool(
    {
      name,
      arguments: input,
      _meta: { [VARENDO_MCP_TOOL_META]: { version: ADAPTER_VERSION, requestId: options.requestId } },
    },
    callRequestOptions(options.signal),
  );
  if (state.closed) return closedFailure();
  if (options.signal?.aborted) return cancelledFailure('MCP tool invocation was cancelled.');
  return resultToOutcome(result, options, definition, state.options.targetRegionId, state.options.goalEpoch);
}

async function invoke(
  state: McpClientState,
  name: string,
  input: unknown,
  options: AgentToolCallOptions,
): Promise<Outcome<AgentCapabilityReceipt>> {
  const checked = validateCall(state, name, input, options);
  if (!checked.ok) return checked;
  try {
    return await invokeCall(state, checked.value);
  } catch {
    if (state.closed) return closedFailure<AgentCapabilityReceipt>();
    if (options.signal?.aborted) return cancelledFailure<AgentCapabilityReceipt>('MCP tool invocation was cancelled.');
    return failure<AgentCapabilityReceipt>('agent.mcp.call', 'MCP tool invocation failed.');
  }
}

function closeClient(state: McpClientState): void {
  if (state.closed) return;
  state.closed = true;
  state.discoveredTools = new Map();
  void state.options.client.close().catch(() => undefined);
}

/** Adapt a connected official MCP client into the shared endpoint port. */
export function createMcpClientEndpoint(options: McpClientEndpointOptions): AgentToolEndpoint {
  if (options === null || typeof options !== 'object' || !(options.client instanceof Client))
    throw new TypeError('A connected MCP client is required.');
  if (!validId(options.targetRegionId) || !validId(options.goalEpoch))
    throw new TypeError('MCP target binding is invalid.');
  const state: McpClientState = { options: Object.freeze({ ...options }), closed: false, discoveredTools: new Map() };
  return Object.freeze({
    transport: 'mcp',
    targetRegionId: state.options.targetRegionId,
    goalEpoch: state.options.goalEpoch,
    discover: (discoverOptions: { readonly signal?: AbortSignal } = {}) => discover(state, discoverOptions.signal),
    invoke: (name: string, input: unknown, callOptions: AgentToolCallOptions) =>
      invoke(state, name, input, callOptions),
    close: () => closeClient(state),
  });
}

function clientOptions(
  options: McpClientCommonOptions & { readonly clientOptions?: Omit<ClientOptions, 'versionNegotiation'> },
): ClientOptions {
  return {
    ...(options.clientOptions ?? {}),
    versionNegotiation: { mode: { pin: VARENDO_MCP_PROTOCOL_REVISION } },
  };
}

async function connectedEndpoint(
  client: Client,
  transport: Transport,
  options: Pick<McpClientCommonOptions, 'targetRegionId' | 'goalEpoch' | 'connectOptions'>,
): Promise<AgentToolEndpoint> {
  try {
    await client.connect(transport, options.connectOptions);
  } catch (error) {
    await Promise.allSettled([client.close(), transport.close()]);
    throw error;
  }
  try {
    return createMcpClientEndpoint({
      client,
      targetRegionId: options.targetRegionId,
      goalEpoch: options.goalEpoch,
      transport,
    });
  } catch (error) {
    await Promise.allSettled([client.close(), transport.close()]);
    throw error;
  }
}

function createClient(
  options: McpClientCommonOptions & { readonly clientOptions?: Omit<ClientOptions, 'versionNegotiation'> },
): Client {
  return new Client(
    {
      name: options.name ?? DEFAULT_SERVER_NAME,
      version: options.version ?? DEFAULT_SERVER_VERSION,
    },
    clientOptions(options),
  );
}

export async function connectMcpStdioClient(options: McpStdioClientOptions): Promise<AgentToolEndpoint> {
  return connectedEndpoint(createClient(options), new StdioClientTransport(options.server), options);
}

function readHttpUrl(value: URL | string): URL {
  return value instanceof URL ? new URL(value.toString()) : new URL(value);
}

function validateHttpUrlIdentity(url: URL): void {
  if (url.username !== '' || url.password !== '' || url.hash !== '')
    throw new TypeError('The MCP HTTP endpoint must not contain credentials or a fragment.');
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

function loopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

function validateHttpProtocol(url: URL, policy: McpHttpClientOptions['policy']): void {
  const secure = url.protocol === 'https:';
  const allowedHttp =
    url.protocol === 'http:' && loopbackHostname(url.hostname) && policy?.allowInsecureLoopback === true;
  if (!secure && !allowedHttp)
    throw new TypeError('The MCP HTTP endpoint requires HTTPS; insecure HTTP needs an explicit loopback-only policy.');
}

function validOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

function validateOriginAllowlist(url: URL, policy: McpHttpClientOptions['policy']): void {
  const origins = policy?.allowedOrigins;
  if (origins === undefined) return;
  if (origins.length === 0 || !origins.includes(url.origin))
    throw new TypeError('The MCP HTTP endpoint origin is not allowlisted.');
  for (const origin of origins) {
    if (!validOrigin(origin)) throw new TypeError('The MCP HTTP origin allowlist is invalid.');
  }
}

function mcpHttpUrl(options: McpHttpClientOptions): URL {
  const url = readHttpUrl(options.url);
  validateHttpUrlIdentity(url);
  validateHttpProtocol(url, options.policy);
  validateOriginAllowlist(url, options.policy);
  return url;
}

export async function connectMcpHttpClient(options: McpHttpClientOptions): Promise<AgentToolEndpoint> {
  const url = mcpHttpUrl(options);
  const authProvider = await boundMcpAuthProvider(options);
  const request = options.fetch ?? globalThis.fetch;
  if (typeof request !== 'function') throw new TypeError('The MCP HTTP client requires a fetch implementation.');
  const guardedFetch: FetchLike = (input, init) => request(input, { ...init, redirect: 'error' });
  const transportOptions: StreamableHTTPClientTransportOptions = {
    ...(options.transportOptions ?? {}),
    ...(authProvider === undefined ? {} : { authProvider }),
    ...(options.requestInit === undefined ? {} : { requestInit: options.requestInit }),
    fetch: guardedFetch,
  };
  const transport = new StreamableHTTPClientTransport(url, transportOptions);
  return connectedEndpoint(createClient(options), transport, options);
}
