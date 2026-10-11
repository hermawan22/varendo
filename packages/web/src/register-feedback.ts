import {
  AeliqoDialogElement,
  AeliqoDrawerElement,
  AeliqoPopoverElement,
  AeliqoTooltipElement,
  AeliqoAlertElement,
  AeliqoToastElement,
  AeliqoProgressElement,
  AeliqoSkeletonElement,
  AeliqoEmptyStateElement,
} from './feedback/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-dialog', constructor: AeliqoDialogElement },
  { name: 'aeliqo-drawer', constructor: AeliqoDrawerElement },
  { name: 'aeliqo-popover', constructor: AeliqoPopoverElement },
  { name: 'aeliqo-tooltip', constructor: AeliqoTooltipElement },
  { name: 'aeliqo-alert', constructor: AeliqoAlertElement },
  { name: 'aeliqo-toast', constructor: AeliqoToastElement },
  { name: 'aeliqo-progress', constructor: AeliqoProgressElement },
  { name: 'aeliqo-skeleton', constructor: AeliqoSkeletonElement },
  { name: 'aeliqo-empty-state', constructor: AeliqoEmptyStateElement },
];
