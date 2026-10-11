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
import { AeliqoRegionElement } from '../../packages/web/src/region/aeliqo-region.js';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import type { AeliqoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
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
  ['aeliqo-region', AeliqoRegionElement],
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
const region = document.querySelector<AeliqoRegionElement>('#region');
if (region === null) throw new Error('Semantic region fixture is missing.');
const events: AeliqoSemanticInteractionRequest[] = [];
region.onSemanticInteraction = (request) => events.push(request);
region.presentation = checked.value;
Object.assign(window, { aeliqoNavigationFeedbackSemanticReady: true, aeliqoNavigationFeedbackSemanticEvents: events });
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
