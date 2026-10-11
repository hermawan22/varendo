import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import { renderAeliqo } from '../../packages/web/src/server.js';
import { AeliqoAlertElement } from '../../packages/web/src/feedback/alert.js';
import { AeliqoDialogElement } from '../../packages/web/src/feedback/dialog.js';
import { AeliqoDrawerElement } from '../../packages/web/src/feedback/drawer.js';
import { AeliqoEmptyStateElement } from '../../packages/web/src/feedback/empty-state.js';
import { AeliqoPopoverElement } from '../../packages/web/src/feedback/popover.js';
import { AeliqoProgressElement } from '../../packages/web/src/feedback/progress.js';
import { AeliqoSkeletonElement } from '../../packages/web/src/feedback/skeleton.js';
import { AeliqoToastElement } from '../../packages/web/src/feedback/toast.js';
import { AeliqoTooltipElement } from '../../packages/web/src/feedback/tooltip.js';
import { AeliqoBreadcrumbElement } from '../../packages/web/src/navigation/breadcrumb.js';
import { AeliqoMenuElement } from '../../packages/web/src/navigation/menu.js';
import { AeliqoPaginationElement } from '../../packages/web/src/navigation/pagination.js';
import { AeliqoTabsElement } from '../../packages/web/src/navigation/tabs.js';
import { AeliqoTreeNavElement } from '../../packages/web/src/navigation/tree-nav.js';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import {
  navigationFeedbackPresentationContext,
  navigationFeedbackPresentationPlan,
  navigationFeedbackRegistry,
} from './fixtures.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['aeliqo-alert', AeliqoAlertElement],
  ['aeliqo-dialog', AeliqoDialogElement],
  ['aeliqo-drawer', AeliqoDrawerElement],
  ['aeliqo-empty-state', AeliqoEmptyStateElement],
  ['aeliqo-popover', AeliqoPopoverElement],
  ['aeliqo-progress', AeliqoProgressElement],
  ['aeliqo-skeleton', AeliqoSkeletonElement],
  ['aeliqo-toast', AeliqoToastElement],
  ['aeliqo-tooltip', AeliqoTooltipElement],
  ['aeliqo-breadcrumb', AeliqoBreadcrumbElement],
  ['aeliqo-menu', AeliqoMenuElement],
  ['aeliqo-pagination', AeliqoPaginationElement],
  ['aeliqo-tabs', AeliqoTabsElement],
  ['aeliqo-tree-nav', AeliqoTreeNavElement],
];

function checkedPresentation(value = navigationFeedbackPresentationPlan()) {
  const registry = createPresentationRegistry(navigationFeedbackRegistry());
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  const checked = validatePresentationPlan(value, navigationFeedbackPresentationContext(), registry.value);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  return checked.value;
}

describe('navigation and feedback region SSR', () => {
  it('keeps all owned custom elements registered and request state isolated', async () => {
    for (const [name, constructor] of registrations) {
      if (globalThis.customElements.get(name) === undefined) globalThis.customElements.define(name, constructor);
    }
    const first = checkedPresentation();
    const secondBase = navigationFeedbackPresentationPlan();
    const tabs = secondBase.nodes.find((node) => node.id === 'tabs-root')!;
    const secondPlan = {
      ...secondBase,
      nodes: secondBase.nodes.map((node) =>
        node.id === tabs.id
          ? { ...node, config: { ...node.config, values: { ...node.config.values, defaultValue: 'menu' } } }
          : node,
      ),
    };
    const second = checkedPresentation(secondPlan);
    const [firstMarkup, secondMarkup] = await Promise.all([
      renderAeliqo(html`<aeliqo-region .presentation=${first}></aeliqo-region>`),
      renderAeliqo(html`<aeliqo-region .presentation=${second}></aeliqo-region>`),
    ]);
    expect(firstMarkup).toContain('aeliqo-breadcrumb');
    expect(firstMarkup).toContain('Home');
    expect(secondMarkup).toContain('aeliqo-menu');
    expect(secondMarkup).toContain('Actions');
    expect(firstMarkup).toMatch(/aria-selected="true"[^>]*aria-controls="[^"]*breadcrumb/);
    expect(secondMarkup).toMatch(/aria-selected="true"[^>]*aria-controls="[^"]*menu/);
    expect(firstMarkup).toContain('shadowrootmode="open"');
    expect(secondMarkup).toContain('shadowrootmode="open"');
    expect(firstMarkup).toContain('aeliqo-dialog');
    expect(secondMarkup).toContain('aeliqo-dialog');
  });
});
