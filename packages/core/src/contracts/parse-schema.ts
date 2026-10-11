import * as z from 'zod/mini';
import { inspectWire } from './ingress.js';
import { CONTRACT_VERSION, WIRE_LIMITS } from './limits.js';
import { wireDiagnostic, wireFailure } from '../diagnostics/wire.js';
import type { Diagnostic, Outcome } from './types.js';
export { stableJson as canonicalJSON } from './stable.js';

export function parseInspectedSchema<S extends z.ZodMiniType>(
  versioned: boolean,
  input: unknown,
  schema: S,
): Outcome<z.infer<S>> {
  if (
    versioned &&
    input !== null &&
    typeof input === 'object' &&
    Object.hasOwn(input, 'version') &&
    (input as { version: unknown }).version !== CONTRACT_VERSION
  )
    return wireFailure('wire.version', 'The contract version is not supported; explicit migration is required.', [
      'version',
    ]);
  const parsed = z.safeParse(schema, input);
  if (!parsed.success) {
    const diagnostics = parsed.error.issues.slice(0, WIRE_LIMITS.diagnostics).map((issue) =>
      wireDiagnostic(
        `wire.${issue.code}`,
        issue.path.filter((part): part is string | number => typeof part !== 'symbol'),
        issue.message,
      ),
    );
    return { ok: false, diagnostics: diagnostics as [Diagnostic, ...Diagnostic[]] };
  }
  return { ok: true, value: parsed.data };
}

export function parseSchema<S extends z.ZodMiniType>(
  versioned: boolean,
  input: unknown,
  schema: S,
): Outcome<z.infer<S>> {
  const inspected = inspectWire(input);
  if (!inspected.ok) return inspected;
  return parseInspectedSchema(versioned, inspected.value, schema);
}
