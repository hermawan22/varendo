import type { AeliqoTableRow } from '../types.js';

/** Maximum number of body rows a virtualized table may mount at once. */
export const AELIQO_TABLE_MAX_VIRTUAL_ROWS = 100;

const DEFAULT_VIRTUAL_START = 0;
const DEFAULT_VIRTUAL_COUNT = 40;
const DEFAULT_VIRTUAL_OVERSCAN = 4;

export interface TableWindow {
  readonly start: number;
  readonly count: number;
  readonly overscan: number;
  readonly from: number;
  readonly to: number;
}

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function createTableWindow(
  rowCount: number,
  requestedStart: number,
  requestedCount: number,
  requestedOverscan: number,
): TableWindow {
  const maximumStart = Math.max(0, rowCount - 1);
  const start = boundedInteger(requestedStart, DEFAULT_VIRTUAL_START, 0, maximumStart);
  const count = boundedInteger(requestedCount, DEFAULT_VIRTUAL_COUNT, 1, AELIQO_TABLE_MAX_VIRTUAL_ROWS);
  const overscanLimit = Math.floor((AELIQO_TABLE_MAX_VIRTUAL_ROWS - count) / 2);
  const overscan = Math.min(
    boundedInteger(requestedOverscan, DEFAULT_VIRTUAL_OVERSCAN, 0, AELIQO_TABLE_MAX_VIRTUAL_ROWS),
    overscanLimit,
  );
  return {
    start,
    count,
    overscan,
    from: Math.max(0, start - overscan),
    to: Math.min(rowCount, start + count + overscan),
  };
}

export function visibleTableRows(
  rows: readonly AeliqoTableRow[],
  virtualized: boolean,
  window: TableWindow,
): readonly { readonly row: AeliqoTableRow; readonly index: number }[] {
  if (!virtualized) return rows.map((row, index) => ({ row, index }));
  return rows.slice(window.from, window.to).map((row, index) => ({ row, index: window.from + index }));
}
