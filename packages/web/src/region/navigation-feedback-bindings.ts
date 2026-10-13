import { parseWireValue, type Outcome } from '@varendo/core';
import type {
  VarendoBreadcrumbBinding,
  VarendoMenuBinding,
  VarendoNavigationFeedbackAction,
  VarendoNavigationFeedbackBindings,
  VarendoNavigationFeedbackContent,
  VarendoNavigationFeedbackRoute,
  VarendoPaginationBinding,
  VarendoTabsBinding,
  VarendoTreeBinding,
} from './navigation-feedback-types.js';
import { bounded, exactKeys, fail, freeze, record } from './navigation-feedback-support.js';
import { normalizeActions, normalizeContents, normalizeRoutes } from './navigation-feedback-normalize-basic.js';
import { normalizeBreadcrumbs, normalizeMenus } from './navigation-feedback-normalize-menus.js';
import { normalizePagination, normalizeTabs } from './navigation-feedback-normalize-pages.js';
import { normalizeTrees } from './navigation-feedback-normalize-trees.js';
import { normalizeFeedback } from './navigation-feedback-normalize-feedback.js';

interface PrimaryBindings {
  readonly revision: string;
  readonly contents: readonly VarendoNavigationFeedbackContent[];
  readonly routes: readonly VarendoNavigationFeedbackRoute[];
  readonly actions: readonly VarendoNavigationFeedbackAction[];
  readonly contentIndex: Map<string, VarendoNavigationFeedbackContent>;
  readonly routeIndex: Map<string, VarendoNavigationFeedbackRoute>;
  readonly actionIndex: Map<string, VarendoNavigationFeedbackAction>;
}

interface NavigationBindings {
  readonly breadcrumbs: readonly VarendoBreadcrumbBinding[];
  readonly menus: readonly VarendoMenuBinding[];
  readonly pagination: readonly VarendoPaginationBinding[];
  readonly tabs: readonly VarendoTabsBinding[];
  readonly trees: readonly VarendoTreeBinding[];
}

export function copyBindings(
  input: VarendoNavigationFeedbackBindings | undefined,
): Outcome<VarendoNavigationFeedbackBindings> {
  if (input === undefined) return { ok: true, value: { revision: 'unconfigured' } };
  const source = copiedInput(input);
  if (!source.ok) return source;
  const primary = normalizePrimaryBindings(source.value);
  if (!primary.ok) return primary;
  const navigation = normalizeNavigationBindings(source.value, primary.value);
  if (!navigation.ok) return navigation;
  const feedback = normalizeFeedback(source.value.feedback, primary.value.contentIndex, primary.value.actionIndex);
  if (!feedback.ok) return feedback;
  return {
    ok: true,
    value: freeze({
      revision: primary.value.revision,
      contents: primary.value.contents,
      routes: primary.value.routes,
      actions: primary.value.actions,
      breadcrumbs: navigation.value.breadcrumbs,
      menus: navigation.value.menus,
      pagination: navigation.value.pagination,
      tabs: navigation.value.tabs,
      trees: navigation.value.trees,
      feedback: feedback.value,
    }),
  };
}

function copiedInput(input: VarendoNavigationFeedbackBindings): Outcome<Record<string, unknown>> {
  const parsed = parseWireValue(input);
  if (!parsed.ok) return fail('bindings', 'Navigation and feedback bindings must be bounded JSON data.');
  let copied: unknown;
  try {
    copied = JSON.parse(JSON.stringify(parsed.value));
  } catch {
    return fail('bindings', 'Navigation and feedback bindings could not be copied.');
  }
  const candidate = record(copied);
  if (candidate === undefined || !exactKeys(candidate, BINDING_KEYS) || !bounded(candidate.revision))
    return fail('bindings', 'Binding metadata requires a bounded revision and known collections.');
  return { ok: true, value: candidate };
}

const BINDING_KEYS = [
  'revision',
  'contents',
  'routes',
  'actions',
  'breadcrumbs',
  'menus',
  'pagination',
  'tabs',
  'trees',
  'feedback',
] as const;

function normalizePrimaryBindings(candidate: Record<string, unknown>): Outcome<PrimaryBindings> {
  const contents = normalizeContents(candidate.contents);
  if (!contents.ok) return contents;
  const routes = normalizeRoutes(candidate.routes);
  if (!routes.ok) return routes;
  const actions = normalizeActions(candidate.actions);
  if (!actions.ok) return actions;
  return {
    ok: true,
    value: {
      revision: candidate.revision as string,
      contents: contents.value,
      routes: routes.value,
      actions: actions.value,
      contentIndex: new Map(contents.value.map((entry) => [entry.id, entry])),
      routeIndex: new Map(routes.value.map((entry) => [entry.id, entry])),
      actionIndex: new Map(actions.value.map((entry) => [entry.id, entry])),
    },
  };
}

function normalizeNavigationBindings(
  candidate: Record<string, unknown>,
  primary: PrimaryBindings,
): Outcome<NavigationBindings> {
  const breadcrumbs = normalizeBreadcrumbs(candidate.breadcrumbs, primary.contentIndex, primary.routeIndex);
  if (!breadcrumbs.ok) return breadcrumbs;
  const menus = normalizeMenus(candidate.menus, primary.contentIndex, primary.routeIndex, primary.actionIndex);
  if (!menus.ok) return menus;
  const pagination = normalizePagination(candidate.pagination, primary.contentIndex);
  if (!pagination.ok) return pagination;
  const tabs = normalizeTabs(candidate.tabs, primary.contentIndex);
  if (!tabs.ok) return tabs;
  const trees = normalizeTrees(candidate.trees, primary.contentIndex, primary.routeIndex, primary.actionIndex);
  if (!trees.ok) return trees;
  return {
    ok: true,
    value: {
      breadcrumbs: breadcrumbs.value,
      menus: menus.value,
      pagination: pagination.value,
      tabs: tabs.value,
      trees: trees.value,
    },
  };
}
