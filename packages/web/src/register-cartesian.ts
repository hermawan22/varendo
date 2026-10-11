import {
  AeliqoTrendElement,
  AeliqoBarElement,
  AeliqoAreaElement,
  AeliqoScatterElement,
  AeliqoHistogramElement,
  AeliqoHeatmapElement,
} from './visualization/cartesian/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-trend', constructor: AeliqoTrendElement },
  { name: 'aeliqo-bar', constructor: AeliqoBarElement },
  { name: 'aeliqo-area', constructor: AeliqoAreaElement },
  { name: 'aeliqo-scatter', constructor: AeliqoScatterElement },
  { name: 'aeliqo-histogram', constructor: AeliqoHistogramElement },
  { name: 'aeliqo-heatmap', constructor: AeliqoHeatmapElement },
];
