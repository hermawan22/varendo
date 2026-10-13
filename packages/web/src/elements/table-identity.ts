import { dataValueText, stableDataRecordKey } from '../data/shared.js';
import type { VarendoTableRow, TableCell } from '../types.js';

/** Encode row identities without ever using a rendered row index. Shares the
 * data-family encoding so table keys match record keys for the same values. */
export function stableTableRowKey(row: VarendoTableRow, identity: readonly string[]): string | undefined {
  return stableDataRecordKey(row, identity);
}

export function tableIdentityLabel(row: VarendoTableRow, identity: readonly string[]): string {
  const values = identity.map((field) => row[field]).filter((value): value is TableCell => value !== undefined);
  return values.map((value) => dataValueText(value)).join(' · ') || 'row';
}
