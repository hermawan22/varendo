import type { Outcome } from '@varendo/core';
import type {
  AeliqoNavigationFeedbackContent,
  AeliqoPaginationBinding,
  AeliqoPaginationCursor,
  AeliqoTabsBinding,
  AeliqoTabsBindingItem,
} from './navigation-feedback-types.js';
import {
  MAX_ITEMS,
  MAX_PAGE,
  MAX_TEXT,
  bounded,
  boundedArray,
  exactKeys,
  fail,
  record,
  requireContent,
} from './navigation-feedback-support.js';

export function normalizePagination(
  value: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
): Outcome<readonly AeliqoPaginationBinding[]> {
  const source = boundedArray(value, 'pagination');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: AeliqoPaginationBinding[] = [];
  for (const raw of source.value) {
    const entry = normalizePaginationBinding(raw, contents, seen);
    if (!entry.ok) return entry;
    seen.add(entry.value.id);
    result.push(entry.value);
  }
  return { ok: true, value: result };
}

function normalizePaginationBinding(
  raw: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): Outcome<AeliqoPaginationBinding> {
  const entry = record(raw);
  if (entry === undefined || !validPaginationEntry(entry, contents, seen))
    return fail('bindings', 'Pagination bindings require bounded page scope and cursor metadata.');
  const cursors = normalizeCursors(entry.cursors);
  if (!cursors.ok) return cursors;
  const page = entry.page as number;
  const pageCount = entry.pageCount as number | undefined;
  if (!hasAdjacentCursors(entry, cursors.value))
    return fail('bindings', 'Pagination movement requires a host cursor for every enabled adjacent page.');
  return {
    ok: true,
    value: {
      id: entry.id as string,
      labelRef: entry.labelRef as string,
      outputId: entry.outputId as string,
      queryDigest: entry.queryDigest as string,
      page,
      ...(pageCount === undefined ? {} : { pageCount }),
      hasPrevious: entry.hasPrevious as boolean,
      hasNext: entry.hasNext as boolean,
      ...(entry.pending === undefined ? {} : { pending: entry.pending as boolean }),
      cursors: cursors.value,
    },
  };
}

function validPaginationEntry(
  entry: Record<string, unknown> | undefined,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (entry === undefined || !exactKeys(entry, paginationKeys)) return false;
  return (
    validPaginationIdentity(entry, contents, seen) &&
    validPageScope(entry) &&
    validPageFlags(entry) &&
    Array.isArray(entry.cursors) &&
    entry.cursors.length <= MAX_ITEMS
  );
}

const paginationKeys = [
  'id',
  'labelRef',
  'outputId',
  'queryDigest',
  'page',
  'pageCount',
  'hasPrevious',
  'hasNext',
  'pending',
  'cursors',
] as const;

function validPaginationIdentity(
  entry: Record<string, unknown>,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (!bounded(entry.id) || seen.has(entry.id) || !requireContent(contents, entry.labelRef)) return false;
  return bounded(entry.outputId) && bounded(entry.queryDigest);
}

function validPageScope(entry: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(entry.page) || (entry.page as number) < 1 || (entry.page as number) > MAX_PAGE)
    return false;
  return validPageCount(entry);
}

function validPageCount(entry: Record<string, unknown>): boolean {
  if (entry.pageCount === undefined) return true;
  if (!Number.isSafeInteger(entry.pageCount)) return false;
  return (entry.pageCount as number) >= (entry.page as number) && (entry.pageCount as number) <= MAX_PAGE;
}

function validPageFlags(entry: Record<string, unknown>): boolean {
  if (typeof entry.hasPrevious !== 'boolean' || typeof entry.hasNext !== 'boolean') return false;
  return entry.pending === undefined || typeof entry.pending === 'boolean';
}

function normalizeCursors(value: unknown): Outcome<readonly AeliqoPaginationCursor[]> {
  if (!Array.isArray(value) || value.length > MAX_ITEMS)
    return fail('bindings', 'Pagination cursors must have unique bounded page numbers.');
  const pages = new Set<number>();
  const cursors: AeliqoPaginationCursor[] = [];
  for (const raw of value) {
    const cursor = normalizeCursor(raw, pages);
    if (!cursor.ok) return cursor;
    pages.add(cursor.value.page);
    cursors.push(cursor.value);
  }
  return { ok: true, value: cursors };
}

function normalizeCursor(raw: unknown, pages: ReadonlySet<number>): Outcome<AeliqoPaginationCursor> {
  const cursor = record(raw);
  if (cursor === undefined || !validCursor(cursor, pages))
    return fail('bindings', 'Pagination cursors must have unique bounded page numbers.');
  return { ok: true, value: { page: cursor.page as number, cursor: cursor.cursor as string } };
}

function validCursor(cursor: Record<string, unknown> | undefined, pages: ReadonlySet<number>): boolean {
  if (cursor === undefined || !exactKeys(cursor, ['page', 'cursor'])) return false;
  if (!Number.isSafeInteger(cursor.page)) return false;
  if ((cursor.page as number) < 1 || (cursor.page as number) > MAX_PAGE || pages.has(cursor.page as number))
    return false;
  return bounded(cursor.cursor, MAX_TEXT);
}

function hasAdjacentCursors(entry: Record<string, unknown>, cursors: readonly AeliqoPaginationCursor[]): boolean {
  const pages = new Set(cursors.map((cursor) => cursor.page));
  const page = entry.page as number;
  if (entry.hasNext === true && !pages.has(page + 1)) return false;
  const previousPage = page - 1;
  return entry.hasPrevious !== true || previousPage <= 0 || pages.has(previousPage);
}

export function normalizeTabs(
  value: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
): Outcome<readonly AeliqoTabsBinding[]> {
  const source = boundedArray(value, 'tabs');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: AeliqoTabsBinding[] = [];
  for (const raw of source.value) {
    const entry = normalizeTabsBinding(raw, contents, seen);
    if (!entry.ok) return entry;
    seen.add(entry.value.id);
    result.push(entry.value);
  }
  return { ok: true, value: result };
}

function normalizeTabsBinding(
  raw: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): Outcome<AeliqoTabsBinding> {
  const entry = record(raw);
  if (entry === undefined || !validTabsEntry(entry, seen))
    return fail('bindings', 'Tab bindings require unique IDs and one to thirty-two items.');
  const items = normalizeTabItems(entry.items, contents);
  if (!items.ok) return items;
  if (!items.value.some((tab) => tab.disabled !== true))
    return fail('bindings', 'A tab set requires at least one enabled tab.');
  return { ok: true, value: { id: entry.id as string, items: items.value } };
}

function validTabsEntry(entry: Record<string, unknown> | undefined, seen: ReadonlySet<string>): boolean {
  if (entry === undefined || !exactKeys(entry, ['id', 'items'])) return false;
  if (!bounded(entry.id) || seen.has(entry.id) || !Array.isArray(entry.items)) return false;
  return entry.items.length > 0 && entry.items.length <= 32;
}

function normalizeTabItems(
  value: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
): Outcome<readonly AeliqoTabsBindingItem[]> {
  const seen = new Set<string>();
  const items: AeliqoTabsBindingItem[] = [];
  for (const raw of value as readonly unknown[]) {
    const item = normalizeTabItem(raw, contents, seen);
    if (!item.ok) return item;
    seen.add(item.value.id);
    items.push(item.value);
  }
  return { ok: true, value: items };
}

function normalizeTabItem(
  raw: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): Outcome<AeliqoTabsBindingItem> {
  const tab = record(raw);
  if (tab === undefined || !validTabItem(tab, contents, seen))
    return fail('bindings', 'Tab items must use unique host labels and optional host content.');
  return {
    ok: true,
    value: {
      id: tab.id as string,
      labelRef: tab.labelRef as string,
      ...(tab.contentRef === undefined ? {} : { contentRef: tab.contentRef as string }),
      ...(tab.disabled === undefined ? {} : { disabled: tab.disabled as boolean }),
    },
  };
}

function validTabItem(
  tab: Record<string, unknown> | undefined,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (tab === undefined || !exactKeys(tab, ['id', 'labelRef', 'contentRef', 'disabled'])) return false;
  if (!bounded(tab.id) || seen.has(tab.id) || !requireContent(contents, tab.labelRef)) return false;
  if (tab.contentRef !== undefined && !requireContent(contents, tab.contentRef)) return false;
  return tab.disabled === undefined || typeof tab.disabled === 'boolean';
}
