import { VarendoPlotElement } from './plot/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-plot', constructor: VarendoPlotElement },
];
