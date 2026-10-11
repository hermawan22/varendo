import { registerAeliqoElements } from '../../packages/web/src/register.js';
import type { AeliqoHierarchyElementBase } from '../../packages/web/src/visualization/hierarchy/index.js';
import * as fixtures from './hierarchy-fixtures.js';
registerAeliqoElements();
for (const view of ['tree', 'treemap', 'relationship'] as const) {
  const element = document.createElement(`aeliqo-${view}`) as AeliqoHierarchyElementBase;
  element.label = `Browser ${view}`;
  element.visualization = fixtures[view];
  element.context = fixtures.context;
  element.datasets = fixtures.datasets;
  element.addEventListener('aeliqo-visualization-select', (event) => {
    Object.assign(window, { selection: (event as CustomEvent).detail });
  });
  document.querySelector('main')!.append(element);
  Object.assign(window, { [view]: element });
}
Object.assign(window, { result: fixtures.result, ref: fixtures.ref, rows: fixtures.rows });
