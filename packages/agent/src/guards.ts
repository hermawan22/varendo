import { WIRE_LIMITS } from '@varendo/core';

/** A bounded plain object: not null, not an array, not a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Identifier text: 1..limit characters with no whitespace or control characters. */
export function boundedId(value: unknown, limit: number = WIRE_LIMITS.id): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Tool-facing identifier: ASCII word characters only, 1-64 characters. */
export function strictId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

/** Wire text: 1..maximum characters with no control characters. */
export function boundedText(value: unknown, maximum: number = WIRE_LIMITS.text): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Non-empty bounded string: length bound only, no character-class check. */
export function boundedString(value: unknown, maximum: number = WIRE_LIMITS.text): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

/** Tool input schemas may only reference local `#/...` definitions. */
export function localSchemaReferences(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(localSchemaReferences);
  return Object.entries(value).every(
    ([key, child]) =>
      (key !== '$ref' || (typeof child === 'string' && child.startsWith('#'))) && localSchemaReferences(child),
  );
}
