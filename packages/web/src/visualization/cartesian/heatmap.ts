import { AeliqoCartesianElement } from './base.js';
export class AeliqoHeatmapElement extends AeliqoCartesianElement {
  protected readonly expectedView = 'heatmap' as const;
}
