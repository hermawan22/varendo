import { VarendoChartElement } from './elements/varendo-chart.js';
import { VarendoTableElement } from './elements/varendo-table.js';
import { VarendoRegionElement } from './region/varendo-region.js';
import { registerElements, type ElementRegistration } from './register-elements.js';

const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-table', constructor: VarendoTableElement },
  { name: 'varendo-chart', constructor: VarendoChartElement },
  { name: 'varendo-region', constructor: VarendoRegionElement },
];

export function registerBaseElements(registry?: CustomElementRegistry): void {
  registerElements(registrations, registry);
}
