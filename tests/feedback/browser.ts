import { AeliqoAlertElement } from '../../packages/web/src/feedback/alert.js';
import { AeliqoDialogElement } from '../../packages/web/src/feedback/dialog.js';
import { AeliqoDrawerElement } from '../../packages/web/src/feedback/drawer.js';
import { AeliqoPopoverElement } from '../../packages/web/src/feedback/popover.js';
import { AeliqoProgressElement } from '../../packages/web/src/feedback/progress.js';
import { AeliqoEmptyStateElement } from '../../packages/web/src/feedback/empty-state.js';
import { AeliqoSkeletonElement } from '../../packages/web/src/feedback/skeleton.js';
import { AeliqoToastElement } from '../../packages/web/src/feedback/toast.js';
import { AeliqoTooltipElement } from '../../packages/web/src/feedback/tooltip.js';

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
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

class FeedbackNestedControlElement extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="nested-control" type="button">Nested control</button>';
  }
}
customElements.define('feedback-nested-control', FeedbackNestedControlElement);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Feedback fixture root is missing.');
fixture.innerHTML = `
  <button id="before">Before</button>
  <aeliqo-tooltip id="tooltip" label="Help" content="Helpful context"></aeliqo-tooltip>
  <aeliqo-popover id="popover" label="Details" content="Popover context"></aeliqo-popover>
  <aeliqo-dialog id="dialog" heading="Confirm details"><button id="dialog-action" type="button">Continue</button></aeliqo-dialog>
  <aeliqo-dialog id="focus-dialog" heading="Focus details"><button id="real" type="button">Real</button><button id="hidden" type="button" hidden>Hidden</button></aeliqo-dialog>
  <aeliqo-dialog id="nested-dialog" heading="Nested details"><feedback-nested-control id="nested-control-host"></feedback-nested-control></aeliqo-dialog>
  <aeliqo-drawer id="drawer" heading="More details"><p>Drawer content</p><button id="drawer-action" type="button">Drawer action</button></aeliqo-drawer>
  <aeliqo-toast id="toast" message="Saved" duration="60"></aeliqo-toast>
  <aeliqo-alert id="alert" heading="Notice" message="Review this item" tone="warning" action-label="Review" dismissible></aeliqo-alert>
  <aeliqo-progress id="determinate" label="Upload" value="120" max="100"></aeliqo-progress>
  <aeliqo-progress id="indeterminate" label="Loading"></aeliqo-progress>
  <aeliqo-skeleton id="skeleton" label="Loading records" lines="3"></aeliqo-skeleton>
  <aeliqo-empty-state id="empty" kind="no-matches" heading="No matches" message="Try another filter" action-label="Clear filter"></aeliqo-empty-state>
  <button id="after">After</button>`;

const popover = document.querySelector<AeliqoPopoverElement>('#popover')!;
popover.innerHTML = '<button id="popover-action" type="button">Popover action</button>';
popover.content = '';

const events: CustomEvent[] = [];
for (const type of [
  'aeliqo-popover-close',
  'aeliqo-dialog-close',
  'aeliqo-drawer-close',
  'aeliqo-toast-dismiss',
  'aeliqo-alert-dismiss',
  'aeliqo-alert-action',
  'aeliqo-empty-state-action',
]) {
  fixture.addEventListener(type, (event) => events.push(event as CustomEvent));
}
Object.assign(window, { aeliqoFeedbackReady: true, aeliqoFeedbackEvents: events });
