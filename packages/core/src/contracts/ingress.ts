import type { Outcome } from './types.js';
import { parseWireInput } from './ingress-text.js';
import { inspectWireValue } from './ingress-walk.js';

export { utf8Bytes } from './ingress-size.js';

export function inspectWire(input: unknown): Outcome<unknown> {
  const parsed = parseWireInput(input);
  if (!parsed.ok) return parsed;
  return inspectWireValue(parsed.value);
}
