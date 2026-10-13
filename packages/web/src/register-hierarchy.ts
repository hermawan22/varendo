import {
  VarendoTreeElement,
  VarendoTreemapElement,
  VarendoRelationshipElement,
} from './visualization/hierarchy/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-tree', constructor: VarendoTreeElement },
  { name: 'varendo-treemap', constructor: VarendoTreemapElement },
  { name: 'varendo-relationship', constructor: VarendoRelationshipElement },
];
