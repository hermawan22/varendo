import { validateScalar } from '../../contracts/scalars.js';
import type { Outcome } from '../../contracts/types.js';
import { DEFAULT_LIMITS } from '../planner.js';
import type { QueryField, QueryRow, QueryValue } from '../types.js';
import { failure, type EvalState } from './shared.js';

function validateOperationBudget(state: EvalState): Outcome<void> {
  const limit = state.context.maxOperations ?? DEFAULT_LIMITS.maxOperations;
  if (state.operations > limit) return failure('query.budget', 'Query evaluation exceeded its operation budget.');
  if (state.context.cancellation?.aborted) return failure('query.cancelled', 'Query evaluation was cancelled.');
  return { ok: true, value: undefined };
}

function validateTimeBudget(state: EvalState, now: number): Outcome<void> {
  if (state.startedAt === undefined || state.context.maxMilliseconds === undefined)
    return { ok: true, value: undefined };
  if (now - state.startedAt <= state.context.maxMilliseconds) return { ok: true, value: undefined };
  return failure('query.budget', 'Query evaluation exceeded its time budget.');
}

function readClock(state: EvalState): Outcome<void> {
  const clock = state.context.clock;
  if (clock === undefined || state.lastClock === undefined) return { ok: true, value: undefined };
  let now: number;
  try {
    now = clock();
  } catch {
    return failure('query.clock', 'Execution context clock failed during evaluation.');
  }
  if (!Number.isFinite(now) || now < state.lastClock)
    return failure('query.clock', 'Execution context clock must be finite and monotonic.');
  state.lastClock = now;
  return validateTimeBudget(state, now);
}

export function tick(state: EvalState, amount = 1): Outcome<void> {
  state.operations += amount;
  const budget = validateOperationBudget(state);
  if (!budget.ok) return budget;
  return readClock(state);
}

export function outputBytes(rows: readonly QueryRow[]): number {
  const encoded = JSON.stringify(rows);
  if (encoded === undefined) return Number.MAX_SAFE_INTEGER;
  return new TextEncoder().encode(encoded).byteLength;
}

export function appendRow(state: EvalState, rows: QueryRow[], row: QueryRow): Outcome<void> {
  if (rows.length >= state.context.maxRows!)
    return failure('query.budget', 'Intermediate rows exceed the effective row budget.');
  const bytes = (state.materializedBytes.get(rows) ?? 0) + outputBytes([row]);
  if (bytes > state.context.maxBytes!)
    return failure('query.budget', 'Intermediate rows exceed the effective byte budget.');
  state.materializedBytes.set(rows, bytes);
  rows.push(row);
  return { ok: true, value: undefined };
}

export function outputValue(value: QueryValue | undefined, field: QueryField | undefined): Outcome<QueryValue> {
  if (field === undefined) return failure('query.output-schema', 'Computed value has no declared output field.');
  const checked = validateScalar(value ?? null, field.type);
  if (checked.ok) return checked;
  return failure('query.output-value', 'Computed value is incompatible with its declared output type.');
}
