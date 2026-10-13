import { parseContract } from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type { AgentToolDefinition, AgentToolInputSchema } from '../protocol/types.js';
import type { StandardSchemaWithJSON, Tool } from './types.js';
import { VARENDO_MCP_TOOL_META } from './types.js';
import { localSchemaReferences, strictId } from '../guards.js';
import { ADAPTER_VERSION, boundedWire, failure, isRecord, safeJson, validId, validText } from './shared.js';
import type { Outcome, VersionRef } from '@varendo/core';

interface ToolMetadata {
  readonly version: typeof ADAPTER_VERSION;
  readonly capability: VersionRef;
  readonly operation: OperationGrant;
}

function cloneSchema(schema: AgentToolInputSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function inputSchema(value: unknown): Outcome<AgentToolInputSchema> {
  const schema = boundedWire(value);
  if (!schema.ok || !isRecord(schema.value) || schema.value.type !== 'object' || !localSchemaReferences(schema.value))
    return failure('agent.mcp.tool', 'The MCP server returned a malformed input schema.');
  const encoded = safeJson(schema.value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 65_536)
    return failure('agent.mcp.tool', 'The MCP server returned a malformed input schema.');
  return { ok: true, value: Object.freeze(schema.value as AgentToolInputSchema) };
}

function normalizeMetadata(value: unknown): Outcome<ToolMetadata> {
  if (
    !isRecord(value) ||
    value.version !== ADAPTER_VERSION ||
    !isRecord(value.capability) ||
    !validId(value.capability.id) ||
    !validId(value.capability.revision)
  )
    return failure('agent.mcp.tool-metadata', 'The MCP tool does not carry a valid Varendo capability binding.');
  const operation = parseContract('operation-grant', JSON.stringify(value.operation));
  if (!operation.ok) return failure('agent.mcp.tool-metadata', 'The MCP tool carries an unknown capability operation.');
  return {
    ok: true,
    value: Object.freeze({
      version: ADAPTER_VERSION,
      capability: Object.freeze({ id: value.capability.id, revision: value.capability.revision }),
      operation: operation.value,
    }),
  };
}

function toolName(tool: Tool): Outcome<string> {
  if (!isRecord(tool) || !strictId(tool.name))
    return failure('agent.mcp.tool', 'The MCP server returned a malformed tool name.');
  return { ok: true, value: tool.name };
}

function toolDescription(tool: Tool, name: string): Outcome<string> {
  const description = tool.description === undefined ? name : tool.description;
  if (!validText(description))
    return failure('agent.mcp.tool', 'The MCP server returned a malformed tool description.');
  return { ok: true, value: description };
}

/** MCP exposes host-authored schemas and leaves admission to the paired endpoint. */
export function standardSchema(schema: AgentToolInputSchema): StandardSchemaWithJSON {
  const jsonSchema = cloneSchema(schema);
  return {
    '~standard': {
      version: 1,
      vendor: 'varendo',
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  } as unknown as StandardSchemaWithJSON;
}

export function toolMetadata(definition: AgentToolDefinition): Record<string, unknown> {
  return {
    [VARENDO_MCP_TOOL_META]: {
      version: ADAPTER_VERSION,
      capability: { id: definition.capability.id, revision: definition.capability.revision },
      operation: definition.operation,
    },
  };
}

export function normalizeTool(tool: Tool): Outcome<AgentToolDefinition> {
  const name = toolName(tool);
  if (!name.ok) return name;
  const schema = inputSchema(tool.inputSchema);
  if (!schema.ok) return schema;
  const metadata = normalizeMetadata(isRecord(tool._meta) ? tool._meta[VARENDO_MCP_TOOL_META] : undefined);
  if (!metadata.ok) return metadata;
  const description = toolDescription(tool, name.value);
  if (!description.ok) return description;
  return {
    ok: true,
    value: Object.freeze({
      name: name.value,
      description: description.value,
      capability: metadata.value.capability,
      operation: metadata.value.operation,
      inputSchema: schema.value,
    }),
  };
}
