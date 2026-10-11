import { AeliqoPlotElement } from './plot/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [{ name: 'aeliqo-plot', constructor: AeliqoPlotElement }];
