import type { Outcome } from '@varendo/core';
import type { VisualizationInputs } from '../types.js';
import { fail } from './geometry/shared.js';
import { compileRelationshipGeometry } from './geometry/relationship.js';
import { compileTreeGeometry, compileTreemapGeometry } from './geometry/tree.js';
import type { HierarchyGeometryOptions, HierarchyVisualizationGeometry } from './geometry/types.js';

export * from './geometry/types.js';
export { compileRelationshipGeometry } from './geometry/relationship.js';
export { compileTreeGeometry, compileTreemapGeometry } from './geometry/tree.js';

export function compileHierarchyVisualization(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions = {},
): Outcome<HierarchyVisualizationGeometry> {
  switch (inputs.visualization?.view) {
    case 'tree':
      return compileTreeGeometry(inputs, options);
    case 'treemap':
      return compileTreemapGeometry(inputs, options);
    case 'relationship':
      return compileRelationshipGeometry(inputs, options);
    default:
      return fail('view', 'The hierarchy surface requires a tree, treemap or relationship specification.');
  }
}
