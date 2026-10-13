import {
  VarendoDialogElement,
  VarendoDrawerElement,
  VarendoPopoverElement,
  VarendoTooltipElement,
  VarendoAlertElement,
  VarendoToastElement,
  VarendoProgressElement,
  VarendoSkeletonElement,
  VarendoEmptyStateElement,
} from './feedback/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-dialog', constructor: VarendoDialogElement },
  { name: 'varendo-drawer', constructor: VarendoDrawerElement },
  { name: 'varendo-popover', constructor: VarendoPopoverElement },
  { name: 'varendo-tooltip', constructor: VarendoTooltipElement },
  { name: 'varendo-alert', constructor: VarendoAlertElement },
  { name: 'varendo-toast', constructor: VarendoToastElement },
  { name: 'varendo-progress', constructor: VarendoProgressElement },
  { name: 'varendo-skeleton', constructor: VarendoSkeletonElement },
  { name: 'varendo-empty-state', constructor: VarendoEmptyStateElement },
];
