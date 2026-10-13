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
} from './foundation/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-button', constructor: VarendoButtonElement },
  { name: 'varendo-icon-button', constructor: VarendoIconButtonElement },
  { name: 'varendo-link', constructor: VarendoLinkElement },
  { name: 'varendo-text', constructor: VarendoTextElement },
  { name: 'varendo-heading', constructor: VarendoHeadingElement },
  { name: 'varendo-badge', constructor: VarendoBadgeElement },
  { name: 'varendo-avatar', constructor: VarendoAvatarElement },
  { name: 'varendo-separator', constructor: VarendoSeparatorElement },
  { name: 'varendo-surface', constructor: VarendoSurfaceElement },
  { name: 'varendo-stack', constructor: VarendoStackElement },
  { name: 'varendo-grid', constructor: VarendoGridElement },
  { name: 'varendo-split-pane', constructor: VarendoSplitPaneElement },
  { name: 'varendo-scroll-area', constructor: VarendoScrollAreaElement },
];
