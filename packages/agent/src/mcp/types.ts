import type {
  AuthInfo,
  CreateMcpHandlerOptions,
  McpHttpHandler,
  McpRequestContext,
  StandardSchemaWithJSON,
  Tool,
} from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type {
  CallToolResult,
  ClientOptions,
  FetchLike,
  RequestOptions,
  StreamableHTTPClientTransportOptions,
  Transport,
} from '@modelcontextprotocol/client';
import type { StdioServerParameters } from '@modelcontextprotocol/client/stdio';
import type { AgentToolEndpoint } from '../protocol/types.js';

/** MCP revision used by Varendo's supported client and server adapters. */
export const AELIQO_MCP_PROTOCOL_REVISION = '2026-07-28' as const;
/** Metadata key used to carry host-authored binding data with an MCP tool. */
export const AELIQO_MCP_TOOL_META = 'com.aeliqo/agent-tool' as const;

export interface McpEndpointFactoryContext {
  readonly authInfo?: AuthInfo;
  readonly requestInfo?: Request;
}

export type McpEndpointFactory = (context: McpEndpointFactoryContext) => AgentToolEndpoint | Promise<AgentToolEndpoint>;

export interface McpServerFactoryOptions {
  readonly createEndpoint: McpEndpointFactory;
  readonly name?: string;
  readonly version?: string;
  readonly serverOptions?: ConstructorParameters<typeof import('@modelcontextprotocol/server').McpServer>[1];
}

export interface McpStdioServerOptions extends McpServerFactoryOptions {
  readonly maxBufferSize?: number;
  readonly onerror?: (error: Error) => void;
}

export interface McpHttpAuthContext {
  readonly request: Request;
  readonly authInfo: AuthInfo;
}

export type McpHttpAuthGate = (request: Request) => Promise<AuthInfo | Response> | AuthInfo | Response;

export interface McpHttpServerOptions extends McpServerFactoryOptions {
  readonly authenticate: McpHttpAuthGate;
  readonly allowedHostnames?: readonly string[];
  readonly allowedOriginHostnames?: readonly string[];
  readonly resourceServerUrl?: URL;
  readonly issuer?: string;
  readonly now?: () => number;
  readonly responseMode?: CreateMcpHandlerOptions['responseMode'];
  readonly onerror?: (error: Error) => void;
}

export interface McpClientEndpointOptions {
  readonly client: import('@modelcontextprotocol/client').Client;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly transport?: Transport;
}

export interface McpClientCommonOptions {
  readonly name?: string;
  readonly version?: string;
  readonly targetRegionId: string;
  readonly goalEpoch: string;
  readonly connectOptions?: RequestOptions;
}

export interface McpStdioClientOptions extends McpClientCommonOptions {
  readonly server: StdioServerParameters;
  readonly clientOptions?: Omit<ClientOptions, 'versionNegotiation'>;
}

export interface McpHttpClientPolicy {
  readonly allowInsecureLoopback?: boolean;
  readonly allowedOrigins?: readonly string[];
  /** Required for OAuth providers; persisted credentials must carry this issuer stamp. */
  readonly expectedIssuer?: string;
}

export interface McpHttpClientOptions extends McpClientCommonOptions {
  readonly url: URL | string;
  readonly policy?: McpHttpClientPolicy;
  readonly authProvider?: StreamableHTTPClientTransportOptions['authProvider'];
  readonly requestInit?: RequestInit;
  readonly fetch?: FetchLike;
  readonly transportOptions?: Omit<StreamableHTTPClientTransportOptions, 'authProvider' | 'requestInit' | 'fetch'>;
  readonly clientOptions?: Omit<ClientOptions, 'versionNegotiation'>;
}

export type {
  AuthInfo,
  CallToolResult,
  McpHttpHandler,
  McpRequestContext,
  StandardSchemaWithJSON,
  StdioServerHandle,
  StdioServerParameters,
  Tool,
  Transport,
};
