import { VarendoRelationshipElement, VarendoTreeElement, VarendoTreemapElement } from './element.js';
import { VARENDO_WEB_VERSION } from '../../version.js';

export {
  VarendoHierarchyElementBase,
  VarendoRelationshipElement,
  VarendoTreeElement,
  VarendoTreemapElement,
} from './element.js';
export type {
  HierarchyGeometry,
  HierarchyGeometryOptions,
  HierarchyNodeGeometry,
  HierarchyVisualizationGeometry,
  RelationshipEdgeGeometry,
  RelationshipGeometry,
  RelationshipNodeGeometry,
} from './geometry.js';
export {
  compileHierarchyVisualization,
  compileRelationshipGeometry,
  compileTreeGeometry,
  compileTreemapGeometry,
} from './geometry.js';

/** Register hierarchy elements in an application-owned custom element registry. */
export function defineHierarchyElements(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
  if (registry === undefined) throw new Error('Hierarchy visualization elements require a CustomElementRegistry.');
  for (const [name, constructor] of [
    ['varendo-tree', VarendoTreeElement],
    ['varendo-treemap', VarendoTreemapElement],
    ['varendo-relationship', VarendoRelationshipElement],
  ] as const) {
    const current = registry.get(name);
    if (current === undefined) registry.define(name, constructor);
    else if (current !== constructor && (current as typeof constructor).varendoVersion !== VARENDO_WEB_VERSION)
      throw new Error(`Cannot register ${name}: an incompatible custom element is already defined.`);
  }
}
export type {
  VarendoVisualizationSelectionDetail,
  VarendoVisualizationSelectionEvent,
  VisualizationDataset,
  VisualizationInputs,
} from '../types.js';
