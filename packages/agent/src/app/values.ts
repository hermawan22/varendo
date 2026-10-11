import { parseContract, parseWireValue, type Outcome } from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type { AgentJsonValue } from '../capabilities/types.js';
import { boundedId, isRecord } from '../guards.js';

export const failure = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

export function record(value: unknown): value is Readonly<Record<string, AgentJsonValue>> {
  return isRecord(value);
}

export function bounded(value: unknown): value is string {
  return boundedId(value);
}

export function grants(values: readonly string[]): readonly OperationGrant[] {
  return values.flatMap((value) => {
    const parsed = parseContract('operation-grant', JSON.stringify(value));
    return parsed.ok ? [parsed.value] : [];
  });
}

function isAgentJson(value: unknown): value is AgentJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isAgentJson);
  return record(value) && Object.values(value).every(isAgentJson);
}

export function wire(value: AgentJsonValue): Outcome<AgentJsonValue> {
  const parsed = parseWireValue(value);
  if (!parsed.ok) return parsed;
  if (isAgentJson(parsed.value)) return { ok: true, value: parsed.value };
  return failure('agent.app.output', 'The application produced an invalid agent JSON value.');
}

export function toolSchema(value: unknown): Readonly<Record<string, AgentJsonValue>> {
  const parsed = parseWireValue(value);
  if (!parsed.ok || !record(parsed.value))
    throw new TypeError('A standard agent tool schema must be a bounded JSON object.');
  return parsed.value;
}
