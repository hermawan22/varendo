import {
  AeliqoTabsElement,
  AeliqoBreadcrumbElement,
  AeliqoPaginationElement,
  AeliqoMenuElement,
  AeliqoTreeNavElement,
} from './navigation/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-tabs', constructor: AeliqoTabsElement },
  { name: 'aeliqo-breadcrumb', constructor: AeliqoBreadcrumbElement },
  { name: 'aeliqo-pagination', constructor: AeliqoPaginationElement },
  { name: 'aeliqo-menu', constructor: AeliqoMenuElement },
  { name: 'aeliqo-tree-nav', constructor: AeliqoTreeNavElement },
];
