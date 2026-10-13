import type { Outcome } from '@varendo/core';
import type {
  VarendoBreadcrumbBinding,
  VarendoBreadcrumbBindingItem,
  VarendoMenuBinding,
  VarendoMenuBindingItem,
  VarendoNavigationFeedbackAction,
  VarendoNavigationFeedbackContent,
  VarendoNavigationFeedbackRoute,
} from './navigation-feedback-types.js';
import {
  MAX_ITEMS,
  bounded,
  boundedArray,
  exactKeys,
  fail,
  record,
  requireAction,
  requireContent,
  requireRoute,
} from './navigation-feedback-support.js';

export function normalizeBreadcrumbs(
  value: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
): Outcome<readonly VarendoBreadcrumbBinding[]> {
  const source = boundedArray(value, 'breadcrumbs');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: VarendoBreadcrumbBinding[] = [];
  for (const raw of source.value) {
    const entry = normalizeBreadcrumb(raw, contents, routes, seen);
    if (!entry.ok) return entry;
    seen.add(entry.value.id);
    result.push(entry.value);
  }
  return { ok: true, value: result };
}

function normalizeBreadcrumb(
  raw: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  seen: ReadonlySet<string>,
): Outcome<VarendoBreadcrumbBinding> {
  const entry = record(raw);
  if (entry === undefined || !validBreadcrumbEntry(entry, contents, seen))
    return fail('bindings', 'Breadcrumb bindings require unique IDs, host labels and bounded items.');
  const items = normalizeBreadcrumbItems(entry.items, contents, routes);
  if (!items.ok) return items;
  return {
    ok: true,
    value: { id: entry.id as string, labelRef: entry.labelRef as string, items: items.value },
  };
}

function validBreadcrumbEntry(
  entry: Record<string, unknown> | undefined,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (entry === undefined || !exactKeys(entry, ['id', 'labelRef', 'items'])) return false;
  if (!bounded(entry.id) || seen.has(entry.id) || !requireContent(contents, entry.labelRef)) return false;
  return Array.isArray(entry.items) && entry.items.length <= MAX_ITEMS;
}

function normalizeBreadcrumbItems(
  value: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
): Outcome<readonly VarendoBreadcrumbBindingItem[]> {
  const ids = new Set<string>();
  const items: VarendoBreadcrumbBindingItem[] = [];
  for (const raw of value as readonly unknown[]) {
    const item = normalizeBreadcrumbItem(raw, contents, routes, ids);
    if (!item.ok) return item;
    ids.add(item.value.id);
    items.push(item.value);
  }
  return { ok: true, value: items };
}

function normalizeBreadcrumbItem(
  raw: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  ids: ReadonlySet<string>,
): Outcome<VarendoBreadcrumbBindingItem> {
  const item = record(raw);
  if (item === undefined || !validBreadcrumbItem(item, contents, routes, ids))
    return fail('bindings', 'Breadcrumb items must use unique host labels and registered routes.');
  return {
    ok: true,
    value: {
      id: item.id as string,
      labelRef: item.labelRef as string,
      ...(item.routeRef === undefined ? {} : { routeRef: item.routeRef as string }),
      ...(item.current === undefined ? {} : { current: item.current as boolean }),
    },
  };
}

function validBreadcrumbItem(
  item: Record<string, unknown> | undefined,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  ids: ReadonlySet<string>,
): boolean {
  if (item === undefined || !exactKeys(item, ['id', 'labelRef', 'routeRef', 'current'])) return false;
  if (!bounded(item.id) || ids.has(item.id) || !requireContent(contents, item.labelRef)) return false;
  if (item.routeRef !== undefined && !requireRoute(routes, item.routeRef)) return false;
  return item.current === undefined || typeof item.current === 'boolean';
}

export function normalizeMenus(
  value: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
): Outcome<readonly VarendoMenuBinding[]> {
  const source = boundedArray(value, 'menus');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: VarendoMenuBinding[] = [];
  for (const raw of source.value) {
    const entry = normalizeMenu(raw, contents, routes, actions, seen);
    if (!entry.ok) return entry;
    seen.add(entry.value.id);
    result.push(entry.value);
  }
  return { ok: true, value: result };
}

function normalizeMenu(
  raw: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
  seen: ReadonlySet<string>,
): Outcome<VarendoMenuBinding> {
  const entry = record(raw);
  if (entry === undefined || !validMenuEntry(entry, contents, seen))
    return fail('bindings', 'Menu bindings require unique IDs, host labels and bounded items.');
  const items = normalizeMenuItems(entry.items, contents, routes, actions);
  if (!items.ok) return items;
  return { ok: true, value: { id: entry.id as string, labelRef: entry.labelRef as string, items: items.value } };
}

function validMenuEntry(
  entry: Record<string, unknown> | undefined,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (entry === undefined || !exactKeys(entry, ['id', 'labelRef', 'items'])) return false;
  if (!bounded(entry.id) || seen.has(entry.id) || !requireContent(contents, entry.labelRef)) return false;
  return Array.isArray(entry.items) && entry.items.length <= MAX_ITEMS;
}

function normalizeMenuItems(
  value: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
): Outcome<readonly VarendoMenuBindingItem[]> {
  const ids = new Set<string>();
  const items: VarendoMenuBindingItem[] = [];
  for (const raw of value as readonly unknown[]) {
    const item = normalizeMenuItem(raw, contents, routes, actions, ids);
    if (!item.ok) return item;
    ids.add(item.value.id);
    items.push(item.value);
  }
  return { ok: true, value: items };
}

function normalizeMenuItem(
  raw: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
  ids: ReadonlySet<string>,
): Outcome<VarendoMenuBindingItem> {
  const item = record(raw);
  if (item === undefined || !validMenuItem(item, contents, routes, actions, ids))
    return fail('bindings', 'Menu items require exactly one registered action or route.');
  return {
    ok: true,
    value: {
      id: item.id as string,
      labelRef: item.labelRef as string,
      ...(item.actionRef === undefined ? {} : { actionRef: item.actionRef as string }),
      ...(item.routeRef === undefined ? {} : { routeRef: item.routeRef as string }),
      ...(item.disabled === undefined ? {} : { disabled: item.disabled as boolean }),
    },
  };
}

function validMenuItem(
  item: Record<string, unknown> | undefined,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  routes: Map<string, VarendoNavigationFeedbackRoute>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
  ids: ReadonlySet<string>,
): boolean {
  if (item === undefined || !exactKeys(item, ['id', 'labelRef', 'actionRef', 'routeRef', 'disabled'])) return false;
  if (!bounded(item.id) || ids.has(item.id) || !requireContent(contents, item.labelRef)) return false;
  const hasAction = item.actionRef !== undefined;
  const hasRoute = item.routeRef !== undefined;
  if (hasAction === hasRoute) return false;
  if (hasAction && !requireAction(actions, item.actionRef)) return false;
  if (hasRoute && !requireRoute(routes, item.routeRef)) return false;
  return item.disabled === undefined || typeof item.disabled === 'boolean';
}
