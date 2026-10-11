import { AeliqoCartesianElement } from './base.js';
export class AeliqoScatterElement extends AeliqoCartesianElement {
  protected readonly expectedView = 'scatter' as const;
}
