import type { ValidatedPresentation } from '@varendo/core/presentation';
import type { VarendoViewDefinition } from '../region/types.js';
import { registerElements } from '../register-elements.js';

const loaders = {
  foundation: () => import('../register-foundation.js'),
  input: () => import('../register-input.js'),
  navigation: () => import('../register-navigation.js'),
  feedback: () => import('../register-feedback.js'),
  data: () => import('../register-data.js'),
  cartesian: () => import('../register-cartesian.js'),
  temporal: () => import('../register-temporal.js'),
  hierarchy: () => import('../register-hierarchy.js'),
};
type Family = keyof typeof loaders;
const native = new Set(['layout.stack', 'data.table', 'data.trend']);
const visualization: Readonly<Record<string, Family>> = {
  'visualization.trend': 'cartesian',
  'visualization.bar': 'cartesian',
  'visualization.area': 'cartesian',
  'visualization.scatter': 'cartesian',
  'visualization.histogram': 'cartesian',
  'visualization.heatmap': 'cartesian',
  'visualization.matrix': 'temporal',
  'visualization.timeline': 'temporal',
  'visualization.calendar-grid': 'temporal',
  'visualization.tree': 'hierarchy',
  'visualization.treemap': 'hierarchy',
  'visualization.relationship': 'hierarchy',
};

function family(id: string): Family | undefined {
  if (id === 'control.filter') return 'input';
  const prefix = id.split('.')[0];
  if (
    prefix === 'foundation' ||
    prefix === 'input' ||
    prefix === 'navigation' ||
    prefix === 'feedback' ||
    prefix === 'data'
  )
    return prefix;
  return visualization[id];
}

/** Load constructors only after the plan is validated, before any candidate DOM publication. */
export async function registerPresentationElements(
  presentation: ValidatedPresentation,
  registry: CustomElementRegistry,
  customViews: readonly VarendoViewDefinition[],
): Promise<void> {
  const families = new Set<Family>();
  for (const node of presentation.nodes) {
    const id = node.manifest.id;
    const selected = family(id);
    if (customViews.some((view) => view.ref.id === id) || (!native.has(id) && selected === undefined)) {
      // Extension renderers may use any shared element, including compounds with nested children.
      const full = await import('../register.js');
      full.registerVarendoElements(registry);
      return;
    }
    if (!native.has(id) && selected !== undefined) families.add(selected);
  }
  for (const selected of families) {
    const module = await loaders[selected]();
    registerElements(module.registrations, registry);
  }
}
