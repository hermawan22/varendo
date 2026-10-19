import React from 'react';
import { createComponent, type EventName } from '@lit/react';
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
} from '@varendo/web/feedback';
type UserEvent<T> = CustomEvent<Readonly<T & { source: 'user' }>>;
export const VarendoDialog = createComponent({
  react: React,
  tagName: 'varendo-dialog',
  elementClass: VarendoDialogElement,
  events: { onClose: 'varendo-dialog-close' as EventName<UserEvent<{}>> },
  displayName: 'VarendoDialog',
});
export const VarendoDrawer = createComponent({
  react: React,
  tagName: 'varendo-drawer',
  elementClass: VarendoDrawerElement,
  events: { onClose: 'varendo-drawer-close' as EventName<UserEvent<{}>> },
  displayName: 'VarendoDrawer',
});
export const VarendoPopover = createComponent({
  react: React,
  tagName: 'varendo-popover',
  elementClass: VarendoPopoverElement,
  events: { onClose: 'varendo-popover-close' as EventName<UserEvent<{}>> },
  displayName: 'VarendoPopover',
});
export const VarendoTooltip = createComponent({
  react: React,
  tagName: 'varendo-tooltip',
  elementClass: VarendoTooltipElement,
  events: {},
  displayName: 'VarendoTooltip',
});
export const VarendoAlert = createComponent({
  react: React,
  tagName: 'varendo-alert',
  elementClass: VarendoAlertElement,
  events: {
    onDismiss: 'varendo-alert-dismiss' as EventName<UserEvent<{}>>,
    onAction: 'varendo-alert-action' as EventName<UserEvent<{}>>,
  },
  displayName: 'VarendoAlert',
});
export const VarendoToast = createComponent({
  react: React,
  tagName: 'varendo-toast',
  elementClass: VarendoToastElement,
  events: { onDismiss: 'varendo-toast-dismiss' as EventName<UserEvent<{}>> },
  displayName: 'VarendoToast',
});
export const VarendoProgress = createComponent({
  react: React,
  tagName: 'varendo-progress',
  elementClass: VarendoProgressElement,
  events: {},
  displayName: 'VarendoProgress',
});
export const VarendoSkeleton = createComponent({
  react: React,
  tagName: 'varendo-skeleton',
  elementClass: VarendoSkeletonElement,
  events: {},
  displayName: 'VarendoSkeleton',
});
export const VarendoEmptyState = createComponent({
  react: React,
  tagName: 'varendo-empty-state',
  elementClass: VarendoEmptyStateElement,
  events: {
    onAction: 'varendo-empty-state-action' as EventName<
      UserEvent<{ kind: import('@varendo/web/feedback').VarendoEmptyStateKind }>
    >,
  },
  displayName: 'VarendoEmptyState',
});
