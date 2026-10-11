import type { Outcome } from '../../contracts/types.js';
import { failure, isPlainDataRecord, safePositiveCount, type PlanRecord } from './shared.js';

interface ValidatedExecutionContext {
  readonly startedAt?: number;
}

const CONTEXT_LIMITS = ['maxRows', 'maxBytes', 'maxOperations'] as const;

function validateContextLimits(context: PlanRecord): Outcome<void> {
  for (const key of CONTEXT_LIMITS) {
    const value = context[key];
    if (value !== undefined && !safePositiveCount(value))
      return failure('query.budget', `Execution context ${key} must be a bounded positive safe integer.`, [key]);
  }
  const maxMilliseconds = context.maxMilliseconds;
  if (maxMilliseconds === undefined) return { ok: true, value: undefined };
  if (
    typeof maxMilliseconds === 'number' &&
    Number.isFinite(maxMilliseconds) &&
    maxMilliseconds > 0 &&
    maxMilliseconds <= Number.MAX_SAFE_INTEGER
  )
    return { ok: true, value: undefined };
  return failure('query.budget', 'Execution context maxMilliseconds must be a bounded positive finite number.', [
    'maxMilliseconds',
  ]);
}

function validateCancellation(context: PlanRecord): Outcome<void> {
  const cancellation = context.cancellation;
  if (cancellation === undefined) return { ok: true, value: undefined };
  if (isPlainDataRecord(cancellation) && typeof cancellation.aborted === 'boolean')
    return { ok: true, value: undefined };
  return failure('query.context', 'Execution context cancellation must expose a boolean aborted flag.', [
    'cancellation',
  ]);
}

function startClock(context: PlanRecord): Outcome<ValidatedExecutionContext> {
  if (context.clock === undefined) {
    if (context.maxMilliseconds === undefined) return { ok: true, value: {} };
    return failure('query.clock', 'A time budget requires an injected monotonic clock.', ['clock']);
  }
  if (typeof context.clock !== 'function')
    return failure('query.clock', 'Execution context clock must be a function.', ['clock']);
  let startedAt: number;
  try {
    startedAt = context.clock() as number;
  } catch {
    return failure('query.clock', 'Execution context clock failed safely at the untrusted boundary.', ['clock']);
  }
  if (!Number.isFinite(startedAt))
    return failure('query.clock', 'Execution context clock must return a finite number.', ['clock']);
  return { ok: true, value: { startedAt } };
}

export function validateExecutionContext(context: unknown): Outcome<ValidatedExecutionContext> {
  if (!isPlainDataRecord(context))
    return failure('query.context', 'Query execution context must be a plain data object.');
  const limits = validateContextLimits(context);
  if (!limits.ok) return limits;
  const cancellation = validateCancellation(context);
  if (!cancellation.ok) return cancellation;
  return startClock(context);
}
