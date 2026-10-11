import type { Outcome, QuerySpec } from '@varendo/core';
import type { QuerySource } from '@varendo/core/query';
import type { DataRecord, QueryBudget, ReadContext, ReadGrant } from '../types.js';
import type { StoredSnapshot } from './source.js';
import type { StoredPlan } from './service-state.js';
import { awaitBoundedResult, resolveValueWithAbort } from './authorization.js';
import { failure } from './shared.js';

const ROW_AUTHORIZATION_ERROR = 'The host row policy could not authorize the requested row.';
const ROW_TIME_BUDGET_ERROR = 'Execution exceeded the effective time budget while authorizing rows.';

export async function authorizedSource(
  plan: StoredPlan,
  snapshot: StoredSnapshot,
  grant: ReadGrant,
  query: QuerySpec,
  context: ReadContext,
  startedAt: number,
  budget: QueryBudget,
  workNow: () => number,
  current: () => boolean,
): Promise<Outcome<QuerySource>> {
  const relations = createRelations();
  for (const entityId of plan.scanEntities) {
    const rows = await authorizeEntityRows(
      snapshot.records[entityId] ?? [],
      entityId,
      grant,
      query,
      context,
      startedAt,
      budget,
      workNow,
      current,
    );
    if (!rows.ok) return rows;
    relations[entityId] = Object.freeze({ entity: entityId, rows: rows.value, complete: true });
  }
  return {
    ok: true,
    value: Object.freeze({
      revision: snapshot.sourceRevision,
      catalogRevision: snapshot.catalog.revision,
      scopeDigest: grant.scopeDigest,
      ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
      relations: Object.freeze(relations),
    }),
  };
}

function createRelations(): Record<
  string,
  { readonly entity: string; readonly rows: readonly DataRecord[]; readonly complete: boolean }
> {
  return Object.create(null) as Record<
    string,
    { readonly entity: string; readonly rows: readonly DataRecord[]; readonly complete: boolean }
  >;
}

async function authorizeEntityRows(
  rows: readonly DataRecord[],
  entityId: string,
  grant: ReadGrant,
  query: QuerySpec,
  context: ReadContext,
  startedAt: number,
  budget: QueryBudget,
  workNow: () => number,
  current: () => boolean,
): Promise<Outcome<readonly DataRecord[]>> {
  const authorized: DataRecord[] = [];
  for (const row of rows) {
    const decision = await authorizeRow(entityId, row, grant, query, context, startedAt, budget, workNow, current);
    if (!decision.ok) return decision;
    if (decision.value) authorized.push(row);
  }
  return { ok: true, value: Object.freeze(authorized) };
}

async function authorizeRow(
  entityId: string,
  row: DataRecord,
  grant: ReadGrant,
  query: QuerySpec,
  context: ReadContext,
  startedAt: number,
  budget: QueryBudget,
  workNow: () => number,
  current: () => boolean,
): Promise<Outcome<boolean>> {
  const active = canAuthorizeRow(context, startedAt, budget, workNow);
  if (!active.ok) return active;
  if (grant.rowPolicy === undefined) return { ok: true, value: true };
  const remaining = budget.maxMilliseconds - (workNow() - startedAt);
  const permission = await awaitBoundedResult(
    context,
    remaining,
    () => failure('data.budget', ROW_TIME_BUDGET_ERROR),
    ROW_TIME_BUDGET_ERROR,
    (signal) => evaluateRowPolicy(grant, entityId, row, query, context, signal),
  );
  if (!permission.ok) return permission;
  if (typeof permission.value !== 'boolean') return failure('data.denied', ROW_AUTHORIZATION_ERROR);
  if (!current())
    return failure('data.stale-plan', 'The catalog or source changed while row authorization was being resolved.');
  return { ok: true, value: permission.value };
}

function canAuthorizeRow(
  context: ReadContext,
  startedAt: number,
  budget: QueryBudget,
  workNow: () => number,
): Outcome<void> {
  if (context.signal?.aborted) return failure('data.aborted', 'The result execution was cancelled.');
  if (workNow() - startedAt > budget.maxMilliseconds) return failure('data.budget', ROW_TIME_BUDGET_ERROR);
  return { ok: true, value: undefined };
}

async function evaluateRowPolicy(
  grant: ReadGrant,
  entityId: string,
  row: DataRecord,
  query: QuerySpec,
  context: ReadContext,
  signal: AbortSignal,
): Promise<Outcome<boolean>> {
  let decision: Promise<boolean> | boolean;
  try {
    decision = grant.rowPolicy!({ entityId, row, query, context: { ...context, signal } });
  } catch {
    return failure('data.denied', ROW_AUTHORIZATION_ERROR);
  }
  return resolveValueWithAbort(decision, signal, 'data.denied', ROW_AUTHORIZATION_ERROR);
}
