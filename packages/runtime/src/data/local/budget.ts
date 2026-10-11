import { WIRE_LIMITS } from '@varendo/core';
import type { QueryBudget } from '../types.js';

export const DEFAULT_BUDGET: QueryBudget = Object.freeze({
  maxRows: 10_000,
  maxBytes: WIRE_LIMITS.bytes,
  maxMessages: 64,
  maxMilliseconds: 30_000,
  maxColumns: 128,
});

export function minBudget(requested: QueryBudget, host: QueryBudget, grant?: Partial<QueryBudget>): QueryBudget {
  return Object.freeze({
    maxRows: budgetLimit('maxRows', requested, host, grant),
    maxBytes: budgetLimit('maxBytes', requested, host, grant),
    maxMessages: budgetLimit('maxMessages', requested, host, grant),
    maxMilliseconds: budgetLimit('maxMilliseconds', requested, host, grant),
    maxColumns: budgetLimit('maxColumns', requested, host, grant),
  });
}

function budgetLimit(key: keyof QueryBudget, requested: QueryBudget, host: QueryBudget, grant?: Partial<QueryBudget>) {
  return Math.min(requested[key], host[key], grant?.[key] ?? Number.MAX_SAFE_INTEGER);
}
