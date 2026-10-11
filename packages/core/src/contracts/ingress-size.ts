import { WIRE_LIMITS as L } from './limits.js';

const JSON_SAFE_ASCII = /^[\x20-\x21\x23-\x5b\x5d-\x7f]*$/u;
const SHORT_JSON_ESCAPES = new Set([0x22, 0x5c, 0x08, 0x09, 0x0a, 0x0c, 0x0d]);

function utf8CodePointBytes(value: number): number {
  if (value <= 0x7f) return 1;
  if (value <= 0x7ff) return 2;
  if (value <= 0xffff) return 3;
  return 4;
}

/** UTF-8 size without a browser/Node encoder or ambient effect. */
export function utf8Bytes(text: string): number {
  if (!/[^\x00-\x7f]/.test(text)) return Math.min(text.length, L.bytes + 1);
  let bytes = 0;
  for (const point of text) {
    bytes += utf8CodePointBytes(point.codePointAt(0)!);
    if (bytes > L.bytes) return bytes;
  }
  return bytes;
}

type StringCharacterSize = { readonly bytes: number; readonly lastIndex: number };

function jsonCharacterSize(text: string, index: number): StringCharacterSize {
  const code = text.charCodeAt(index);
  if (SHORT_JSON_ESCAPES.has(code)) return { bytes: 2, lastIndex: index };
  if (code < 0x20) return { bytes: 6, lastIndex: index };
  if (code >= 0xd800 && code <= 0xdbff) return jsonSurrogatePairSize(text, index);
  if (code >= 0xdc00 && code <= 0xdfff) return { bytes: 6, lastIndex: index };
  return { bytes: utf8CodePointBytes(code), lastIndex: index };
}

function jsonSurrogatePairSize(text: string, index: number): StringCharacterSize {
  const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
  if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, lastIndex: index + 1 };
  return { bytes: 6, lastIndex: index };
}

/** Byte length of JSON.stringify(text), without allocating the escaped string. */
function jsonStringBytes(text: string): number {
  if (JSON_SAFE_ASCII.test(text)) return text.length + 2;
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const character = jsonCharacterSize(text, index);
    bytes += character.bytes;
    index = character.lastIndex;
    if (bytes > L.bytes) return bytes;
  }
  return bytes;
}

export function jsonPrimitiveBytes(value: null | boolean | number | string): number {
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return utf8Bytes(String(value));
  return jsonStringBytes(value);
}

export function cachedJSONBytes(text: string, cache: Map<string, number>): number {
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const bytes = jsonStringBytes(text);
  if (cache.size < 1024) cache.set(text, bytes);
  return bytes;
}
