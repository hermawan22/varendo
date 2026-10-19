import { VarendoCartesianElement } from './base.js';
export class VarendoScatterElement extends VarendoCartesianElement {
  protected readonly expectedView = 'scatter' as const;
}
