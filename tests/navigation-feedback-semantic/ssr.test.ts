import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import { renderVarendo } from '../../packages/web/src/server.js';
import { VarendoAlertElement } from '../../packages/web/src/feedback/alert.js';
import { VarendoDialogElement } from '../../packages/web/src/feedback/dialog.js';
import { VarendoDrawerElement } from '../../packages/web/src/feedback/drawer.js';
import { VarendoEmptyStateElement } from '../../packages/web/src/feedback/empty-state.js';
import { VarendoPopoverElement } from '../../packages/web/src/feedback/popover.js';
import { VarendoProgressElement } from '../../packages/web/src/feedback/progress.js';
import { VarendoSkeletonElement } from '../../packages/web/src/feedback/skeleton.js';
import { VarendoToastElement } from '../../packages/web/src/feedback/toast.js';
import { VarendoTooltipElement } from '../../packages/web/src/feedback/tooltip.js';
import { VarendoBreadcrumbElement } from '../../packages/web/src/navigation/breadcrumb.js';
import { VarendoMenuElement } from '../../packages/web/src/navigation/menu.js';
import { VarendoPaginationElement } from '../../packages/web/src/navigation/pagination.js';
import { VarendoTabsElement } from '../../packages/web/src/navigation/tabs.js';
import { VarendoTreeNavElement } from '../../packages/web/src/navigation/tree-nav.js';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import {
  navigationFeedbackPresentationContext,
  navigationFeedbackPresentationPlan,
  navigationFeedbackRegistry,
} from './fixtures.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['varendo-alert', VarendoAlertElement],
  ['varendo-dialog', VarendoDialogElement],
  ['varendo-drawer', VarendoDrawerElement],
  ['varendo-empty-state', VarendoEmptyStateElement],
  ['varendo-popover', VarendoPopoverElement],
  ['varendo-progress', VarendoProgressElement],
  ['varendo-skeleton', VarendoSkeletonElement],
  ['varendo-toast', VarendoToastElement],
  ['varendo-tooltip', VarendoTooltipElement],
  ['varendo-breadcrumb', VarendoBreadcrumbElement],
  ['varendo-menu', VarendoMenuElement],
  ['varendo-pagination', VarendoPaginationElement],
  ['varendo-tabs', VarendoTabsElement],
  ['varendo-tree-nav', VarendoTreeNavElement],
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
      renderVarendo(html`<varendo-region .presentation=${first}></varendo-region>`),
      renderVarendo(html`<varendo-region .presentation=${second}></varendo-region>`),
    ]);
    expect(firstMarkup).toContain('varendo-breadcrumb');
    expect(firstMarkup).toContain('Home');
    expect(secondMarkup).toContain('varendo-menu');
    expect(secondMarkup).toContain('Actions');
    expect(firstMarkup).toMatch(/aria-selected="true"[^>]*aria-controls="[^"]*breadcrumb/);
    expect(secondMarkup).toMatch(/aria-selected="true"[^>]*aria-controls="[^"]*menu/);
    expect(firstMarkup).toContain('shadowrootmode="open"');
    expect(secondMarkup).toContain('shadowrootmode="open"');
    expect(firstMarkup).toContain('varendo-dialog');
    expect(secondMarkup).toContain('varendo-dialog');
  });
});
