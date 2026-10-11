import { parsePresentationPlan } from '@varendo/core';
import { parseInteractionState } from '@varendo/core/interaction';
import type { Outcome } from '@varendo/core';
import { frozen, normalizeHostOutcome } from '../regions/region-contracts.js';
import type { RegionSnapshot } from '../regions/types.js';
import type { RuntimePreparedRender, RuntimePresentationProjection } from './types.js';
import { failure } from './runtime-state.js';

function invalid(): Outcome<never> {
  return failure(
    'runtime.projection-invalid',
    'The host projection must supply synchronous apply and rollback callbacks.',
  );
}

function consumePromise(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (typeof (value as PromiseLike<unknown>).then !== 'function') return false;
  void Promise.resolve(value).catch(() => {});
  return true;
}

/** Capture host callbacks once and make cleanup safe to call from every failure branch. */
export function projectionTransaction(value: unknown): Outcome<RuntimePresentationProjection> {
  try {
    if (value === null || typeof value !== 'object') return invalid();
    const candidate = value as RuntimePresentationProjection;
    const apply = candidate.apply;
    const rollback = candidate.rollback;
    if (typeof apply !== 'function' || typeof rollback !== 'function') return invalid();
    let rolledBack = false;
    return {
      ok: true,
      value: {
        apply: (next) => applyProjection(() => apply.call(candidate, next)),
        rollback() {
          if (rolledBack) return;
          rolledBack = true;
          try {
            consumePromise(rollback.call(candidate));
          } catch {
            // Cleanup is best effort; it cannot authorize or publish a candidate.
          }
        },
      },
    };
  } catch {
    return invalid();
  }
}

function applyProjection(apply: () => unknown): Outcome<void> {
  try {
    const raw = apply();
    if (consumePromise(raw)) return invalid();
    const result = normalizeHostOutcome<unknown>(raw, 'runtime.projection-invalid');
    if (!result.ok) return result;
    return result.value === undefined ? { ok: true, value: undefined } : invalid();
  } catch {
    return failure('runtime.projection-failed', 'The host projection failed before publication.');
  }
}

export function preparedRender(raw: unknown): Outcome<void | RuntimePreparedRender> {
  const result = normalizeHostOutcome<unknown>(raw, 'runtime.projection-invalid');
  if (!result.ok || result.value === undefined) return result as Outcome<void>;
  const transaction = projectionTransaction(result.value);
  if (!transaction.ok) return transaction;
  const parsed = parsePrepared(result.value, transaction.value);
  if (!parsed.ok) transaction.value.rollback();
  return parsed;
}

function parsePrepared(value: unknown, transaction: RuntimePresentationProjection): Outcome<RuntimePreparedRender> {
  try {
    const candidate = value as RuntimePreparedRender;
    if (Object.keys(candidate).some((key) => !['presentation', 'interaction', 'apply', 'rollback'].includes(key)))
      return invalid();
    const presentation = parsePresentationPlan(candidate.presentation);
    if (!presentation.ok) return presentation;
    const interaction = candidate.interaction === undefined ? undefined : parseInteractionState(candidate.interaction);
    if (interaction !== undefined && !interaction.ok) return interaction;
    return {
      ok: true,
      value: {
        ...transaction,
        presentation: frozen(presentation.value),
        ...(interaction === undefined ? {} : { interaction: frozen(interaction.value) }),
      },
    };
  } catch {
    return invalid();
  }
}

export function applyPrepared(
  projection: RuntimePresentationProjection | undefined,
  next: RegionSnapshot,
): Outcome<void> {
  return projection === undefined ? { ok: true, value: undefined } : projection.apply(next);
}
