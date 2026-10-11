import { canonicalJSON, parseExpression } from '../contracts/parse.js';
import type { Outcome } from '../contracts/types.js';

/** Canonical expression bytes are suitable for a definition digest/read-set key. */
export function canonicalizeExpression(input: unknown): Outcome<string> {
  const parsed = parseExpression(input);
  return parsed.ok ? { ok: true, value: canonicalJSON(parsed.value) } : parsed;
}

/** Equality is byte equality after the canonical parser/serializer pass. */
export function expressionsEqual(left: unknown, right: unknown): boolean {
  const first = canonicalizeExpression(left);
  const second = canonicalizeExpression(right);
  return first.ok && second.ok && first.value === second.value;
}
