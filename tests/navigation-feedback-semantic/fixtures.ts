import type { PresentationPlan } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext } from '../../packages/core/src/presentation/index.js';
import {
  AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS,
  AELIQO_NAVIGATION_FEEDBACK_REFS,
  createNavigationFeedbackPresentationManifests,
  type AeliqoNavigationFeedbackBindings,
} from '../../packages/web/src/region/navigation-feedback-registry.js';

export const navigationFeedbackBindings: AeliqoNavigationFeedbackBindings = {
  revision: 'experience-nav-1',
  contents: [
    { id: 'crumb.label', text: 'Reports' },
    { id: 'crumb.home', text: 'Home' },
    { id: 'crumb.current', text: 'Current' },
    { id: 'menu.label', text: 'Actions' },
    { id: 'menu.open', text: 'Open' },
    { id: 'page.label', text: 'Pagination' },
    { id: 'tabs.breadcrumb', text: 'Breadcrumb' },
    { id: 'tabs.menu', text: 'Menu' },
    { id: 'tabs.pagination', text: 'Pagination' },
    { id: 'tabs.tree', text: 'Tree' },
    { id: 'tabs.tooltip', text: 'Tooltip' },
    { id: 'tabs.popover', text: 'Popover' },
    { id: 'tabs.drawer', text: 'Drawer' },
    { id: 'tabs.toast', text: 'Toast' },
    { id: 'tabs.alert', text: 'Alert' },
    { id: 'tabs.progress', text: 'Progress' },
    { id: 'tabs.skeleton', text: 'Skeleton' },
    { id: 'tabs.empty', text: 'Empty state' },
    { id: 'tree.label', text: 'Sections' },
    { id: 'tree.reports', text: 'Reports' },
    { id: 'tree.settings', text: 'Settings' },
    { id: 'tooltip.label', text: 'Help' },
    { id: 'tooltip.body', text: 'Helpful context' },
    { id: 'popover.label', text: 'Details' },
    { id: 'popover.body', text: 'Popover context' },
    { id: 'dialog.heading', text: 'Confirm details' },
    { id: 'drawer.heading', text: 'More details' },
    { id: 'toast.message', text: 'Saved' },
    { id: 'alert.heading', text: 'Notice' },
    { id: 'alert.message', text: 'Review this item' },
    { id: 'alert.action', text: 'Review' },
    { id: 'progress.label', text: 'Upload' },
    { id: 'skeleton.label', text: 'Loading records' },
    { id: 'empty.heading', text: 'No matches' },
    { id: 'empty.message', text: 'Try another filter' },
    { id: 'empty.action', text: 'Clear filter' },
  ],
  routes: [{ id: 'route.home', route: { id: 'route.home', revision: '1' }, params: {}, href: '/home' }],
  actions: [
    { id: 'action.open', action: { id: 'action.open', revision: '1' }, input: { mode: 'open' } },
    { id: 'action.review', action: { id: 'action.review', revision: '1' }, input: {} },
  ],
  breadcrumbs: [
    {
      id: 'breadcrumb.home',
      labelRef: 'crumb.label',
      items: [
        { id: 'home', labelRef: 'crumb.home', routeRef: 'route.home' },
        { id: 'current', labelRef: 'crumb.current', current: true },
      ],
    },
  ],
  menus: [
    {
      id: 'menu.actions',
      labelRef: 'menu.label',
      items: [{ id: 'open', labelRef: 'menu.open', actionRef: 'action.open' }],
    },
  ],
  pagination: [
    {
      id: 'page.results',
      labelRef: 'page.label',
      outputId: 'results',
      queryDigest: 'query-1',
      page: 1,
      pageCount: 2,
      hasPrevious: false,
      hasNext: true,
      cursors: [{ page: 2, cursor: 'cursor-2' }],
    },
  ],
  tabs: [
    {
      id: 'tabs.all',
      items: [
        { id: 'breadcrumb', labelRef: 'tabs.breadcrumb' },
        { id: 'menu', labelRef: 'tabs.menu' },
        { id: 'pagination', labelRef: 'tabs.pagination' },
        { id: 'tree', labelRef: 'tabs.tree' },
        { id: 'tooltip', labelRef: 'tabs.tooltip' },
        { id: 'popover', labelRef: 'tabs.popover' },
        { id: 'drawer', labelRef: 'tabs.drawer' },
        { id: 'toast', labelRef: 'tabs.toast' },
        { id: 'alert', labelRef: 'tabs.alert' },
        { id: 'progress', labelRef: 'tabs.progress' },
        { id: 'skeleton', labelRef: 'tabs.skeleton' },
        { id: 'empty', labelRef: 'tabs.empty' },
      ],
    },
  ],
  trees: [
    {
      id: 'tree.sections',
      labelRef: 'tree.label',
      nodes: [
        { id: 'reports', labelRef: 'tree.reports', routeRef: 'route.home' },
        { id: 'settings', labelRef: 'tree.settings', actionRef: 'action.open' },
      ],
    },
  ],
  feedback: [
    { id: 'tooltip.help', labelRef: 'tooltip.label', contentRef: 'tooltip.body' },
    { id: 'popover.help', labelRef: 'popover.label', contentRef: 'popover.body' },
    { id: 'dialog.confirm', headingRef: 'dialog.heading' },
    { id: 'drawer.details', headingRef: 'drawer.heading' },
    { id: 'toast.saved', messageRef: 'toast.message' },
    {
      id: 'alert.review',
      headingRef: 'alert.heading',
      messageRef: 'alert.message',
      actionLabelRef: 'alert.action',
      actionRef: 'action.review',
    },
    { id: 'progress.upload', labelRef: 'progress.label', progressValue: 4, progressMax: 10 },
    { id: 'skeleton.records', labelRef: 'skeleton.label' },
    {
      id: 'empty.results',
      headingRef: 'empty.heading',
      messageRef: 'empty.message',
      actionLabelRef: 'empty.action',
      actionRef: 'action.review',
      kind: 'no-matches',
    },
  ],
};

const preconditions = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: 'task-r1',
  regionRevision: 'region-r1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-r1',
  functionRegistryDigest: 'functions-1',
  results: [],
} as const;

export function navigationFeedbackPresentationPlan(): PresentationPlan {
  const ref = AELIQO_NAVIGATION_FEEDBACK_REFS;
  const schema = AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS;
  const config = (key: keyof typeof schema, bindingRef: string, values: Record<string, unknown> = {}) => ({
    schema: schema[key],
    values: { bindingRevision: navigationFeedbackBindings.revision, bindingRef, ...values },
  });
  const leaves: PresentationPlan['nodes'] = [
    {
      id: 'breadcrumb',
      role: 'navigation',
      representation: ref.breadcrumb,
      config: config('breadcrumb', 'breadcrumb.home'),
      children: [],
    },
    { id: 'menu', role: 'navigation', representation: ref.menu, config: config('menu', 'menu.actions'), children: [] },
    {
      id: 'pagination',
      role: 'navigation',
      representation: ref.pagination,
      config: config('pagination', 'page.results'),
      children: [],
    },
    {
      id: 'tree',
      role: 'navigation',
      representation: ref.treeNav,
      config: config('treeNav', 'tree.sections'),
      children: [],
    },
    {
      id: 'tooltip',
      role: 'feedback',
      representation: ref.tooltip,
      config: config('tooltip', 'tooltip.help'),
      children: [],
    },
    {
      id: 'popover',
      role: 'feedback',
      representation: ref.popover,
      config: config('popover', 'popover.help', { open: false }),
      children: [],
    },
    {
      id: 'drawer',
      role: 'feedback',
      representation: ref.drawer,
      config: config('drawer', 'drawer.details', { open: false, mode: 'inline' }),
      children: [],
    },
    {
      id: 'toast',
      role: 'feedback',
      representation: ref.toast,
      config: config('toast', 'toast.saved', { open: false }),
      children: [],
    },
    { id: 'alert', role: 'feedback', representation: ref.alert, config: config('alert', 'alert.review'), children: [] },
    {
      id: 'progress',
      role: 'feedback',
      representation: ref.progress,
      config: config('progress', 'progress.upload'),
      children: [],
    },
    {
      id: 'skeleton',
      role: 'feedback',
      representation: ref.skeleton,
      config: config('skeleton', 'skeleton.records'),
      children: [],
    },
    {
      id: 'empty',
      role: 'feedback',
      representation: ref.emptyState,
      config: config('emptyState', 'empty.results'),
      children: [],
    },
  ];
  return {
    id: 'plan-navigation-feedback',
    revision: 'plan-r1',
    rootId: 'dialog-root',
    preconditions,
    nodes: [
      {
        id: 'dialog-root',
        role: 'feedback',
        representation: ref.dialog,
        config: config('dialog', 'dialog.confirm', { open: true, modal: false }),
        children: ['tabs-root'],
      },
      {
        id: 'tabs-root',
        role: 'navigation',
        representation: ref.tabs,
        config: config('tabs', 'tabs.all', { defaultValue: 'breadcrumb', activation: 'automatic' }),
        children: leaves.map((leaf) => leaf.id),
      },
      ...leaves,
    ],
    links: [],
    coverage: [],
    stateTransfer: [],
    diagnostics: [],
  };
}

export function navigationFeedbackPresentationContext(): PresentationContext {
  const representations = Object.values(AELIQO_NAVIGATION_FEEDBACK_REFS).map((value) => value.id);
  return {
    task: {
      version: '1',
      id: 'task-navigation-feedback',
      revision: 'task-r1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'functions-1',
      regionId: 'region-1',
      goal: 'Navigate and review status',
      needs: [],
      assumptions: [],
      kind: 'presentation',
      inputs: [],
    },
    experience: {
      version: '1',
      id: 'experience-navigation-feedback',
      revision: 'experience-r1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: representations,
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 32, maxExpansions: 16 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [],
    current: preconditions,
    environment: {
      inlineSize: { state: 'unknown' },
      blockSize: { state: 'unknown' },
      textScale: { state: 'unknown' },
      pointer: 'unknown',
      hover: 'unknown',
      keyboard: 'unknown',
      locale: 'en-US',
      direction: 'ltr',
      reducedMotion: false,
      forcedColors: false,
    },
    rendererCapabilities: Object.values(AELIQO_NAVIGATION_FEEDBACK_REFS),
  };
}

export function navigationFeedbackRegistry() {
  const manifests = createNavigationFeedbackPresentationManifests(navigationFeedbackBindings);
  if (!manifests.ok) throw new Error(JSON.stringify(manifests.diagnostics));
  return manifests.value;
}
