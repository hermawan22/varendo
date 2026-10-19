import { VarendoAlertElement } from '../../packages/web/src/feedback/alert.js';
import { VarendoDialogElement } from '../../packages/web/src/feedback/dialog.js';
import { VarendoDrawerElement } from '../../packages/web/src/feedback/drawer.js';
import { VarendoPopoverElement } from '../../packages/web/src/feedback/popover.js';
import { VarendoProgressElement } from '../../packages/web/src/feedback/progress.js';
import { VarendoEmptyStateElement } from '../../packages/web/src/feedback/empty-state.js';
import { VarendoSkeletonElement } from '../../packages/web/src/feedback/skeleton.js';
import { VarendoToastElement } from '../../packages/web/src/feedback/toast.js';
import { VarendoTooltipElement } from '../../packages/web/src/feedback/tooltip.js';

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
  <varendo-tooltip id="tooltip" label="Help" content="Helpful context"></varendo-tooltip>
  <varendo-popover id="popover" label="Details" content="Popover context"></varendo-popover>
  <varendo-dialog id="dialog" heading="Confirm details"><button id="dialog-action" type="button">Continue</button></varendo-dialog>
  <varendo-dialog id="focus-dialog" heading="Focus details"><button id="real" type="button">Real</button><button id="hidden" type="button" hidden>Hidden</button></varendo-dialog>
  <varendo-dialog id="nested-dialog" heading="Nested details"><feedback-nested-control id="nested-control-host"></feedback-nested-control></varendo-dialog>
  <varendo-drawer id="drawer" heading="More details"><p>Drawer content</p><button id="drawer-action" type="button">Drawer action</button></varendo-drawer>
  <varendo-toast id="toast" message="Saved" duration="60"></varendo-toast>
  <varendo-alert id="alert" heading="Notice" message="Review this item" tone="warning" action-label="Review" dismissible></varendo-alert>
  <varendo-progress id="determinate" label="Upload" value="120" max="100"></varendo-progress>
  <varendo-progress id="indeterminate" label="Loading"></varendo-progress>
  <varendo-skeleton id="skeleton" label="Loading records" lines="3"></varendo-skeleton>
  <varendo-empty-state id="empty" kind="no-matches" heading="No matches" message="Try another filter" action-label="Clear filter"></varendo-empty-state>
  <button id="after">After</button>`;

const popover = document.querySelector<VarendoPopoverElement>('#popover')!;
popover.innerHTML = '<button id="popover-action" type="button">Popover action</button>';
popover.content = '';

const events: CustomEvent[] = [];
for (const type of [
  'varendo-popover-close',
  'varendo-dialog-close',
  'varendo-drawer-close',
  'varendo-toast-dismiss',
  'varendo-alert-dismiss',
  'varendo-alert-action',
  'varendo-empty-state-action',
]) {
  fixture.addEventListener(type, (event) => events.push(event as CustomEvent));
}
Object.assign(window, { varendoFeedbackReady: true, varendoFeedbackEvents: events });
