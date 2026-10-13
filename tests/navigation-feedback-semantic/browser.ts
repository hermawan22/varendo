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
import { VarendoRegionElement } from '../../packages/web/src/region/varendo-region.js';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import type { VarendoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
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
  ['varendo-region', VarendoRegionElement],
];
for (const [name, constructor] of registrations)
  if (customElements.get(name) === undefined) customElements.define(name, constructor);

const registry = createPresentationRegistry(navigationFeedbackRegistry());
if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
const checked = validatePresentationPlan(
  navigationFeedbackPresentationPlan(),
  navigationFeedbackPresentationContext(),
  registry.value,
);
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
const region = document.querySelector<VarendoRegionElement>('#region');
if (region === null) throw new Error('Semantic region fixture is missing.');
const events: VarendoSemanticInteractionRequest[] = [];
region.onSemanticInteraction = (request) => events.push(request);
region.presentation = checked.value;
Object.assign(window, {
  varendoNavigationFeedbackSemanticReady: true,
  varendoNavigationFeedbackSemanticEvents: events,
});
Object.assign(window, {
  reorderSemanticPopover: () => {
    const original = navigationFeedbackPresentationPlan();
    const plan = {
      ...original,
      nodes: original.nodes.map((node) =>
        node.id === 'tabs-root'
          ? {
              ...node,
              children: node.children.map((id) => (id === 'popover' ? 'tooltip' : id === 'tooltip' ? 'popover' : id)),
              config: { ...node.config, values: { ...node.config.values, value: 'tooltip' } },
            }
          : node,
      ),
    };
    const next = validatePresentationPlan(plan, navigationFeedbackPresentationContext(), registry.value);
    if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
    region.presentation = next.value;
  },
});
