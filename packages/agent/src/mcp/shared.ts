import { parseWireValue, WIRE_LIMITS, type Diagnostic, type Outcome } from '@varendo/core';
import type { CallToolResult } from './types.js';
import { AELIQO_MCP_TOOL_META } from './types.js';
import { AELIQO_AGENT_VERSION } from '../version.js';
import { boundedId, boundedText, isRecord } from '../guards.js';

export { boundedId as validId, boundedText as validText, isRecord };

export const ADAPTER_VERSION = '1' as const;
const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_DEFINITION_COUNT = 256;
export const DEFAULT_SERVER_NAME = 'aeliqo-agent';
export const DEFAULT_SERVER_VERSION = AELIQO_AGENT_VERSION;

export function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  const diagnostic: Diagnostic = {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path: [...path] }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

export function safeJson(value: unknown): string | undefined {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_TEXT_BYTES) return undefined;
    return encoded;
  } catch {
    return undefined;
  }
}

export function boundedWire(value: unknown): Outcome<unknown> {
  const checked = parseWireValue(value);
  if (!checked.ok) return checked;
  return safeJson(checked.value) === undefined
    ? failure('agent.mcp.bytes', 'The MCP payload exceeds its byte budget.')
    : checked;
}

function boundedResultText(value: unknown): Outcome<string> {
  if (typeof value !== 'string') return failure('agent.mcp.result', 'The MCP result text was malformed.');
  if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES)
    return failure('agent.mcp.bytes', 'The MCP result text exceeds its byte budget.');
  return { ok: true, value };
}

function envelope<T>(outcome: Outcome<T>) {
  return { version: ADAPTER_VERSION, outcome };
}

export function outcomeToCallToolResult<T>(outcome: Outcome<T>): CallToolResult {
  const body = envelope(outcome);
  const encoded = safeJson(body);
  const bounded =
    encoded === undefined ? envelope(failure<T>('agent.mcp.bytes', 'The MCP result exceeds its byte budget.')) : body;
  const text = encoded ?? JSON.stringify(bounded);
  return {
    isError: !bounded.outcome.ok,
    content: [{ type: 'text', text }],
    structuredContent: bounded,
  };
}

export function requestIdFromContext(context: {
  readonly mcpReq: { readonly id: string | number; readonly _meta?: Record<string, unknown> };
}): string {
  const supplied = context.mcpReq._meta?.[AELIQO_MCP_TOOL_META];
  if (isRecord(supplied) && boundedId(supplied.requestId)) return supplied.requestId;
  return String(context.mcpReq.id);
}

export function textFromResult(result: CallToolResult): Outcome<unknown> {
  if (!isRecord(result)) return failure('agent.mcp.result', 'The MCP server returned an invalid result.');
  if (result.structuredContent !== undefined) return boundedWire(result.structuredContent);
  if (!Array.isArray(result.content) || result.content.length > WIRE_LIMITS.array)
    return failure('agent.mcp.result', 'The MCP server returned malformed content.');
  if (safeJson(result.content) === undefined)
    return failure('agent.mcp.bytes', 'The MCP result content exceeds its byte budget.');
  const block = result.content.find((candidate) => isRecord(candidate) && candidate.type === 'text');
  if (!isRecord(block) || typeof block.text !== 'string')
    return failure('agent.mcp.result', 'The MCP server returned no bounded JSON result.');
  const bounded = boundedResultText(block.text);
  if (!bounded.ok) return bounded;
  try {
    return boundedWire(JSON.parse(bounded.value) as unknown);
  } catch {
    return failure('agent.mcp.result', 'The MCP server returned invalid JSON result text.');
  }
}
