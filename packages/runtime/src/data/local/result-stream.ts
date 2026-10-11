import type { Outcome, QuerySpec, ResultRef } from '@varendo/core';
import type { QueryResult } from '@varendo/core/query';
import type { AcceptedQuery, DataRecord, QueryBudget, ReadContext, ReadGrant } from '../types.js';
import type { ResultEvent as DataResultEvent } from '../types.js';
import { resolveCursor, type CursorStore } from './cursor.js';
import type { StoredPlan } from './service-state.js';
import { eventBytes, pageCursor, resultEvidence, resultPrecision, resultWarnings } from './result.js';
import { failure } from './shared.js';
import { queryFieldDefinition } from './query-planning.js';
import { resultPopulation } from './result.js';

type PartialReason = 'row budget' | 'page' | 'incomplete source' | 'time budget' | 'byte budget';

interface ResultResponseInput {
  readonly result: QueryResult;
  readonly accepted: AcceptedQuery;
  readonly stored: StoredPlan;
  readonly ref: ResultRef;
  readonly budget: QueryBudget;
  readonly startedAt: number;
  readonly context: ReadContext;
  readonly grant: ReadGrant;
  readonly cursorExpiresAt: number;
  readonly now: () => number;
  readonly cursorNow: number;
  readonly cursorStore: CursorStore;
  readonly maxCursorEntries: number;
}

interface BoundedRows {
  readonly rows: readonly DataRecord[];
  readonly events: readonly DataResultEvent[];
}

export function buildResultEvents(input: ResultResponseInput): Outcome<readonly DataResultEvent[]> {
  const offsetOutcome = requestedOffset(
    input.accepted.query,
    input.stored.cursorOffset,
    input.grant.cursorPartition ?? input.grant.scopeDigest,
    input.cursorStore,
    input.cursorNow,
  );
  if (!offsetOutcome.ok) return offsetOutcome;
  const offset = offsetOutcome.value;
  const pageLimit = input.accepted.query.page?.size ?? Number.MAX_SAFE_INTEGER;
  const rows = selectRows(input.result, offset, pageLimit, input.budget);
  const partialReason = determinePartialReason(
    input.result,
    rows,
    offset,
    pageLimit,
    input.budget,
    input.startedAt,
    input.now,
  );
  const bounded = fitResponse(input, rows, offset, partialReason);
  if (!bounded.ok) return bounded;
  return { ok: true, value: bounded.value.events };
}

function requestedOffset(
  query: QuerySpec,
  storedOffset: number | undefined,
  partition: string,
  cursorStore: CursorStore,
  cursorNow: number,
): Outcome<number> {
  const token = query.page?.cursor;
  if (token === undefined) return { ok: true, value: 0 };
  if (storedOffset !== undefined) return { ok: true, value: storedOffset };
  const cursor = resolveCursor(token, partition, cursorStore, cursorNow);
  if (cursor !== undefined) return { ok: true, value: cursor.offset };
  return failure('data.stale-cursor', 'The query cursor is no longer available on this host.', [
    'query',
    'page',
    'cursor',
  ]);
}

function selectRows(
  result: QueryResult,
  offset: number,
  pageLimit: number,
  budget: QueryBudget,
): readonly DataRecord[] {
  return result.rows.slice(offset, offset + Math.min(pageLimit, budget.maxRows)) as readonly DataRecord[];
}

function determinePartialReason(
  result: QueryResult,
  rows: readonly DataRecord[],
  offset: number,
  pageLimit: number,
  budget: QueryBudget,
  startedAt: number,
  now: () => number,
): PartialReason | undefined {
  let reason: PartialReason | undefined;
  const hasMoreRows = offset + rows.length < result.rows.length;
  if (offset > 0 || hasMoreRows) {
    reason = rows.length >= budget.maxRows && budget.maxRows <= pageLimit ? 'row budget' : 'page';
  }
  if (!result.complete && reason === undefined) reason = 'incomplete source';
  if (now() - startedAt > budget.maxMilliseconds) reason = 'time budget';
  return reason;
}

function fitResponse(
  input: ResultResponseInput,
  initialRows: readonly DataRecord[],
  offset: number,
  initialReason: PartialReason | undefined,
): Outcome<BoundedRows> {
  let rows = initialRows;
  let reason = initialReason;
  let events = createResponseEvents(input, rows, offset, reason);
  const initialStatus = responseStatus(input.context, input.startedAt, input.budget, input.now);
  if (initialStatus !== undefined) return initialStatus;
  if (responseBytes(events) <= input.budget.maxBytes) return { ok: true, value: { rows, events } };
  if (rows.length === 0) return responseTooLarge();
  const trimmed = trimRowsToByteBudget(input, rows, offset);
  if (!trimmed.ok) return trimmed;
  rows = trimmed.value.rows;
  reason = 'byte budget';
  events = createResponseEvents(input, rows, offset, reason);
  const finalStatus = responseStatus(input.context, input.startedAt, input.budget, input.now);
  if (finalStatus !== undefined) return finalStatus;
  if (responseBytes(events) > input.budget.maxBytes) return responseTooLarge();
  return { ok: true, value: { rows, events } };
}

function trimRowsToByteBudget(
  input: ResultResponseInput,
  rows: readonly DataRecord[],
  offset: number,
): Outcome<BoundedRows> {
  let low = 0;
  let high = rows.length;
  let best = -1;
  while (low <= high) {
    const status = responseStatus(input.context, input.startedAt, input.budget, input.now);
    if (status !== undefined) return status;
    const middle = Math.ceil((low + high) / 2);
    const candidate = rows.slice(0, middle);
    const events = createResponseEvents(input, candidate, offset, 'byte budget');
    if (responseBytes(events) <= input.budget.maxBytes) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best < 0) return responseTooLarge();
  const boundedRows = rows.slice(0, best);
  return {
    ok: true,
    value: { rows: boundedRows, events: createResponseEvents(input, boundedRows, offset, 'byte budget') },
  };
}

function responseStatus(
  context: ReadContext,
  startedAt: number,
  budget: QueryBudget,
  now: () => number,
): Outcome<never> | undefined {
  if (context.signal?.aborted) return failure('data.aborted', 'The result execution was cancelled.');
  if (now() - startedAt > budget.maxMilliseconds)
    return failure('data.budget', 'Execution exceeded the effective time budget while bounding the response.');
  return undefined;
}

function responseTooLarge(): Outcome<never> {
  return failure('data.budget', 'The bounded result cannot fit the effective response byte budget.');
}

function responseBytes(events: readonly DataResultEvent[]): number {
  return events.reduce((total, event) => total + eventBytes(event), 0);
}

function createResponseEvents(
  input: ResultResponseInput,
  rows: readonly DataRecord[],
  offset: number,
  reason: PartialReason | undefined,
): readonly DataResultEvent[] {
  const { result, accepted, stored, ref } = input;
  const descriptor: DataResultEvent = {
    kind: 'descriptor',
    descriptor: {
      version: '1',
      ref,
      taskId: accepted.target.taskId,
      fields: result.schema.fields.map((field) => queryFieldDefinition(field, accepted.query)),
      identity: result.schema.identity,
      rowGrain: result.schema.grain,
      precision: resultPrecision(result),
      consistency: {
        kind: 'snapshot',
        snapshotId: accepted.sourceRevision,
        sourceRevisions: sourceRevisions(stored),
      },
      evidence: resultEvidence(result, stored.logical, accepted.query, accepted.queryDigest),
      filters: filters(accepted.query),
      ...(accepted.query.period === undefined ? {} : { period: accepted.query.period }),
      warnings: resultWarnings(result),
      lineageDigest: accepted.lineageDigest,
      lineage: stored.lineage,
      counts: { loaded: rows.length, population: resultPopulation(result, accepted.populationDigest) },
      coverage: coverage(reason, accepted.populationDigest),
    },
  };
  const events: DataResultEvent[] = [descriptor];
  if (rows.length > 0) events.push({ kind: 'batch', result: ref, sequence: 0, rows });
  if (input.budget.maxMessages >= 4) events.push(progressEvent(result, ref, rows.length));
  events.push(
    completeEvent(
      result,
      accepted,
      ref,
      rows.length,
      offset,
      reason,
      input.grant,
      input.cursorExpiresAt,
      input.cursorStore,
      input.cursorNow,
      input.maxCursorEntries,
    ),
  );
  return events;
}

function sourceRevisions(stored: StoredPlan): Record<string, string> {
  return Object.fromEntries(stored.scanEntities.map((entity) => [entity, stored.accepted.sourceRevision]));
}

function filters(query: QuerySpec): readonly NonNullable<QuerySpec['where']>[] {
  return query.where === undefined ? [] : [query.where];
}

function coverage(reason: PartialReason | undefined, populationDigest: string) {
  if (reason === undefined) return { kind: 'complete' as const, populationDigest };
  return { kind: 'partial' as const, populationDigest, reason };
}

function progressEvent(result: QueryResult, ref: ResultRef, loaded: number): DataResultEvent {
  if (result.complete)
    return { kind: 'progress', result: ref, completed: loaded, total: result.rows.length, unit: 'rows' };
  return { kind: 'progress', result: ref, completed: loaded, unit: 'rows' };
}

function completeEvent(
  result: QueryResult,
  accepted: AcceptedQuery,
  ref: ResultRef,
  rowCount: number,
  offset: number,
  reason: PartialReason | undefined,
  grant: ReadGrant,
  cursorExpiresAt: number,
  cursorStore: CursorStore,
  cursorNow: number,
  maxCursorEntries: number,
): DataResultEvent {
  const nextOffset = offset + rowCount;
  const canContinue = reason !== undefined && nextOffset < result.rows.length;
  return {
    kind: 'complete',
    result: ref,
    finalCoverage: coverage(reason, accepted.populationDigest),
    ...(canContinue
      ? { cursor: pageCursor(accepted, nextOffset, grant, cursorExpiresAt, cursorStore, cursorNow, maxCursorEntries) }
      : {}),
  };
}
