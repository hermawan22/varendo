import { AeliqoTreeElement, AeliqoTreemapElement, AeliqoRelationshipElement } from './visualization/hierarchy/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-tree', constructor: AeliqoTreeElement },
  { name: 'aeliqo-treemap', constructor: AeliqoTreemapElement },
  { name: 'aeliqo-relationship', constructor: AeliqoRelationshipElement },
];
