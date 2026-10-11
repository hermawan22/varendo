import type { AeliqoTableSelectionDetail } from './types.js';

/** A controlled table selection proposal identified by stable entity keys. */
export class AeliqoTableSelectionEvent extends CustomEvent<AeliqoTableSelectionDetail> {
  constructor(detail: AeliqoTableSelectionDetail) {
    super('aeliqo-table-selection', {
      bubbles: true,
      composed: true,
      detail,
    });
  }
}
