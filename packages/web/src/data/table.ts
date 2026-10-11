/** Data-family entry point. The native table implementation is kept in the
 * legacy element path for M0 compatibility and is re-exported here so direct
 * data imports stay isolated from region/planner code. */
export { AELIQO_TABLE_MAX_VIRTUAL_ROWS, AeliqoTableElement, stableTableRowKey } from '../elements/aeliqo-table.js';
export type { AeliqoTableMode } from '../elements/aeliqo-table.js';
export type {
  AeliqoTableColumn,
  AeliqoTableRow,
  AeliqoTableSelectionMode,
  AeliqoTableSelectionDetail,
  TableCell,
} from '../types.js';
