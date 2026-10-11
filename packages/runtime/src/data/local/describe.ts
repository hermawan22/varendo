import { parseCatalog } from '@varendo/core';
import type { Outcome } from '@varendo/core';
import { WIRE_LIMITS } from '@varendo/core';
import { parseCatalogRequest } from '../schema.js';
import type { CatalogPage, CatalogRequest, QueryBudget, ReadContext, ReadGrant } from '../types.js';
import type { LocalDataServiceState } from './service-state.js';
import { authorizeWithDeadline } from './authorization.js';
import { minBudget, DEFAULT_BUDGET } from './budget.js';
import { allowedTarget, mergeCatalogPage } from './access.js';
import { isSnapshotCursor, resolveCursor } from './cursor.js';
import type { CursorValue } from './cursor.js';
import { canonical, failure, isSafePositive, policyContext } from './shared.js';

interface PreparedDescription {
  readonly input: CatalogRequest;
  readonly grant: ReadGrant;
  readonly budget: QueryBudget;
  readonly startedAt: number;
  readonly initialCatalog: LocalDataServiceState['currentCatalog'];
  readonly initialSnapshot: LocalDataServiceState['snapshot'];
}

export async function describeLocalData(
  state: LocalDataServiceState,
  request: unknown,
  context: ReadContext = {},
): Promise<Outcome<CatalogPage>> {
  const prepared = await prepareDescription(state, request, context, state.workNow());
  if (!prepared.ok) return prepared;
  return createCatalogPage(state, prepared.value, context);
}

async function prepareDescription(
  state: LocalDataServiceState,
  request: unknown,
  context: ReadContext,
  startedAt: number,
): Promise<Outcome<PreparedDescription>> {
  const initialCatalog = state.currentCatalog;
  const initialSnapshot = state.snapshot;
  const parsed = parseCatalogRequest(request);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (input.catalogRevision !== null && input.catalogRevision !== state.currentCatalog.revision)
    return failure('data.stale-catalog', 'The requested catalog revision is no longer current.', ['catalogRevision']);
  const grant = await authorizeWithDeadline(
    state.options.authorize,
    'describe',
    input.requestId,
    input.target,
    policyContext(context),
    Math.min(input.budget.maxMilliseconds, state.options.hostBudget?.maxMilliseconds ?? DEFAULT_BUDGET.maxMilliseconds),
  );
  if (!grant.ok) return grant;
  if (context.signal?.aborted) return failure('data.aborted', 'The catalog request was cancelled.');
  if (!isCurrentCatalog(state, initialCatalog, initialSnapshot))
    return failure('data.stale-catalog', 'The catalog or source changed while authorization was being resolved.');
  if (!allowedTarget(input.target, state.currentCatalog, grant.value))
    return failure('data.denied', 'The requested catalog target is not available in the current authorization scope.', [
      'target',
    ]);
  return {
    ok: true,
    value: {
      input,
      grant: grant.value,
      budget: minBudget(input.budget, state.options.hostBudget ?? DEFAULT_BUDGET, grant.value.maxBudget),
      startedAt,
      initialCatalog,
      initialSnapshot,
    },
  };
}

function isCurrentCatalog(
  state: LocalDataServiceState,
  catalog: LocalDataServiceState['currentCatalog'],
  snapshot: LocalDataServiceState['snapshot'],
): boolean {
  return state.currentCatalog === catalog && state.snapshot === snapshot;
}

async function createCatalogPage(
  state: LocalDataServiceState,
  prepared: PreparedDescription,
  context: ReadContext,
): Promise<Outcome<CatalogPage>> {
  const { input, grant, budget, startedAt, initialCatalog, initialSnapshot } = prepared;
  if (exceededTimeBudget(startedAt, budget, state.workNow))
    return failure('data.budget', 'Discovery exceeded the effective time budget.', ['budget']);
  const pageSize = catalogPageSize(input.pageSize, budget);
  if (!pageSize.ok) return pageSize;
  const offset = catalogPageOffset(input, state, grant);
  if (!offset.ok) return offset;
  const page = mergeCatalogPage(
    state.currentCatalog,
    input.target,
    grant,
    offset.value,
    pageSize.value,
    state.snapshot.sourceRevision,
    grant.scopeDigest,
    state.now() + state.cursorTtlMs,
    grant.cursorPartition ?? grant.scopeDigest,
    state.cursorStore,
    state.now(),
    state.maxCursors,
  );
  const catalog = parseCatalog(page.catalog);
  if (!catalog.ok) return failure('data.catalog', 'The authorized catalog projection is not canonical.');
  if (context.signal?.aborted) return failure('data.aborted', 'The catalog request was cancelled.');
  if (exceededTimeBudget(startedAt, budget, state.workNow))
    return failure('data.budget', 'Discovery exceeded the effective time budget.', ['budget']);
  if (!isCurrentCatalog(state, initialCatalog, initialSnapshot))
    return failure('data.stale-catalog', 'The catalog or source changed while the catalog page was being built.');
  const pageValue = assembleCatalogPage(state, input, grant, budget, catalog.value, page.nextCursor);
  return validateCatalogPageLimits(pageValue, budget);
}

function catalogPageSize(requested: number | undefined, budget: QueryBudget): Outcome<number> {
  const pageSize = Math.min(requested ?? Math.min(100, WIRE_LIMITS.array), budget.maxRows);
  if (!isSafePositive(pageSize) || pageSize > WIRE_LIMITS.array)
    return failure('data.budget', 'Catalog page size exceeds the bounded discovery budget.', ['pageSize']);
  return { ok: true, value: pageSize };
}

function catalogPageOffset(input: CatalogRequest, state: LocalDataServiceState, grant: ReadGrant): Outcome<number> {
  if (input.cursor === undefined) return { ok: true, value: 0 };
  const partition = grant.cursorPartition ?? grant.scopeDigest;
  const cursor = resolveCursor(input.cursor, partition, state.cursorStore, state.now());
  if (catalogCursorPinsMatch(cursor, input, state, grant)) return { ok: true, value: cursor.offset };
  return failure(
    'data.stale-cursor',
    'The catalog cursor does not belong to the current catalog, source, target or authorization scope.',
    ['cursor'],
  );
}

function catalogCursorPinsMatch(
  cursor: CursorValue | undefined,
  input: CatalogRequest,
  state: LocalDataServiceState,
  grant: ReadGrant,
): cursor is CursorValue {
  if (!isSnapshotCursor(cursor, 'catalog')) return false;
  if (!catalogCursorRevisionsMatch(cursor, state, grant)) return false;
  if (cursor.target !== canonical(input.target)) return false;
  return cursor.expiresAt === undefined || cursor.expiresAt > state.now();
}

function catalogCursorRevisionsMatch(cursor: CursorValue, state: LocalDataServiceState, grant: ReadGrant): boolean {
  if (cursor.catalogRevision !== state.currentCatalog.revision) return false;
  if (cursor.scopeDigest !== grant.scopeDigest) return false;
  if (cursor.policyRevision !== grant.policyRevision) return false;
  if (cursor.sourceRevision !== state.snapshot.sourceRevision) return false;
  return cursor.snapshotId === state.snapshot.sourceRevision;
}

function exceededTimeBudget(startedAt: number, budget: QueryBudget, now: () => number): boolean {
  return now() - startedAt > budget.maxMilliseconds;
}

function assembleCatalogPage(
  state: LocalDataServiceState,
  input: CatalogRequest,
  grant: ReadGrant,
  budget: QueryBudget,
  catalog: CatalogPage['catalog'],
  nextCursor: string | undefined,
): CatalogPage {
  return {
    version: '1',
    requestId: input.requestId,
    catalog,
    catalogRevision: state.currentCatalog.revision,
    sourceRevision: state.snapshot.sourceRevision,
    scopeDigest: grant.scopeDigest,
    target: input.target,
    effectiveBudget: budget,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function validateCatalogPageLimits(page: CatalogPage, budget: QueryBudget): Outcome<CatalogPage> {
  const columnCount = page.catalog.entities.reduce((count, entity) => count + entity.fields.length, 0);
  if (columnCount > budget.maxColumns)
    return failure('data.budget', 'Discovery exceeds the effective column budget.', ['budget', 'maxColumns']);
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > budget.maxBytes)
    return failure('data.budget', 'Discovery exceeds the effective response byte budget.', ['budget', 'maxBytes']);
  return { ok: true, value: page };
}
