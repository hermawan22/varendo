import { parseWireValue, WIRE_LIMITS } from '@varendo/core';
import type { AgentJsonValue } from '../capabilities/types.js';
import type { ToolModelContinuation } from './types.js';

const states = new WeakMap<object, { readonly protocol: string; readonly value: AgentJsonValue }>();

export function createToolModelContinuation(protocol: string, value: unknown): ToolModelContinuation {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(protocol)) throw new Error('The model continuation protocol is invalid.');
  const checked = parseWireValue(value);
  if (!checked.ok) throw new Error('The model continuation is not a bounded wire value.');
  const bytes = new TextEncoder().encode(JSON.stringify(checked.value)).byteLength;
  if (bytes > WIRE_LIMITS.bytes) throw new Error('The model continuation exceeds its byte limit.');
  const handle = Object.freeze({ kind: 'opaque-model-continuation', bytes }) as ToolModelContinuation;
  states.set(handle, { protocol, value: checked.value as AgentJsonValue });
  return handle;
}

export function isToolModelContinuation(value: unknown): value is ToolModelContinuation {
  return value !== null && typeof value === 'object' && states.has(value);
}

export function readToolModelContinuation(continuation: ToolModelContinuation, protocol: string): AgentJsonValue {
  const state = states.get(continuation);
  if (state === undefined || state.protocol !== protocol)
    throw new Error('The model continuation does not belong to this protocol.');
  return state.value;
}
