import type { VarendoTableSelectionDetail } from './types.js';

/** A controlled table selection proposal identified by stable entity keys. */
export class VarendoTableSelectionEvent extends CustomEvent<VarendoTableSelectionDetail> {
  constructor(detail: VarendoTableSelectionDetail) {
    super('varendo-table-selection', {
      bubbles: true,
      composed: true,
      detail,
    });
  }
}
