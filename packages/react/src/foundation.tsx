import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoButtonElement,
  AeliqoIconButtonElement,
  AeliqoLinkElement,
  AeliqoTextElement,
  AeliqoHeadingElement,
  AeliqoBadgeElement,
  AeliqoAvatarElement,
  AeliqoSeparatorElement,
  AeliqoSurfaceElement,
  AeliqoStackElement,
  AeliqoGridElement,
  AeliqoSplitPaneElement,
  AeliqoScrollAreaElement,
  type AeliqoActionEvent,
  type AeliqoLinkEvent,
  type AeliqoSplitChangeEvent,
} from '@varendo/web/foundation';

export const AeliqoButton = createComponent({
  react: React,
  tagName: 'aeliqo-button',
  elementClass: AeliqoButtonElement,
  events: { onAeliqoAction: 'aeliqo-action' as EventName<AeliqoActionEvent> },
  displayName: 'AeliqoButton',
});
export const AeliqoIconButton = createComponent({
  react: React,
  tagName: 'aeliqo-icon-button',
  elementClass: AeliqoIconButtonElement,
  events: { onAeliqoAction: 'aeliqo-action' as EventName<AeliqoActionEvent> },
  displayName: 'AeliqoIconButton',
});
export const AeliqoLink = createComponent({
  react: React,
  tagName: 'aeliqo-link',
  elementClass: AeliqoLinkElement,
  events: { onAeliqoLink: 'aeliqo-link' as EventName<AeliqoLinkEvent> },
  displayName: 'AeliqoLink',
});
export const AeliqoText = createComponent({
  react: React,
  tagName: 'aeliqo-text',
  elementClass: AeliqoTextElement,
  displayName: 'AeliqoText',
});
export const AeliqoHeading = createComponent({
  react: React,
  tagName: 'aeliqo-heading',
  elementClass: AeliqoHeadingElement,
  displayName: 'AeliqoHeading',
});
export const AeliqoBadge = createComponent({
  react: React,
  tagName: 'aeliqo-badge',
  elementClass: AeliqoBadgeElement,
  displayName: 'AeliqoBadge',
});
export const AeliqoAvatar = createComponent({
  react: React,
  tagName: 'aeliqo-avatar',
  elementClass: AeliqoAvatarElement,
  displayName: 'AeliqoAvatar',
});
export const AeliqoSeparator = createComponent({
  react: React,
  tagName: 'aeliqo-separator',
  elementClass: AeliqoSeparatorElement,
  displayName: 'AeliqoSeparator',
});
export const AeliqoSurface = createComponent({
  react: React,
  tagName: 'aeliqo-surface',
  elementClass: AeliqoSurfaceElement,
  displayName: 'AeliqoSurface',
});
export const AeliqoStack = createComponent({
  react: React,
  tagName: 'aeliqo-stack',
  elementClass: AeliqoStackElement,
  displayName: 'AeliqoStack',
});
export const AeliqoGrid = createComponent({
  react: React,
  tagName: 'aeliqo-grid',
  elementClass: AeliqoGridElement,
  displayName: 'AeliqoGrid',
});
export const AeliqoSplitPane = createComponent({
  react: React,
  tagName: 'aeliqo-split-pane',
  elementClass: AeliqoSplitPaneElement,
  events: { onAeliqoSplitChange: 'aeliqo-split-change' as EventName<AeliqoSplitChangeEvent> },
  displayName: 'AeliqoSplitPane',
});
export const AeliqoScrollArea = createComponent({
  react: React,
  tagName: 'aeliqo-scroll-area',
  elementClass: AeliqoScrollAreaElement,
  displayName: 'AeliqoScrollArea',
});
