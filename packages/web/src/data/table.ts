/** Data-family entry point. The native table implementation is kept in the
 * legacy element path for M0 compatibility and is re-exported here so direct
 * data imports stay isolated from region/planner code. */
export { VARENDO_TABLE_MAX_VIRTUAL_ROWS, VarendoTableElement, stableTableRowKey } from '../elements/varendo-table.js';
export type { VarendoTableMode } from '../elements/varendo-table.js';
export type {
  VarendoTableColumn,
  VarendoTableRow,
  VarendoTableSelectionMode,
  VarendoTableSelectionDetail,
  TableCell,
} from '../types.js';
