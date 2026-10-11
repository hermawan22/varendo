import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  McpServer,
  type AuthInfo,
  type McpHandlerRequestOptions,
  type McpHttpHandler,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
  type ServeStdioOptions,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import { WIRE_LIMITS, type Outcome } from '@varendo/core';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentToolDefinition, AgentToolEndpoint } from '../protocol/types.js';
import type {
  McpEndpointFactoryContext,
  McpHttpServerOptions,
  McpServerFactoryOptions,
  McpStdioServerOptions,
} from './types.js';
import {
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_VERSION,
  MAX_DEFINITION_COUNT,
  failure,
  isRecord,
  validId,
  validText,
  outcomeToCallToolResult,
  requestIdFromContext,
} from './shared.js';
import { standardSchema, toolMetadata } from './definitions.js';

function serverIdentity(options: McpServerFactoryOptions): { readonly name: string; readonly version: string } {
  const name = options.name ?? DEFAULT_SERVER_NAME;
  const version = options.version ?? DEFAULT_SERVER_VERSION;
  if (!validId(name) || !validId(version)) throw new TypeError('MCP server identity is invalid.');
  return { name, version };
}

function endpointContext(context: McpRequestContext): McpEndpointFactoryContext {
  return {
    ...(context.authInfo === undefined ? {} : { authInfo: context.authInfo }),
    ...(context.requestInfo === undefined ? {} : { requestInfo: context.requestInfo }),
  };
}

async function discoverAndClose(endpoint: AgentToolEndpoint, context: McpRequestContext) {
  try {
    const signal = context.requestInfo?.signal;
    return signal === undefined ? await endpoint.discover() : await endpoint.discover({ signal });
  } finally {
    endpoint.close();
  }
}

function validateDefinitions(definitions: readonly AgentToolDefinition[]): void {
  if (definitions.length > MAX_DEFINITION_COUNT) throw new Error('MCP capability discovery exceeded its tool budget.');
  const names = new Set<string>();
  for (const definition of definitions) {
    if (!validId(definition.name) || names.has(definition.name) || !isRecord(definition.inputSchema))
      throw new Error('MCP capability discovery returned duplicate or malformed tools.');
    names.add(definition.name);
  }
}

async function callTool(
  options: McpServerFactoryOptions,
  context: McpRequestContext,
  definition: AgentToolDefinition,
  input: unknown,
  callContext: Parameters<Parameters<McpServer['registerTool']>[2]>[1],
) {
  const endpoint = await options.createEndpoint(endpointContext(context));
  try {
    if (endpoint.transport !== 'mcp')
      return outcomeToCallToolResult(
        failure<AgentCapabilityReceipt>('agent.mcp.endpoint', 'MCP endpoint transport changed unexpectedly.'),
      );
    const outcome = await endpoint.invoke(definition.name, input, {
      requestId: requestIdFromContext(callContext),
      signal: callContext.mcpReq.signal,
    });
    return outcomeToCallToolResult(outcome);
  } finally {
    endpoint.close();
  }
}

function registerDefinitions(
  server: McpServer,
  options: McpServerFactoryOptions,
  context: McpRequestContext,
  definitions: readonly AgentToolDefinition[],
): void {
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: standardSchema(definition.inputSchema),
        _meta: toolMetadata(definition),
      },
      (input: unknown, callContext) => callTool(options, context, definition, input, callContext),
    );
  }
}

function mergeServerOptions(options: McpServerFactoryOptions): ConstructorParameters<typeof McpServer>[1] {
  return {
    ...(options.serverOptions ?? {}),
    capabilities: {
      ...(options.serverOptions?.capabilities ?? {}),
      tools: {
        ...(options.serverOptions?.capabilities?.tools ?? {}),
        listChanged: true,
      },
    },
  };
}

function validateFactoryOptions(options: McpServerFactoryOptions): void {
  if (options === null || typeof options !== 'object' || typeof options.createEndpoint !== 'function')
    throw new TypeError('MCP endpoint factory is required.');
  serverIdentity(options);
}

/** Create the official SDK server factory used by stdio and HTTP. */
export function createMcpServerFactory(
  options: McpServerFactoryOptions,
): (context: McpRequestContext) => Promise<McpServer> {
  validateFactoryOptions(options);
  const identity = serverIdentity(options);
  return async (context: McpRequestContext): Promise<McpServer> => {
    const endpoint = await options.createEndpoint(endpointContext(context));
    if (endpoint.transport !== 'mcp') {
      try {
        endpoint.close();
      } catch {
        /* close is best effort on malformed host wiring */
      }
      throw new TypeError('MCP endpoint factory returned an endpoint with the wrong transport.');
    }
    const discovered = await discoverAndClose(endpoint, context);
    if (!discovered.ok) throw new Error('MCP capability discovery was denied or unavailable.');
    validateDefinitions(discovered.value);
    const server = new McpServer(identity, mergeServerOptions(options));
    registerDefinitions(server, options, context, discovered.value);
    return server;
  };
}

/** Start the official SDK stdio server. Protocol bytes are its stdout data. */
export function createMcpStdioServer(options: McpStdioServerOptions): StdioServerHandle {
  const factory = createMcpServerFactory(options);
  const stdioOptions: ServeStdioOptions = {
    ...(options.maxBufferSize === undefined
      ? {}
      : { transport: new StdioServerTransport(undefined, undefined, { maxBufferSize: options.maxBufferSize }) }),
    ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
  };
  // serveStdio owns the selected transport lifecycle.
  void options.maxBufferSize;
  return serveStdio(factory, stdioOptions);
}

function canonicalResource(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.href !== 'string') return undefined;
  try {
    const resource = new URL(value.href);
    resource.hash = '';
    return resource.href;
  } catch {
    return undefined;
  }
}

function authShape(authInfo: unknown): authInfo is AuthInfo {
  return (
    isRecord(authInfo) &&
    validText(authInfo.token, WIRE_LIMITS.text) &&
    validId(authInfo.clientId) &&
    Array.isArray(authInfo.scopes) &&
    authInfo.scopes.every((scope) => validId(scope)) &&
    (authInfo.extra === undefined || isRecord(authInfo.extra))
  );
}

function authClock(options: McpHttpServerOptions): Outcome<number> {
  const clock = options.now?.() ?? Date.now();
  if (typeof clock !== 'number' || !Number.isFinite(clock))
    return failure('agent.mcp.auth-clock', 'The MCP authentication clock is unavailable.');
  const nowSeconds = Math.floor(clock / 1000);
  if (!Number.isSafeInteger(nowSeconds))
    return failure('agent.mcp.auth-expired', 'The MCP authentication grant is expired.');
  return { ok: true, value: nowSeconds };
}

function validExpiry(authInfo: AuthInfo, nowSeconds: number): boolean {
  return (
    typeof authInfo.expiresAt === 'number' &&
    Number.isSafeInteger(authInfo.expiresAt) &&
    authInfo.expiresAt > nowSeconds
  );
}

function validateAuthInfo(authInfo: unknown, options: McpHttpServerOptions): Outcome<AuthInfo> {
  try {
    if (!authShape(authInfo))
      return failure('agent.mcp.auth', 'The authentication gate returned malformed token metadata.');
    const clock = authClock(options);
    if (!clock.ok) return clock;
    if (!validExpiry(authInfo, clock.value))
      return failure('agent.mcp.auth-expired', 'The MCP authentication grant is expired.');
    if (authInfo.resource !== undefined && canonicalResource(authInfo.resource) === undefined)
      return failure('agent.mcp.auth-audience', 'The MCP authentication resource is malformed.');
    if (options.resourceServerUrl !== undefined && !audienceMatches(authInfo, options))
      return failure('agent.mcp.auth-audience', 'The MCP authentication audience does not match this resource.');
    if (options.issuer !== undefined && authInfo.extra?.issuer !== options.issuer)
      return failure('agent.mcp.auth-issuer', 'The MCP authentication issuer is not trusted.');
    return { ok: true, value: authInfo };
  } catch {
    return failure('agent.mcp.auth', 'The authentication gate returned malformed token metadata.');
  }
}

function audienceMatches(authInfo: AuthInfo, options: McpHttpServerOptions): boolean {
  const expected = canonicalResource(options.resourceServerUrl);
  const actual = canonicalResource(authInfo.resource);
  return expected !== undefined && actual !== undefined && actual === expected;
}

function authFailureResponse(): Response {
  return new Response(JSON.stringify({ error: 'invalid_token' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  });
}

async function authenticatedRequest(
  options: McpHttpServerOptions,
  inner: McpHttpHandler,
  request: Request,
  requestOptions?: McpHandlerRequestOptions,
): Promise<Response> {
  if (options.allowedHostnames !== undefined) {
    const rejected = hostHeaderValidationResponse(request, [...options.allowedHostnames]);
    if (rejected !== undefined) return rejected;
  }
  if (options.allowedOriginHostnames !== undefined) {
    const rejected = originValidationResponse(request, [...options.allowedOriginHostnames]);
    if (rejected !== undefined) return rejected;
  }
  let auth: AuthInfo | Response;
  try {
    auth = await options.authenticate(request);
  } catch {
    return authFailureResponse();
  }
  if (auth instanceof Response) return auth;
  const checked = validateAuthInfo(auth, options);
  if (!checked.ok) return authFailureResponse();
  return inner.fetch(request, { ...(requestOptions ?? {}), authInfo: checked.value });
}

/** Add application authentication and SDK host/origin guards to the official handler. */
export function createMcpHttpHandler(options: McpHttpServerOptions): McpHttpHandler {
  if (options === null || typeof options !== 'object' || typeof options.authenticate !== 'function')
    throw new TypeError('An application-owned MCP authentication gate is required.');
  const factory = createMcpServerFactory(options);
  const inner = createMcpHandler(factory, {
    ...(options.responseMode === undefined ? {} : { responseMode: options.responseMode }),
    ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
  });
  return {
    fetch: (request, requestOptions) => authenticatedRequest(options, inner, request, requestOptions),
    close: inner.close,
    notify: inner.notify,
    bus: inner.bus,
  };
}

export type { StdioServerHandle };
