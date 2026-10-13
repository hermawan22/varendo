import { VarendoCartesianElement } from './base.js';
export class VarendoBarElement extends VarendoCartesianElement {
  protected readonly expectedView = 'bar' as const;
}
