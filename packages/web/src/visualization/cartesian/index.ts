import { AeliqoAreaElement } from './area.js';
import { AeliqoBarElement } from './bar.js';
import { AeliqoHeatmapElement } from './heatmap.js';
import { AeliqoHistogramElement } from './histogram.js';
import { AeliqoScatterElement } from './scatter.js';
import { AeliqoTrendElement } from './trend.js';
import { AELIQO_WEB_VERSION } from '../../version.js';

export { AeliqoCartesianElement } from './base.js';
export { AeliqoAreaElement } from './area.js';
export { AeliqoBarElement } from './bar.js';
export { AeliqoHeatmapElement } from './heatmap.js';
export { AeliqoHistogramElement } from './histogram.js';
export { AeliqoScatterElement } from './scatter.js';
export { AeliqoTrendElement } from './trend.js';
export type { CartesianElementInputs, CartesianView } from './base.js';

export const AELIQO_CARTESIAN_ELEMENTS = [
  ['aeliqo-trend', AeliqoTrendElement],
  ['aeliqo-bar', AeliqoBarElement],
  ['aeliqo-area', AeliqoAreaElement],
  ['aeliqo-scatter', AeliqoScatterElement],
  ['aeliqo-histogram', AeliqoHistogramElement],
  ['aeliqo-heatmap', AeliqoHeatmapElement],
] as const;

/** Idempotently register the Cartesian family in an explicit registry. */
export function defineCartesianElements(registry?: CustomElementRegistry): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Cartesian visualization elements require a CustomElementRegistry.');
  for (const [name, constructor] of AELIQO_CARTESIAN_ELEMENTS) {
    const current = target.get(name);
    if (current === undefined) {
      target.define(name, constructor);
    } else if (current !== constructor && (current as typeof constructor).aeliqoVersion !== AELIQO_WEB_VERSION) {
      throw new Error(`Cannot register ${name}: an incompatible custom element is already defined.`);
    }
  }
}
