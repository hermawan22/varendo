import { describe, expect, it } from 'vitest';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import {
  AELIQO_NAVIGATION_FEEDBACK_REFS,
  createNavigationFeedbackPresentationManifests,
} from '../../packages/web/src/region/navigation-feedback-registry.js';
import {
  navigationFeedbackBindings,
  navigationFeedbackPresentationContext,
  navigationFeedbackPresentationPlan,
  navigationFeedbackRegistry,
} from './fixtures.js';

describe('canonical navigation and feedback presentation', () => {
  it('validates one tree containing all fourteen registered families', () => {
    const manifests = navigationFeedbackRegistry();
    const registry = createPresentationRegistry(manifests);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const checked = validatePresentationPlan(
      navigationFeedbackPresentationPlan(),
      navigationFeedbackPresentationContext(),
      registry.value,
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    expect(checked.value.nodes).toHaveLength(14);
    expect(new Set(checked.value.nodes.map((node) => node.manifest.id))).toEqual(
      new Set([
        'navigation.tabs',
        'navigation.breadcrumb',
        'navigation.pagination',
        'navigation.menu',
        'navigation.tree-nav',
        'feedback.tooltip',
        'feedback.popover',
        'feedback.dialog',
        'feedback.drawer',
        'feedback.toast',
        'feedback.alert',
        'feedback.progress',
        'feedback.skeleton',
        'feedback.empty-state',
      ]),
    );
    expect(checked.value.nodes.find((node) => node.node.id === 'tabs-root')?.node.children).toHaveLength(12);
    expect(checked.value.nodes.find((node) => node.node.id === 'dialog-root')?.config.values).toMatchObject({
      open: true,
      modal: false,
    });
  });

  it('rejects a tabs graph whose canonical child list cannot be represented by its host items', () => {
    const manifests = navigationFeedbackRegistry();
    const registry = createPresentationRegistry(manifests);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const plan = navigationFeedbackPresentationPlan();
    const extra = { ...plan.nodes.find((node) => node.id === 'empty')!, id: 'empty-extra' };
    const tabs = plan.nodes.find((node) => node.id === 'tabs-root')!;
    const checked = validatePresentationPlan(
      {
        ...plan,
        nodes: [...plan.nodes, extra].map((node) =>
          node.id === 'tabs-root' ? { ...node, children: [...node.children, 'empty-extra'] } : node,
        ),
      },
      navigationFeedbackPresentationContext(),
      registry.value,
    );
    expect(checked).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.configuration' }] });
    expect(tabs.children).toHaveLength(12);
  });

  it('rejects coverage that claims an operation with no reachable enabled control', () => {
    const manifests = createNavigationFeedbackPresentationManifests({
      ...navigationFeedbackBindings,
      menus: [
        {
          id: 'menu.actions',
          labelRef: 'menu.label',
          items: [{ id: 'open', labelRef: 'menu.open', actionRef: 'action.open', disabled: true }],
        },
      ],
    });
    expect(manifests.ok).toBe(true);
    if (!manifests.ok) return;
    const registry = createPresentationRegistry(manifests.value);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const plan = navigationFeedbackPresentationPlan();
    const context = navigationFeedbackPresentationContext();
    const action = { id: 'action.open', revision: '1' } as const;
    const checked = validatePresentationPlan(
      { ...plan, coverage: [{ needId: 'open', nodeIds: ['menu'], operations: [action] }] },
      {
        ...context,
        task: { ...context.task, needs: [{ id: 'open', operation: action, fields: [], required: true }] },
      },
      registry.value,
    );
    expect(checked).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.coverage' }] });
    expect(
      registry.value.manifests.find((manifest) => manifest.ref.id === AELIQO_NAVIGATION_FEEDBACK_REFS.menu.id),
    ).toBeDefined();
  });
});

it('uses the public shared registry without duplicate representations', async () => {
  const { createAeliqoPresentationRegistry } = await import('../../packages/web/src/region/registry.js');
  const { navigationFeedbackBindings, navigationFeedbackPresentationPlan, navigationFeedbackPresentationContext } =
    await import('./fixtures.js');
  const registry = createAeliqoPresentationRegistry({ navigationFeedback: navigationFeedbackBindings });
  expect(registry.ok).toBe(true);
  if (!registry.ok) return;
  expect(new Set(registry.value.manifests.map((m) => m.ref.id)).size).toBe(registry.value.manifests.length);
  expect(
    validatePresentationPlan(
      navigationFeedbackPresentationPlan(),
      navigationFeedbackPresentationContext(),
      registry.value,
    ).ok,
  ).toBe(true);
});
