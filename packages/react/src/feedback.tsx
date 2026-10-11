import React from 'react';
import { createComponent, type EventName } from '@lit/react';
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
} from '@varendo/web/feedback';
type UserEvent<T> = CustomEvent<Readonly<T & { source: 'user' }>>;
export const AeliqoDialog = createComponent({
  react: React,
  tagName: 'aeliqo-dialog',
  elementClass: AeliqoDialogElement,
  events: { onClose: 'aeliqo-dialog-close' as EventName<UserEvent<{}>> },
  displayName: 'AeliqoDialog',
});
export const AeliqoDrawer = createComponent({
  react: React,
  tagName: 'aeliqo-drawer',
  elementClass: AeliqoDrawerElement,
  events: { onClose: 'aeliqo-drawer-close' as EventName<UserEvent<{}>> },
  displayName: 'AeliqoDrawer',
});
export const AeliqoPopover = createComponent({
  react: React,
  tagName: 'aeliqo-popover',
  elementClass: AeliqoPopoverElement,
  events: { onClose: 'aeliqo-popover-close' as EventName<UserEvent<{}>> },
  displayName: 'AeliqoPopover',
});
export const AeliqoTooltip = createComponent({
  react: React,
  tagName: 'aeliqo-tooltip',
  elementClass: AeliqoTooltipElement,
  events: {},
  displayName: 'AeliqoTooltip',
});
export const AeliqoAlert = createComponent({
  react: React,
  tagName: 'aeliqo-alert',
  elementClass: AeliqoAlertElement,
  events: {
    onDismiss: 'aeliqo-alert-dismiss' as EventName<UserEvent<{}>>,
    onAction: 'aeliqo-alert-action' as EventName<UserEvent<{}>>,
  },
  displayName: 'AeliqoAlert',
});
export const AeliqoToast = createComponent({
  react: React,
  tagName: 'aeliqo-toast',
  elementClass: AeliqoToastElement,
  events: { onDismiss: 'aeliqo-toast-dismiss' as EventName<UserEvent<{}>> },
  displayName: 'AeliqoToast',
});
export const AeliqoProgress = createComponent({
  react: React,
  tagName: 'aeliqo-progress',
  elementClass: AeliqoProgressElement,
  events: {},
  displayName: 'AeliqoProgress',
});
export const AeliqoSkeleton = createComponent({
  react: React,
  tagName: 'aeliqo-skeleton',
  elementClass: AeliqoSkeletonElement,
  events: {},
  displayName: 'AeliqoSkeleton',
});
export const AeliqoEmptyState = createComponent({
  react: React,
  tagName: 'aeliqo-empty-state',
  elementClass: AeliqoEmptyStateElement,
  events: {
    onAction: 'aeliqo-empty-state-action' as EventName<
      UserEvent<{ kind: import('@varendo/web/feedback').AeliqoEmptyStateKind }>
    >,
  },
  displayName: 'AeliqoEmptyState',
});
