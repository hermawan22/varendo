import type { VersionRef } from '@varendo/core';

export const VARENDO_NAVIGATION_FEEDBACK_REFS = Object.freeze({
  tabs: { id: 'navigation.tabs', revision: '1' },
  breadcrumb: { id: 'navigation.breadcrumb', revision: '1' },
  pagination: { id: 'navigation.pagination', revision: '1' },
  menu: { id: 'navigation.menu', revision: '1' },
  treeNav: { id: 'navigation.tree-nav', revision: '1' },
  tooltip: { id: 'feedback.tooltip', revision: '1' },
  popover: { id: 'feedback.popover', revision: '1' },
  dialog: { id: 'feedback.dialog', revision: '1' },
  drawer: { id: 'feedback.drawer', revision: '1' },
  toast: { id: 'feedback.toast', revision: '1' },
  alert: { id: 'feedback.alert', revision: '1' },
  progress: { id: 'feedback.progress', revision: '1' },
  skeleton: { id: 'feedback.skeleton', revision: '1' },
  emptyState: { id: 'feedback.empty-state', revision: '1' },
} satisfies Record<string, VersionRef>);

export const VARENDO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS = Object.freeze(
  Object.fromEntries(
    Object.entries(VARENDO_NAVIGATION_FEEDBACK_REFS).map(([key, ref]) => [
      key,
      { id: `${ref.id}.config`, revision: '1' },
    ]),
  ) as Record<keyof typeof VARENDO_NAVIGATION_FEEDBACK_REFS, VersionRef>,
);

export const VARENDO_NAVIGATION_FEEDBACK_OPERATION_REFS = Object.freeze({
  page: { id: 'navigation.page', revision: '1' },
} satisfies Record<string, VersionRef>);
