import { wireFailure } from '../diagnostics/wire.js';
import { WIRE_LIMITS as L } from './limits.js';
import type { Outcome } from './types.js';
import { utf8Bytes } from './ingress-size.js';

type TextObjectKeys = Set<string> | null;

function textKeyEnd(text: string, start: number): number {
  for (let position = start + 1; position < text.length; position++) {
    if (text[position] === '\\') {
      position++;
      continue;
    }
    if (text[position] === '"') return position;
  }
  return text.length - 1;
}

function skipTextWhitespace(text: string, start: number): number {
  let position = start;
  while (position < text.length && /[\t\n\r ]/.test(text[position]!)) position++;
  return position;
}

function inspectTextKey(text: string, start: number, end: number, containers: TextObjectKeys[]): Outcome<number> {
  const colon = skipTextWhitespace(text, end + 1);
  if (text[colon] !== ':') return { ok: true, value: end };
  const keys = containers.at(-1);
  if (keys === undefined || keys === null) return { ok: true, value: end };
  const key = JSON.parse(text.slice(start, end + 1)) as string;
  if (keys.has(key)) return wireFailure('wire.duplicate-key', 'Duplicate object keys are not accepted.');
  keys.add(key);
  if (keys.size > L.properties) return wireFailure('wire.properties', 'A wire object exceeds its property limit.');
  return { ok: true, value: end };
}

function inspectTextCharacter(text: string, position: number, containers: TextObjectKeys[]): Outcome<number> {
  const character = text[position];
  if (character === '{' || character === '[') {
    containers.push(character === '{' ? new Set() : null);
    if (containers.length > L.depth + 1) return wireFailure('wire.depth', 'The wire document exceeds its depth limit.');
    return { ok: true, value: position };
  }
  if (character === '}' || character === ']') {
    containers.pop();
    return { ok: true, value: position };
  }
  if (character !== '"') return { ok: true, value: position };
  const end = textKeyEnd(text, position);
  return inspectTextKey(text, position, end, containers);
}

/** Native JSON.parse checks syntax; this scan rejects duplicate decoded object keys. */
function inspectTextKeys(text: string): Outcome<undefined> {
  const containers: TextObjectKeys[] = [];
  for (let position = 0; position < text.length; position++) {
    const result = inspectTextCharacter(text, position, containers);
    if (!result.ok) return result;
    position = result.value;
  }
  return { ok: true, value: undefined };
}

export function parseWireInput(input: unknown): Outcome<unknown> {
  if (typeof input !== 'string') return { ok: true, value: input };
  if (input.length > L.bytes || utf8Bytes(input) > L.bytes)
    return wireFailure('wire.bytes', 'The wire document exceeds its byte limit.');

  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    return wireFailure('wire.json', 'The wire document is not valid JSON.');
  }
  const uniqueKeys = inspectTextKeys(input);
  if (!uniqueKeys.ok) return uniqueKeys;
  return { ok: true, value };
}
