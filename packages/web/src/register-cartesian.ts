import {
  VarendoTrendElement,
  VarendoBarElement,
  VarendoAreaElement,
  VarendoScatterElement,
  VarendoHistogramElement,
  VarendoHeatmapElement,
} from './visualization/cartesian/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-trend', constructor: VarendoTrendElement },
  { name: 'varendo-bar', constructor: VarendoBarElement },
  { name: 'varendo-area', constructor: VarendoAreaElement },
  { name: 'varendo-scatter', constructor: VarendoScatterElement },
  { name: 'varendo-histogram', constructor: VarendoHistogramElement },
  { name: 'varendo-heatmap', constructor: VarendoHeatmapElement },
];
