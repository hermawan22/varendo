import { dataValueText, stableDataRecordKey } from '../data/shared.js';
import type { AeliqoTableRow, TableCell } from '../types.js';

/** Encode row identities without ever using a rendered row index. Shares the
 * data-family encoding so table keys match record keys for the same values. */
export function stableTableRowKey(row: AeliqoTableRow, identity: readonly string[]): string | undefined {
  return stableDataRecordKey(row, identity);
}

export function tableIdentityLabel(row: AeliqoTableRow, identity: readonly string[]): string {
  const values = identity.map((field) => row[field]).filter((value): value is TableCell => value !== undefined);
  return values.map((value) => dataValueText(value)).join(' · ') || 'row';
}
