import { AeliqoChartElement } from './elements/aeliqo-chart.js';
import { AeliqoTableElement } from './elements/aeliqo-table.js';
import { AeliqoRegionElement } from './region/aeliqo-region.js';
import { registerElements, type ElementRegistration } from './register-elements.js';

const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-table', constructor: AeliqoTableElement },
  { name: 'aeliqo-chart', constructor: AeliqoChartElement },
  { name: 'aeliqo-region', constructor: AeliqoRegionElement },
];

export function registerBaseElements(registry?: CustomElementRegistry): void {
  registerElements(registrations, registry);
}
