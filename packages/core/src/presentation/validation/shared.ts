import * as z from 'zod/mini';
import { inspectWire } from '../../contracts/ingress.js';
import { canonicalRefs } from '../../contracts/schema-primitives.js';
import type { Outcome, VersionRef } from '../../contracts/types.js';
export { resultRefKey as refKey } from '../../contracts/stable.js';
import { freezePresentation, isThenable, presentationFailure as fail } from '../registry.js';

/** Admit only synchronous, wire-safe callback outcomes with an explicit success value. */
export function callbackOutcome(raw: unknown, failureCode: string, failureMessage: string): Outcome<unknown> {
  if (isThenable(raw)) return fail(failureCode, failureMessage);
  const wire = inspectWire(raw);
  if (!wire.ok) return wire;
  const outcome = wire.value as { ok?: unknown; value?: unknown };
  if (outcome === null || typeof outcome !== 'object' || outcome.ok !== true || !Object.hasOwn(outcome, 'value'))
    return fail(failureCode, failureMessage);
  return { ok: true, value: outcome.value };
}

export function parseRendererCapabilities(input: readonly VersionRef[]): Outcome<readonly VersionRef[]> {
  const wire = inspectWire(input);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(canonicalRefs, wire.value);
  if (!parsed.success) return fail('renderer', 'Renderer capability references are malformed or exceed their limit.');
  return { ok: true, value: freezePresentation(parsed.data) };
}
