import type { Outcome, VersionRef } from '@varendo/core';
import type { PresentationManifest } from '@varendo/core/presentation';
import type { VarendoNavigationFeedbackBindings } from './navigation-feedback-types.js';
import {
  VARENDO_NAVIGATION_FEEDBACK_REFS,
  VARENDO_NAVIGATION_FEEDBACK_OPERATION_REFS,
} from './navigation-feedback-contracts.js';
import { copyBindings } from './navigation-feedback-bindings.js';
import { freeze, uniqueRefs } from './navigation-feedback-support.js';
import {
  breadcrumbConfig,
  menuConfig,
  paginationConfig,
  tabsConfig,
  treeConfig,
} from './navigation-feedback-config-navigation.js';
import { feedbackConfig } from './navigation-feedback-config-feedback.js';

export {
  VARENDO_NAVIGATION_FEEDBACK_REFS,
  VARENDO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS,
  VARENDO_NAVIGATION_FEEDBACK_OPERATION_REFS,
} from './navigation-feedback-contracts.js';
export type { VarendoNavigationFeedbackBindings } from './navigation-feedback-types.js';

function manifest(
  refValue: VersionRef,
  role: string,
  children: { readonly min: number; readonly max: number },
  visibility: PresentationManifest['visibility'],
  operations: readonly VersionRef[],
  resolveConfig: PresentationManifest['resolveConfig'],
): PresentationManifest {
  return {
    ref: refValue,
    configSchema: { id: `${refValue.id}.config`, revision: '1' },
    roles: [role],
    operations,
    result: 'none',
    children,
    visibility,
    extension: false,
    resolveConfig,
  };
}

/** Create the registered semantic adapters for one immutable host binding table. */
export function createNavigationFeedbackPresentationManifests(
  input?: VarendoNavigationFeedbackBindings,
): Outcome<readonly PresentationManifest[]> {
  const copied = copyBindings(input);
  if (!copied.ok) return copied;
  const bindings = copied.value;
  const routeRefs = (bindings.routes ?? []).map((route) => route.route);
  const actionRefs = (bindings.actions ?? []).map((action) => action.action);
  const navigationRefs = uniqueRefs([...routeRefs, ...actionRefs]);
  const manifests = [
    ...navigationManifests(bindings, routeRefs, navigationRefs),
    ...feedbackManifests(bindings, actionRefs),
  ];
  return { ok: true, value: freeze(manifests) };
}

function navigationManifests(
  bindings: VarendoNavigationFeedbackBindings,
  routeRefs: readonly VersionRef[],
  navigationRefs: readonly VersionRef[],
): readonly PresentationManifest[] {
  return [
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.tabs,
      'navigation',
      { min: 0, max: 32 },
      'exclusive',
      [],
      (values, _result, node) => tabsConfig(values, bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.breadcrumb,
      'navigation',
      { min: 0, max: 0 },
      'leaf',
      uniqueRefs(routeRefs),
      (values) => breadcrumbConfig(values, bindings),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.pagination,
      'navigation',
      { min: 0, max: 0 },
      'leaf',
      [VARENDO_NAVIGATION_FEEDBACK_OPERATION_REFS.page],
      (values) => paginationConfig(values, bindings),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.menu,
      'navigation',
      { min: 0, max: 0 },
      'leaf',
      navigationRefs,
      (values) => menuConfig(values, bindings),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.treeNav,
      'navigation',
      { min: 0, max: 0 },
      'leaf',
      navigationRefs,
      (values) => treeConfig(values, bindings),
    ),
  ];
}

function feedbackManifests(
  bindings: VarendoNavigationFeedbackBindings,
  actionRefs: readonly VersionRef[],
): readonly PresentationManifest[] {
  return [...overlayFeedbackManifests(bindings), ...statusFeedbackManifests(bindings, actionRefs)];
}

function overlayFeedbackManifests(bindings: VarendoNavigationFeedbackBindings): readonly PresentationManifest[] {
  return [
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.tooltip,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      [],
      (values, _result, node) => feedbackConfig(values, 'tooltip', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.popover,
      'feedback',
      { min: 0, max: 16 },
      'exclusive',
      [],
      (values, _result, node) => feedbackConfig(values, 'popover', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.dialog,
      'feedback',
      { min: 0, max: 16 },
      'exclusive',
      [],
      (values, _result, node) => feedbackConfig(values, 'dialog', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.drawer,
      'feedback',
      { min: 0, max: 16 },
      'exclusive',
      [],
      (values, _result, node) => feedbackConfig(values, 'drawer', bindings, node),
    ),
  ];
}

function statusFeedbackManifests(
  bindings: VarendoNavigationFeedbackBindings,
  actionRefs: readonly VersionRef[],
): readonly PresentationManifest[] {
  return [
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.toast,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      [],
      (values, _result, node) => feedbackConfig(values, 'toast', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.alert,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      uniqueRefs(actionRefs),
      (values, _result, node) => feedbackConfig(values, 'alert', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.progress,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      [],
      (values, _result, node) => feedbackConfig(values, 'progress', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.skeleton,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      [],
      (values, _result, node) => feedbackConfig(values, 'skeleton', bindings, node),
    ),
    manifest(
      VARENDO_NAVIGATION_FEEDBACK_REFS.emptyState,
      'feedback',
      { min: 0, max: 0 },
      'leaf',
      uniqueRefs(actionRefs),
      (values, _result, node) => feedbackConfig(values, 'emptyState', bindings, node),
    ),
  ];
}
