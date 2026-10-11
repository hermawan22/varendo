import type { Outcome, VersionRef } from '@varendo/core';
import type { PresentationNode, PresentationValues } from '@varendo/core/presentation';
import type {
  AeliqoBreadcrumbBindingItem,
  AeliqoFeedbackBinding,
  AeliqoMenuBindingItem,
  AeliqoNavigationFeedbackAction,
  AeliqoNavigationFeedbackBindings,
  AeliqoNavigationFeedbackContent,
  AeliqoNavigationFeedbackRoute,
  AeliqoPaginationBinding,
  AeliqoTabsBinding,
  AeliqoTreeBindingNode,
} from './navigation-feedback-types.js';
import { AELIQO_NAVIGATION_FEEDBACK_OPERATION_REFS } from './navigation-feedback-contracts.js';
import {
  MAX_TREE_NODES,
  actionMap,
  contentMap,
  routeMap,
  uniqueRefs,
  fail,
  bounded,
} from './navigation-feedback-support.js';
import type { RecordValue } from './navigation-feedback-support.js';
import {
  actionValue,
  baseValues,
  configRecord,
  content,
  navPort,
  resolved,
  routeValue,
  type ResolvedPresentation,
} from './navigation-feedback-config-common.js';

function registeredEntry<T extends { readonly id: string }>(
  entries: readonly T[] | undefined,
  ref: string,
  message: string,
): Outcome<T> {
  const entry = entries?.find((candidate) => candidate.id === ref);
  return entry === undefined ? fail('binding', message) : { ok: true, value: entry };
}

interface BreadcrumbProjection {
  readonly items: readonly RecordValue[];
  readonly operations: readonly VersionRef[];
}

export function breadcrumbConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = configRecord(values, ['bindingRevision', 'bindingRef'], bindings);
  if (!checked.ok) return checked;
  const registered = registeredEntry(
    bindings.breadcrumbs,
    checked.value.bindingRef,
    'Breadcrumb bindingRef is not registered.',
  );
  if (!registered.ok) return registered;
  const entry = registered.value;
  const contents = contentMap(bindings);
  const projection = breadcrumbItems(entry.items, contents, routeMap(bindings));
  if (!projection.ok) return projection;
  const label = content(contents, entry.labelRef, 'breadcrumb label');
  if (!label.ok) return label;
  return resolved(
    { ...baseValues(bindings, entry.id), label: label.value!, items: projection.value.items },
    [],
    projection.value.operations.length === 0 ? [] : [navPort('navigate', 'navigate')],
    uniqueRefs(projection.value.operations),
  );
}

function breadcrumbItems(
  source: readonly AeliqoBreadcrumbBindingItem[],
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
): Outcome<BreadcrumbProjection> {
  const items: RecordValue[] = [];
  const operations: VersionRef[] = [];
  const hasExplicitCurrent = source.some((item) => item.current === true);
  for (const [index, item] of source.entries()) {
    const projected = breadcrumbItem(item, index, source.length, hasExplicitCurrent, contents, routes);
    if (!projected.ok) return projected;
    items.push(projected.value.item);
    if (projected.value.operation !== undefined) operations.push(projected.value.operation);
  }
  return { ok: true, value: { items, operations } };
}

function breadcrumbItem(
  item: NonNullable<AeliqoNavigationFeedbackBindings['breadcrumbs']>[number]['items'][number],
  index: number,
  itemCount: number,
  hasExplicitCurrent: boolean,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
): Outcome<{ readonly item: RecordValue; readonly operation?: VersionRef }> {
  const label = content(contents, item.labelRef, 'breadcrumb label');
  if (!label.ok) return label;
  const route = item.routeRef === undefined ? undefined : routes.get(item.routeRef);
  if (item.routeRef !== undefined && route === undefined)
    return fail('binding', 'Breadcrumb routeRef is not registered.');
  const current = item.current === true || (!hasExplicitCurrent && index === itemCount - 1);
  return {
    ok: true,
    value: {
      item: {
        id: item.id,
        label: label.value!,
        ...(route === undefined || current ? {} : routeValue(route)),
        ...(item.current === undefined ? {} : { current: item.current }),
      },
      ...(route === undefined || current ? {} : { operation: route.route }),
    },
  };
}

interface MenuProjection {
  readonly items: readonly RecordValue[];
  readonly operations: readonly VersionRef[];
  readonly hasRoute: boolean;
  readonly hasAction: boolean;
}

interface MenuItemProjection {
  readonly item: RecordValue;
  readonly operations: readonly VersionRef[];
  readonly hasRoute: boolean;
  readonly hasAction: boolean;
}

interface MenuTargets {
  readonly route?: AeliqoNavigationFeedbackRoute;
  readonly action?: AeliqoNavigationFeedbackAction;
  readonly reachable: boolean;
}

export function menuConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = configRecord(values, ['bindingRevision', 'bindingRef'], bindings);
  if (!checked.ok) return checked;
  const registered = registeredEntry(bindings.menus, checked.value.bindingRef, 'Menu bindingRef is not registered.');
  if (!registered.ok) return registered;
  const entry = registered.value;
  const contents = contentMap(bindings);
  const projection = menuItems(entry.items, contents, routeMap(bindings), actionMap(bindings));
  if (!projection.ok) return projection;
  const label = content(contents, entry.labelRef, 'menu label');
  if (!label.ok) return label;
  return resolved(
    { ...baseValues(bindings, entry.id), label: label.value!, items: projection.value.items },
    [],
    menuPorts(projection.value),
    uniqueRefs(projection.value.operations),
  );
}

function menuItems(
  source: readonly AeliqoMenuBindingItem[],
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
  actions: Map<string, AeliqoNavigationFeedbackAction>,
): Outcome<MenuProjection> {
  const items: RecordValue[] = [];
  const operations: VersionRef[] = [];
  let hasRoute = false;
  let hasAction = false;
  for (const item of source) {
    const projected = menuItem(item, contents, routes, actions);
    if (!projected.ok) return projected;
    items.push(projected.value.item);
    operations.push(...projected.value.operations);
    hasRoute ||= projected.value.hasRoute;
    hasAction ||= projected.value.hasAction;
  }
  return { ok: true, value: { items, operations, hasRoute, hasAction } };
}

function menuItem(
  item: AeliqoMenuBindingItem,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
  actions: Map<string, AeliqoNavigationFeedbackAction>,
): Outcome<MenuItemProjection> {
  const label = content(contents, item.labelRef, 'menu label');
  if (!label.ok) return label;
  const targets = registeredMenuTargets(item, routes, actions);
  if (!targets.ok) return targets;
  return menuItemProjection(item, label.value!, targets.value);
}

function registeredMenuTargets(
  item: AeliqoMenuBindingItem,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
  actions: Map<string, AeliqoNavigationFeedbackAction>,
): Outcome<MenuTargets> {
  const route = item.routeRef === undefined ? undefined : routes.get(item.routeRef);
  const action = item.actionRef === undefined ? undefined : actions.get(item.actionRef);
  if (item.routeRef !== undefined && route === undefined) return fail('binding', 'Menu routeRef is not registered.');
  if (item.actionRef !== undefined && action === undefined) return fail('binding', 'Menu actionRef is not registered.');
  return {
    ok: true,
    value: {
      ...(route === undefined ? {} : { route }),
      ...(action === undefined ? {} : { action }),
      reachable: item.disabled !== true,
    },
  };
}

function menuItemProjection(
  item: AeliqoMenuBindingItem,
  label: string,
  targets: MenuTargets,
): Outcome<MenuItemProjection> {
  const route = targets.route;
  const action = targets.action;
  const hasRoute = targets.reachable && route !== undefined;
  const hasAction = targets.reachable && action !== undefined;
  return {
    ok: true,
    value: {
      item: {
        id: item.id,
        label,
        ...(hasRoute && route !== undefined ? routeValue(route) : {}),
        ...(hasAction && action !== undefined ? actionValue(action) : {}),
        ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
      },
      operations: [
        ...(hasRoute && route !== undefined ? [route.route] : []),
        ...(hasAction && action !== undefined ? [action.action] : []),
      ],
      hasRoute,
      hasAction,
    },
  };
}

function menuPorts(projection: MenuProjection) {
  return [
    ...(projection.hasAction ? [navPort('action', 'action-request')] : []),
    ...(projection.hasRoute ? [navPort('navigate', 'navigate')] : []),
  ];
}

export function paginationConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = configRecord(values, ['bindingRevision', 'bindingRef'], bindings);
  if (!checked.ok) return checked;
  const registered = registeredEntry(
    bindings.pagination,
    checked.value.bindingRef,
    'Pagination bindingRef is not registered.',
  );
  if (!registered.ok) return registered;
  const entry = registered.value;
  const label = content(contentMap(bindings), entry.labelRef, 'pagination label');
  if (!label.ok) return label;
  const canMove = paginationCanMove(entry);
  return resolved(
    {
      ...baseValues(bindings, entry.id),
      label: label.value!,
      outputId: entry.outputId,
      queryDigest: entry.queryDigest,
      page: entry.page,
      ...(entry.pageCount === undefined ? {} : { pageCount: entry.pageCount }),
      hasPrevious: entry.hasPrevious,
      hasNext: entry.hasNext,
      pending: entry.pending ?? false,
      cursors: entry.cursors,
    },
    [],
    canMove ? [navPort('page', 'page')] : [],
    canMove ? [AELIQO_NAVIGATION_FEEDBACK_OPERATION_REFS.page] : [],
  );
}

function paginationCanMove(entry: AeliqoPaginationBinding): boolean {
  if (entry.pending === true) return false;
  const previous = entry.hasPrevious && entry.page > 1;
  const next = entry.hasNext && (entry.pageCount === undefined || entry.page < entry.pageCount);
  return previous || next;
}

export function tabsConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
  node?: PresentationNode,
): Outcome<ResolvedPresentation> {
  const checked = configRecord(
    values,
    ['bindingRevision', 'bindingRef', 'value', 'defaultValue', 'activation', 'orientation', 'idPrefix'],
    bindings,
  );
  if (!checked.ok) return checked;
  const registered = registeredEntry(bindings.tabs, checked.value.bindingRef, 'Tabs bindingRef is not registered.');
  if (!registered.ok) return registered;
  const entry = registered.value;
  if (!validTabChildren(entry, node))
    return fail('children', 'Tabs cannot bind child panels to disabled or missing tab items.');
  const invalidConfig = tabsConfigError(checked.value.input, entry);
  if (invalidConfig !== undefined) return fail('config', invalidConfig);
  const items = tabItems(entry, contentMap(bindings));
  if (!items.ok) return items;
  const output = tabsOutput(checked.value.input, bindings, entry.id, items.value);
  if (output.idPrefix !== undefined && !bounded(output.idPrefix))
    return fail('config', 'Tabs idPrefix must be bounded text.');
  return resolved(output);
}

function validTabChildren(entry: AeliqoTabsBinding, node: PresentationNode | undefined): boolean {
  if (node === undefined) return true;
  if (node.children.length > entry.items.length) return false;
  return !node.children.some((_, index) => entry.items[index]?.disabled === true);
}

function tabsConfigError(input: RecordValue, entry: AeliqoTabsBinding): string | undefined {
  const invalidSelection = invalidTabSelection(input, entry);
  if (invalidSelection !== undefined) return invalidSelection;
  if (input.activation !== undefined && input.activation !== 'automatic' && input.activation !== 'manual')
    return 'Tabs activation must be automatic or manual.';
  if (input.orientation !== undefined && input.orientation !== 'horizontal' && input.orientation !== 'vertical')
    return 'Tabs orientation must be horizontal or vertical.';
  return undefined;
}

function invalidTabSelection(input: RecordValue, entry: AeliqoTabsBinding): string | undefined {
  for (const key of ['value', 'defaultValue'] as const) {
    if (input[key] === undefined) continue;
    if (!enabledTab(input[key], entry)) return `${key} must identify an enabled item in the registered tab set.`;
  }
  return undefined;
}

function enabledTab(value: unknown, entry: AeliqoTabsBinding): boolean {
  if (!bounded(value)) return false;
  return entry.items.some((item) => item.id === value && item.disabled !== true);
}

function tabItems(
  entry: AeliqoTabsBinding,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
): Outcome<readonly RecordValue[]> {
  const items: RecordValue[] = [];
  for (const item of entry.items) {
    const label = content(contents, item.labelRef, 'tab label');
    if (!label.ok) return label;
    const panel = content(contents, item.contentRef, 'tab content', false);
    if (!panel.ok) return panel;
    items.push({
      id: item.id,
      label: label.value!,
      ...(panel.value === undefined ? {} : { content: panel.value }),
      ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    });
  }
  return { ok: true, value: items };
}

function tabsOutput(
  input: RecordValue,
  bindings: AeliqoNavigationFeedbackBindings,
  id: string,
  items: readonly RecordValue[],
): RecordValue {
  return {
    ...baseValues(bindings, id),
    items,
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    ...(input.activation === undefined ? {} : { activation: input.activation }),
    ...(input.orientation === undefined ? {} : { orientation: input.orientation }),
    ...(input.idPrefix === undefined ? {} : { idPrefix: input.idPrefix }),
  };
}

interface TreeRenderContext {
  readonly input: RecordValue;
  readonly contents: Map<string, AeliqoNavigationFeedbackContent>;
  readonly routes: Map<string, AeliqoNavigationFeedbackRoute>;
  readonly actions: Map<string, AeliqoNavigationFeedbackAction>;
  readonly ids: Set<string>;
  readonly operations: VersionRef[];
  hasRoute: boolean;
  hasAction: boolean;
}

export function treeConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = configRecord(values, ['bindingRevision', 'bindingRef', 'expandedIds', 'selectedId'], bindings);
  if (!checked.ok) return checked;
  const registered = registeredEntry(bindings.trees, checked.value.bindingRef, 'Tree bindingRef is not registered.');
  if (!registered.ok) return registered;
  const entry = registered.value;
  const context = treeContext(checked.value.input, bindings);
  const nodes = renderTreeNodes(entry.nodes, context);
  const selectionError = treeSelectionError(checked.value.input, context.ids);
  if (selectionError !== undefined) return fail('config', selectionError);
  const label = content(context.contents, entry.labelRef, 'tree label');
  if (!label.ok) return label;
  return resolved(
    {
      ...baseValues(bindings, entry.id),
      label: label.value!,
      nodes,
      ...(checked.value.input.expandedIds === undefined ? {} : { expandedIds: checked.value.input.expandedIds }),
      ...(checked.value.input.selectedId === undefined ? {} : { selectedId: checked.value.input.selectedId }),
    },
    [],
    treePorts(context),
    uniqueRefs(context.operations),
  );
}

function treeContext(input: RecordValue, bindings: AeliqoNavigationFeedbackBindings): TreeRenderContext {
  return {
    input,
    contents: contentMap(bindings),
    routes: routeMap(bindings),
    actions: actionMap(bindings),
    ids: new Set<string>(),
    operations: [],
    hasRoute: false,
    hasAction: false,
  };
}

function renderTreeNodes(
  source: readonly AeliqoTreeBindingNode[],
  context: TreeRenderContext,
  reachable = true,
): RecordValue[] {
  return source.map((item) => renderTreeNode(item, context, reachable));
}

function renderTreeNode(item: AeliqoTreeBindingNode, context: TreeRenderContext, reachable: boolean): RecordValue {
  context.ids.add(item.id);
  const available = reachable && item.disabled !== true;
  const childrenReachable = reachable && (item.disabled !== true || isExpanded(context.input, item.id));
  const route = item.routeRef === undefined ? undefined : context.routes.get(item.routeRef);
  const action = item.actionRef === undefined ? undefined : context.actions.get(item.actionRef);
  addTreeOperations(context, available, route, action);
  return {
    id: item.id,
    label: context.contents.get(item.labelRef)!.text,
    ...(item.children === undefined ? {} : { children: renderTreeNodes(item.children, context, childrenReachable) }),
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    ...(route === undefined || !available ? {} : routeValue(route)),
    ...(action === undefined || !available ? {} : actionValue(action)),
  };
}

function addTreeOperations(
  context: TreeRenderContext,
  available: boolean,
  route: AeliqoNavigationFeedbackRoute | undefined,
  action: AeliqoNavigationFeedbackAction | undefined,
): void {
  if (!available) return;
  if (route !== undefined) {
    context.operations.push(route.route);
    context.hasRoute = true;
  }
  if (action !== undefined) {
    context.operations.push(action.action);
    context.hasAction = true;
  }
}

function isExpanded(input: RecordValue, id: string): boolean {
  return Array.isArray(input.expandedIds) && input.expandedIds.includes(id);
}

function treeSelectionError(input: RecordValue, ids: ReadonlySet<string>): string | undefined {
  if (!validExpandedIds(input.expandedIds, ids)) return 'expandedIds must name unique registered tree nodes.';
  if (input.selectedId !== undefined && !validSelectedId(input.selectedId, ids))
    return 'selectedId must name a registered tree node.';
  return undefined;
}

function validExpandedIds(value: unknown, ids: ReadonlySet<string>): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_TREE_NODES) return false;
  if (value.some((id) => typeof id !== 'string' || !ids.has(id))) return false;
  return new Set(value).size === value.length;
}

function validSelectedId(value: unknown, ids: ReadonlySet<string>): boolean {
  return typeof value === 'string' && ids.has(value);
}

function treePorts(context: TreeRenderContext) {
  return [
    ...(context.hasRoute ? [navPort('navigate', 'navigate')] : []),
    ...(context.hasAction ? [navPort('action', 'action-request')] : []),
  ];
}

export function feedbackBase(
  values: PresentationValues,
  allowed: readonly string[],
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<{
  readonly input: RecordValue;
  readonly entry: AeliqoFeedbackBinding;
  readonly contents: Map<string, AeliqoNavigationFeedbackContent>;
  readonly actions: Map<string, AeliqoNavigationFeedbackAction>;
}> {
  const checked = configRecord(values, allowed, bindings);
  if (!checked.ok) return checked;
  const registered = registeredEntry(
    bindings.feedback,
    checked.value.bindingRef,
    'Feedback bindingRef is not registered.',
  );
  if (!registered.ok) return registered;
  const entry = registered.value;
  return {
    ok: true,
    value: { input: checked.value.input, entry, contents: contentMap(bindings), actions: actionMap(bindings) },
  };
}
