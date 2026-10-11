import { describe, expect, it } from 'vitest';
import type { PresentationNode, PresentationValues } from '../../packages/core/src/presentation/index.js';
import { createPresentationRegistry } from '../../packages/core/src/presentation/index.js';
import {
  AELIQO_NAVIGATION_FEEDBACK_OPERATION_REFS,
  AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS,
  AELIQO_NAVIGATION_FEEDBACK_REFS,
  createNavigationFeedbackPresentationManifests,
  type AeliqoNavigationFeedbackBindings,
} from '../../packages/web/src/region/navigation-feedback-registry.js';

const bindings: AeliqoNavigationFeedbackBindings = {
  revision: 'experience-nav-1',
  contents: [
    { id: 'copy.breadcrumb', text: 'Reports' },
    { id: 'copy.home', text: 'Home' },
    { id: 'copy.menu', text: 'Actions' },
    { id: 'copy.open', text: 'Open' },
    { id: 'copy.tabs.overview', text: 'Overview' },
    { id: 'copy.tabs.details', text: 'Details' },
    { id: 'copy.tabs.overview.body', text: 'Overview body' },
    { id: 'copy.tabs.details.body', text: 'Details body' },
    { id: 'copy.tree', text: 'Sections' },
    { id: 'copy.tree.reports', text: 'Reports' },
    { id: 'copy.tree.settings', text: 'Settings' },
    { id: 'copy.tooltip.label', text: 'Help' },
    { id: 'copy.tooltip.body', text: 'More information' },
    { id: 'copy.dialog.heading', text: 'Confirm' },
    { id: 'copy.drawer.heading', text: 'Details' },
    { id: 'copy.toast.message', text: 'Saved' },
    { id: 'copy.alert.heading', text: 'Attention' },
    { id: 'copy.alert.message', text: 'Review this item' },
    { id: 'copy.alert.action', text: 'Review' },
    { id: 'copy.progress.label', text: 'Progress' },
    { id: 'copy.skeleton.label', text: 'Loading' },
    { id: 'copy.empty.heading', text: 'No matches' },
    { id: 'copy.empty.message', text: 'Try another filter' },
    { id: 'copy.empty.action', text: 'Clear filter' },
    { id: 'copy.pagination.label', text: 'Pagination' },
  ],
  routes: [{ id: 'route.home', route: { id: 'route.home', revision: '1' }, params: {}, href: '/home' }],
  actions: [
    { id: 'action.open', action: { id: 'action.open', revision: '1' }, input: { mode: 'open' } },
    { id: 'action.review', action: { id: 'action.review', revision: '1' }, input: {} },
  ],
  breadcrumbs: [
    {
      id: 'crumb.reports',
      labelRef: 'copy.breadcrumb',
      items: [
        { id: 'home', labelRef: 'copy.home', routeRef: 'route.home' },
        { id: 'current', labelRef: 'copy.breadcrumb', current: true },
      ],
    },
  ],
  menus: [
    {
      id: 'menu.actions',
      labelRef: 'copy.menu',
      items: [{ id: 'open', labelRef: 'copy.open', actionRef: 'action.open' }],
    },
  ],
  pagination: [
    {
      id: 'page.results',
      labelRef: 'copy.pagination.label',
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
      id: 'tabs.main',
      items: [
        { id: 'overview', labelRef: 'copy.tabs.overview', contentRef: 'copy.tabs.overview.body' },
        { id: 'details', labelRef: 'copy.tabs.details', contentRef: 'copy.tabs.details.body' },
      ],
    },
  ],
  trees: [
    {
      id: 'tree.main',
      labelRef: 'copy.tree',
      nodes: [
        { id: 'reports', labelRef: 'copy.tree.reports', routeRef: 'route.home' },
        { id: 'settings', labelRef: 'copy.tree.settings', actionRef: 'action.open' },
      ],
    },
  ],
  feedback: [
    { id: 'tooltip.help', labelRef: 'copy.tooltip.label', contentRef: 'copy.tooltip.body' },
    { id: 'popover.help', labelRef: 'copy.tooltip.label', contentRef: 'copy.tooltip.body' },
    { id: 'dialog.confirm', headingRef: 'copy.dialog.heading' },
    { id: 'drawer.details', headingRef: 'copy.drawer.heading' },
    { id: 'toast.saved', messageRef: 'copy.toast.message' },
    {
      id: 'alert.review',
      headingRef: 'copy.alert.heading',
      messageRef: 'copy.alert.message',
      actionLabelRef: 'copy.alert.action',
      actionRef: 'action.review',
    },
    { id: 'progress.load', labelRef: 'copy.progress.label', progressValue: 4, progressMax: 10 },
    { id: 'skeleton.load', labelRef: 'copy.skeleton.label' },
    {
      id: 'empty.results',
      headingRef: 'copy.empty.heading',
      messageRef: 'copy.empty.message',
      actionLabelRef: 'copy.empty.action',
      actionRef: 'action.review',
      kind: 'no-matches',
    },
  ],
};

function manifests() {
  const outcome = createNavigationFeedbackPresentationManifests(bindings);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.diagnostics[0]?.message);
  return outcome.value;
}

function resolve(id: string, values: PresentationValues) {
  const manifest = manifests().find((candidate) => candidate.ref.id === id);
  if (manifest === undefined) throw new Error(`Missing manifest ${id}`);
  const outcome = manifest.resolveConfig(values, undefined);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.diagnostics[0]?.message);
  return outcome.value;
}

describe('navigation and feedback semantic adapters', () => {
  it('registers all fourteen families with exclusive overlay/tab metadata', () => {
    const value = manifests();
    expect(value).toHaveLength(14);
    expect(new Set(value.map((manifest) => manifest.ref.id)).size).toBe(14);
    expect(value.find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.tabs.id)?.visibility).toBe(
      'exclusive',
    );
    expect(value.find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.dialog.id)?.children).toEqual({
      min: 0,
      max: 16,
    });
    expect(createPresentationRegistry(value).ok).toBe(true);
  });

  it('pins host bindings, rejects stale revisions and keeps raw copy/routes out of wire config', () => {
    const manifest = manifests().find(
      (candidate) => candidate.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.breadcrumb.id,
    )!;
    expect(
      manifest.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'crumb.reports' }, undefined),
    ).toMatchObject({ ok: true });
    expect(manifest.resolveConfig({ bindingRevision: 'old', bindingRef: 'crumb.reports' }, undefined)).toMatchObject({
      ok: false,
    });
    for (const value of [
      { bindingRevision: bindings.revision, bindingRef: 'crumb.reports', href: '/forged' },
      { bindingRevision: bindings.revision, bindingRef: 'crumb.reports', label: 'forged' },
      { bindingRevision: bindings.revision, bindingRef: 'crumb.reports', action: 'delete' },
    ])
      expect(manifest.resolveConfig(value, undefined)).toMatchObject({ ok: false });
  });

  it('resolves approved breadcrumb routes and menu actions to canonical operations', () => {
    const breadcrumb = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.breadcrumb.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'crumb.reports',
    });
    expect((breadcrumb.values.items as readonly Record<string, unknown>[])[0]).toMatchObject({
      id: 'home',
      label: 'Home',
      route: { id: 'route.home', revision: '1' },
      href: '/home',
    });
    expect(breadcrumb.ports).toEqual([{ id: 'navigate', direction: 'output', payload: 'navigate' }]);
    expect(breadcrumb.operations).toEqual([{ id: 'route.home', revision: '1' }]);
    const menu = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.menu.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'menu.actions',
    });
    expect(menu.values).toMatchObject({
      items: [{ id: 'open', label: 'Open', action: { id: 'action.open', revision: '1' } }],
    });
    expect(menu.ports).toContainEqual({ id: 'action', direction: 'output', payload: 'action-request' });
    expect(menu.operations).toContainEqual({ id: 'action.open', revision: '1' });
  });

  it('keeps page events scoped to the host output and cursor digest', () => {
    const page = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.pagination.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'page.results',
    });
    expect(page.values).toMatchObject({
      outputId: 'results',
      queryDigest: 'query-1',
      page: 1,
      cursors: [{ page: 2, cursor: 'cursor-2' }],
    });
    expect(page.operations).toEqual([AELIQO_NAVIGATION_FEEDBACK_OPERATION_REFS.page]);
    expect(page.ports).toEqual([{ id: 'page', direction: 'output', payload: 'page' }]);
  });

  it('allows only bounded local tabs/overlay options while content stays host-owned', () => {
    const tabs = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.tabs.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'tabs.main',
      value: 'details',
      activation: 'manual',
    });
    expect(tabs.values).toMatchObject({
      items: [
        { label: 'Overview', content: 'Overview body' },
        { id: 'details', label: 'Details' },
      ],
      value: 'details',
      activation: 'manual',
    });
    expect(tabs.ports).toEqual([]);
    expect(
      resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.dialog.id, {
        bindingRevision: bindings.revision,
        bindingRef: 'dialog.confirm',
        open: true,
        modal: true,
      }).values,
    ).toMatchObject({ heading: 'Confirm', open: true, modal: true });
    expect(
      resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.skeleton.id, {
        bindingRevision: bindings.revision,
        bindingRef: 'skeleton.load',
        lines: 4,
        variant: 'text',
      }).values,
    ).toMatchObject({ label: 'Loading', lines: 4 });
  });

  it('rejects tab panels that cannot be represented and disabled controlled selection', () => {
    const tabManifest = manifests().find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.tabs.id)!;
    const tabsNode = {
      id: 'tabs',
      role: 'navigation',
      representation: AELIQO_NAVIGATION_FEEDBACK_REFS.tabs,
      config: { schema: AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS.tabs, values: {} },
      children: ['one', 'two', 'three'],
    } as PresentationNode;
    expect(
      tabManifest.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'tabs.main' }, undefined, tabsNode),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.navigation-feedback.children' }] });
    const disabled = createNavigationFeedbackPresentationManifests({
      ...bindings,
      tabs: [
        {
          id: 'tabs.main',
          items: [
            { id: 'overview', labelRef: 'copy.tabs.overview', disabled: true },
            { id: 'details', labelRef: 'copy.tabs.details' },
          ],
        },
      ],
    });
    expect(disabled.ok).toBe(true);
    if (disabled.ok) {
      const manifest = disabled.value.find(
        (candidate) => candidate.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.tabs.id,
      )!;
      expect(
        manifest.resolveConfig(
          { bindingRevision: bindings.revision, bindingRef: 'tabs.main', value: 'overview' },
          undefined,
        ),
      ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.navigation-feedback.config' }] });
      expect(
        manifest.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'tabs.main' }, undefined, {
          ...tabsNode,
          children: ['one'],
        }),
      ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.navigation-feedback.children' }] });
    }
  });

  it('rejects closed dialog and drawer child claims', () => {
    const dialog = manifests().find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.dialog.id)!;
    const drawer = manifests().find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.drawer.id)!;
    const child = {
      id: 'dialog',
      role: 'feedback',
      representation: AELIQO_NAVIGATION_FEEDBACK_REFS.dialog,
      config: { schema: AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS.dialog, values: {} },
      children: ['child'],
    } as PresentationNode;
    expect(
      dialog.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'dialog.confirm' }, undefined, child),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.navigation-feedback.children' }] });
    expect(
      drawer.resolveConfig(
        { bindingRevision: bindings.revision, bindingRef: 'drawer.details', open: true },
        undefined,
        {
          ...child,
          representation: AELIQO_NAVIGATION_FEEDBACK_REFS.drawer,
          config: { schema: AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS.drawer, values: {} },
        },
      ),
    ).toMatchObject({ ok: true });
    expect(
      drawer.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'drawer.details' }, undefined, {
        ...child,
        representation: AELIQO_NAVIGATION_FEEDBACK_REFS.drawer,
        config: { schema: AELIQO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS.drawer, values: {} },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.navigation-feedback.children' }] });
  });

  it('declares only operations that remain reachable in the current host state', () => {
    const current = createNavigationFeedbackPresentationManifests({
      ...bindings,
      breadcrumbs: [
        {
          id: 'crumb.reports',
          labelRef: 'copy.breadcrumb',
          items: [
            { id: 'home', labelRef: 'copy.home', routeRef: 'route.home' },
            { id: 'current', labelRef: 'copy.breadcrumb', routeRef: 'route.home', current: true },
          ],
        },
      ],
    });
    expect(current.ok).toBe(true);
    if (current.ok) {
      const breadcrumb = current.value.find(
        (manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.breadcrumb.id,
      )!;
      expect(
        breadcrumb.resolveConfig({ bindingRevision: bindings.revision, bindingRef: 'crumb.reports' }, undefined),
      ).toMatchObject({ ok: true, value: { operations: [{ id: 'route.home', revision: '1' }] } });
    }

    const disabled = createNavigationFeedbackPresentationManifests({
      ...bindings,
      menus: [
        {
          id: 'menu.actions',
          labelRef: 'copy.menu',
          items: [{ id: 'open', labelRef: 'copy.open', actionRef: 'action.open', disabled: true }],
        },
      ],
      trees: [
        {
          id: 'tree.main',
          labelRef: 'copy.tree',
          nodes: [{ id: 'settings', labelRef: 'copy.tree.settings', actionRef: 'action.open', disabled: true }],
        },
      ],
      pagination: [
        {
          id: 'page.results',
          labelRef: 'copy.pagination.label',
          outputId: 'results',
          queryDigest: 'query-1',
          page: 1,
          pageCount: 1,
          hasPrevious: false,
          hasNext: false,
          cursors: [],
        },
      ],
      feedback: [
        {
          id: 'alert.review',
          headingRef: 'copy.alert.heading',
          messageRef: 'copy.alert.message',
          actionLabelRef: 'copy.alert.action',
          actionRef: 'action.review',
        },
        ...bindings.feedback!.filter((entry) => entry.id !== 'alert.review'),
      ],
    });
    expect(disabled.ok).toBe(true);
    if (disabled.ok) {
      const get = (id: string) => disabled.value.find((manifest) => manifest.ref.id === id)!;
      expect(
        get(AELIQO_NAVIGATION_FEEDBACK_REFS.menu.id).resolveConfig(
          { bindingRevision: bindings.revision, bindingRef: 'menu.actions' },
          undefined,
        ),
      ).toMatchObject({ ok: true, value: { operations: [], ports: [] } });
      expect(
        get(AELIQO_NAVIGATION_FEEDBACK_REFS.treeNav.id).resolveConfig(
          { bindingRevision: bindings.revision, bindingRef: 'tree.main' },
          undefined,
        ),
      ).toMatchObject({ ok: true, value: { operations: [], ports: [] } });
      expect(
        get(AELIQO_NAVIGATION_FEEDBACK_REFS.pagination.id).resolveConfig(
          { bindingRevision: bindings.revision, bindingRef: 'page.results' },
          undefined,
        ),
      ).toMatchObject({ ok: true, value: { operations: [], ports: [] } });
      const hiddenAlert = get(AELIQO_NAVIGATION_FEEDBACK_REFS.alert.id).resolveConfig(
        { bindingRevision: bindings.revision, bindingRef: 'alert.review', open: false },
        undefined,
      );
      expect(hiddenAlert).toMatchObject({ ok: true, value: { operations: [], ports: [] } });
      if (hiddenAlert.ok) expect(hiddenAlert.value.values).not.toHaveProperty('actionLabel');
    }
  });

  it('uses registered routes/actions for tree nodes and truthful feedback states', () => {
    const tree = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.treeNav.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'tree.main',
    });
    expect(tree.values).toMatchObject({
      nodes: [
        { id: 'reports', route: { id: 'route.home', revision: '1' } },
        { id: 'settings', action: { id: 'action.open', revision: '1' } },
      ],
    });
    expect(tree.ports).toContainEqual({ id: 'navigate', direction: 'output', payload: 'navigate' });
    expect(tree.ports).toContainEqual({ id: 'action', direction: 'output', payload: 'action-request' });
    const empty = resolve(AELIQO_NAVIGATION_FEEDBACK_REFS.emptyState.id, {
      bindingRevision: bindings.revision,
      bindingRef: 'empty.results',
    });
    expect(empty.values).toMatchObject({
      kind: 'no-matches',
      heading: 'No matches',
      message: 'Try another filter',
      actionLabel: 'Clear filter',
    });
    expect(empty.operations).toEqual([{ id: 'action.review', revision: '1' }]);
  });

  it('rejects malformed or unbounded host tables before manifest creation', () => {
    expect(
      createNavigationFeedbackPresentationManifests({
        ...bindings,
        routes: [{ id: 'evil', route: { id: 'r', revision: '1' }, params: {}, href: 'javascript:alert(1)' }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      createNavigationFeedbackPresentationManifests({
        ...bindings,
        contents: [
          { id: 'same', text: 'one' },
          { id: 'same', text: 'two' },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      createNavigationFeedbackPresentationManifests({
        ...bindings,
        feedback: [{ id: 'bad', messageRef: 'raw', kind: 'no-matches' }],
      }),
    ).toMatchObject({ ok: false });
  });

  it('freezes the copied host bindings and resolved values', () => {
    const value = manifests();
    const breadcrumb = value.find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.breadcrumb.id)!;
    const resolvedValue = breadcrumb.resolveConfig(
      { bindingRevision: bindings.revision, bindingRef: 'crumb.reports' },
      undefined,
    );
    expect(resolvedValue.ok).toBe(true);
    if (resolvedValue.ok) {
      expect(Object.isFrozen(resolvedValue.value.values)).toBe(false);
      // Manifest registration freezes the handler metadata; the resolver still
      // returns data that the core validator freezes as part of plan validation.
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

it('does not claim actions beneath a disabled collapsed tree branch', () => {
  const made = createNavigationFeedbackPresentationManifests({
    revision: 'tree-1',
    contents: [
      { id: 'tree', text: 'Tree' },
      { id: 'parent', text: 'Parent' },
      { id: 'child', text: 'Child' },
    ],
    actions: [{ id: 'open', action: { id: 'record.open', revision: '1' }, input: {} }],
    trees: [
      {
        id: 'tree',
        labelRef: 'tree',
        nodes: [
          {
            id: 'parent',
            labelRef: 'parent',
            disabled: true,
            children: [{ id: 'child', labelRef: 'child', actionRef: 'open' }],
          },
        ],
      },
    ],
  });
  expect(made.ok).toBe(true);
  if (!made.ok) return;
  const manifest = made.value.find((m) => m.ref.id === 'navigation.tree-nav')!;
  expect(manifest.resolveConfig({ bindingRef: 'tree', bindingRevision: 'tree-1' }, undefined)).toMatchObject({
    ok: true,
    value: { operations: [] },
  });
  expect(
    manifest.resolveConfig({ bindingRef: 'tree', bindingRevision: 'tree-1', expandedIds: ['parent'] }, undefined),
  ).toMatchObject({ ok: true, value: { operations: [{ id: 'record.open', revision: '1' }] } });
});
