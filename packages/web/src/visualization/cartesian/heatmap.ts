import { VarendoCartesianElement } from './base.js';
export class VarendoHeatmapElement extends VarendoCartesianElement {
  protected readonly expectedView = 'heatmap' as const;
}
