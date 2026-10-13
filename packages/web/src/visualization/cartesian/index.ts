import { VarendoAreaElement } from './area.js';
import { VarendoBarElement } from './bar.js';
import { VarendoHeatmapElement } from './heatmap.js';
import { VarendoHistogramElement } from './histogram.js';
import { VarendoScatterElement } from './scatter.js';
import { VarendoTrendElement } from './trend.js';
import { VARENDO_WEB_VERSION } from '../../version.js';

export { VarendoCartesianElement } from './base.js';
export { VarendoAreaElement } from './area.js';
export { VarendoBarElement } from './bar.js';
export { VarendoHeatmapElement } from './heatmap.js';
export { VarendoHistogramElement } from './histogram.js';
export { VarendoScatterElement } from './scatter.js';
export { VarendoTrendElement } from './trend.js';
export type { CartesianElementInputs, CartesianView } from './base.js';

export const VARENDO_CARTESIAN_ELEMENTS = [
  ['varendo-trend', VarendoTrendElement],
  ['varendo-bar', VarendoBarElement],
  ['varendo-area', VarendoAreaElement],
  ['varendo-scatter', VarendoScatterElement],
  ['varendo-histogram', VarendoHistogramElement],
  ['varendo-heatmap', VarendoHeatmapElement],
] as const;

/** Idempotently register the Cartesian family in an explicit registry. */
export function defineCartesianElements(registry?: CustomElementRegistry): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Cartesian visualization elements require a CustomElementRegistry.');
  for (const [name, constructor] of VARENDO_CARTESIAN_ELEMENTS) {
    const current = target.get(name);
    if (current === undefined) {
      target.define(name, constructor);
    } else if (current !== constructor && (current as typeof constructor).varendoVersion !== VARENDO_WEB_VERSION) {
      throw new Error(`Cannot register ${name}: an incompatible custom element is already defined.`);
    }
  }
}
