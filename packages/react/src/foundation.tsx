import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoButtonElement,
  VarendoIconButtonElement,
  VarendoLinkElement,
  VarendoTextElement,
  VarendoHeadingElement,
  VarendoBadgeElement,
  VarendoAvatarElement,
  VarendoSeparatorElement,
  VarendoSurfaceElement,
  VarendoStackElement,
  VarendoGridElement,
  VarendoSplitPaneElement,
  VarendoScrollAreaElement,
  type VarendoActionEvent,
  type VarendoLinkEvent,
  type VarendoSplitChangeEvent,
} from '@varendo/web/foundation';

export const VarendoButton = createComponent({
  react: React,
  tagName: 'varendo-button',
  elementClass: VarendoButtonElement,
  events: { onVarendoAction: 'varendo-action' as EventName<VarendoActionEvent> },
  displayName: 'VarendoButton',
});
export const VarendoIconButton = createComponent({
  react: React,
  tagName: 'varendo-icon-button',
  elementClass: VarendoIconButtonElement,
  events: { onVarendoAction: 'varendo-action' as EventName<VarendoActionEvent> },
  displayName: 'VarendoIconButton',
});
export const VarendoLink = createComponent({
  react: React,
  tagName: 'varendo-link',
  elementClass: VarendoLinkElement,
  events: { onVarendoLink: 'varendo-link' as EventName<VarendoLinkEvent> },
  displayName: 'VarendoLink',
});
export const VarendoText = createComponent({
  react: React,
  tagName: 'varendo-text',
  elementClass: VarendoTextElement,
  displayName: 'VarendoText',
});
export const VarendoHeading = createComponent({
  react: React,
  tagName: 'varendo-heading',
  elementClass: VarendoHeadingElement,
  displayName: 'VarendoHeading',
});
export const VarendoBadge = createComponent({
  react: React,
  tagName: 'varendo-badge',
  elementClass: VarendoBadgeElement,
  displayName: 'VarendoBadge',
});
export const VarendoAvatar = createComponent({
  react: React,
  tagName: 'varendo-avatar',
  elementClass: VarendoAvatarElement,
  displayName: 'VarendoAvatar',
});
export const VarendoSeparator = createComponent({
  react: React,
  tagName: 'varendo-separator',
  elementClass: VarendoSeparatorElement,
  displayName: 'VarendoSeparator',
});
export const VarendoSurface = createComponent({
  react: React,
  tagName: 'varendo-surface',
  elementClass: VarendoSurfaceElement,
  displayName: 'VarendoSurface',
});
export const VarendoStack = createComponent({
  react: React,
  tagName: 'varendo-stack',
  elementClass: VarendoStackElement,
  displayName: 'VarendoStack',
});
export const VarendoGrid = createComponent({
  react: React,
  tagName: 'varendo-grid',
  elementClass: VarendoGridElement,
  displayName: 'VarendoGrid',
});
export const VarendoSplitPane = createComponent({
  react: React,
  tagName: 'varendo-split-pane',
  elementClass: VarendoSplitPaneElement,
  events: { onVarendoSplitChange: 'varendo-split-change' as EventName<VarendoSplitChangeEvent> },
  displayName: 'VarendoSplitPane',
});
export const VarendoScrollArea = createComponent({
  react: React,
  tagName: 'varendo-scroll-area',
  elementClass: VarendoScrollAreaElement,
  displayName: 'VarendoScrollArea',
});
