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
} from './foundation/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-button', constructor: AeliqoButtonElement },
  { name: 'aeliqo-icon-button', constructor: AeliqoIconButtonElement },
  { name: 'aeliqo-link', constructor: AeliqoLinkElement },
  { name: 'aeliqo-text', constructor: AeliqoTextElement },
  { name: 'aeliqo-heading', constructor: AeliqoHeadingElement },
  { name: 'aeliqo-badge', constructor: AeliqoBadgeElement },
  { name: 'aeliqo-avatar', constructor: AeliqoAvatarElement },
  { name: 'aeliqo-separator', constructor: AeliqoSeparatorElement },
  { name: 'aeliqo-surface', constructor: AeliqoSurfaceElement },
  { name: 'aeliqo-stack', constructor: AeliqoStackElement },
  { name: 'aeliqo-grid', constructor: AeliqoGridElement },
  { name: 'aeliqo-split-pane', constructor: AeliqoSplitPaneElement },
  { name: 'aeliqo-scroll-area', constructor: AeliqoScrollAreaElement },
];
