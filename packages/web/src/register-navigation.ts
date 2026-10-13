import {
  VarendoTabsElement,
  VarendoBreadcrumbElement,
  VarendoPaginationElement,
  VarendoMenuElement,
  VarendoTreeNavElement,
} from './navigation/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-tabs', constructor: VarendoTabsElement },
  { name: 'varendo-breadcrumb', constructor: VarendoBreadcrumbElement },
  { name: 'varendo-pagination', constructor: VarendoPaginationElement },
  { name: 'varendo-menu', constructor: VarendoMenuElement },
  { name: 'varendo-tree-nav', constructor: VarendoTreeNavElement },
];
