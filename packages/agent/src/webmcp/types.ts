import type { Outcome } from '@varendo/core';
import type { AgentToolDefinition, AgentToolEndpoint, AgentToolInputSchema } from '../protocol/types.js';

/** The execution context supplied by the native WebMCP host. */
export interface WebMcpExecutionOptions {
  readonly signal?: AbortSignal;
}

/** Native WebMCP safety hints derived from the canonical operation grant. */
export interface WebMcpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
  readonly consequentialHint: boolean;
}

/** The subset of Chrome's imperative modelContext API used by this adapter. */
export interface WebMcpModelContext {
  readonly registerTool: (tool: WebMcpTool, options?: { readonly signal?: AbortSignal }) => void | Promise<void>;
  readonly getTools?: () => Promise<readonly unknown[]>;
}

/** A tool shape accepted by the imperative WebMCP registration API. */
export interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: AgentToolInputSchema;
  readonly annotations: WebMcpToolAnnotations;
  readonly execute: (input: unknown, options?: WebMcpExecutionOptions) => unknown | Promise<unknown>;
}

/** Whether the host came from the browser or was explicitly supplied by a test/app. */
export type WebMcpEvidence = 'native' | 'simulated' | 'unavailable';

export interface WebMcpDetection {
  readonly evidence: WebMcpEvidence;
  readonly supported: boolean;
  readonly modelContext?: WebMcpModelContext;
  readonly reason?: string;
}

export interface WebMcpDetectionOptions {
  /** Explicit host document. The agent package never reads an ambient DOM global. */
  readonly document?: unknown;
  /** Set by the host integration after it supplies the corresponding context. */
  readonly evidence?: 'native' | 'simulated';
}

export interface WebMcpAdapterOptions {
  /** The host-owned endpoint; its transport must be `webmcp`. */
  readonly endpoint: AgentToolEndpoint;
  /** Explicit modelContext injection comes from a browser or app-owned host. */
  readonly modelContext?: WebMcpModelContext;
  /** Explicit host document injection; the adapter never reads a global document. */
  readonly document?: unknown;
  /** Evidence supplied by the host integration. Context injection defaults to simulated. */
  readonly evidence?: 'native' | 'simulated';
}

export interface WebMcpRegisterOptions {
  readonly signal?: AbortSignal;
}

export interface WebMcpRegistration {
  readonly name: string;
  readonly capability: AgentToolDefinition['capability'];
  readonly operation: AgentToolDefinition['operation'];
  readonly evidence: WebMcpEvidence;
}

export interface WebMcpAdapter {
  readonly evidence: WebMcpEvidence;
  readonly supported: boolean;
  readonly discover: (options?: { readonly signal?: AbortSignal }) => Promise<Outcome<readonly AgentToolDefinition[]>>;
  readonly register: (options?: WebMcpRegisterOptions) => Promise<Outcome<readonly WebMcpRegistration[]>>;
  readonly close: () => void;
}
