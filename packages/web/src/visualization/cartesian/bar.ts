import { AeliqoCartesianElement } from './base.js';
export class AeliqoBarElement extends AeliqoCartesianElement {
  protected readonly expectedView = 'bar' as const;
}
