import type { ResultRef } from '@varendo/core';

/** Exact decimal values stay structured so tables never round them through IEEE-754. */
interface VarendoDecimalCell {
  readonly decimal: string;
}

export type TableCell = string | number | boolean | null | VarendoDecimalCell;

export interface VarendoTableColumn {
  readonly key: string;
  readonly label: string;
  readonly sortable?: boolean;
  readonly align?: 'start' | 'center' | 'end';
}

export type VarendoTableRow = Readonly<Record<string, TableCell>>;

/** A stable identity is derived from these fields, never from a rendered row index. */

export type VarendoTableSelectionMode = 'none' | 'single' | 'multiple';

export interface VarendoTableSelectionDetail {
  readonly mode: 'clear' | 'ids';
  readonly entity: string;
  readonly keys: readonly string[];
  readonly result?: ResultRef;
}

export interface VarendoChartPoint {
  readonly label: string;
  /** Shared domain coordinate. Temporal renderers use a finite epoch value. */
  readonly x?: string | number;
  /** `null` is an unknown/missing point and creates a visible line gap. */
  readonly value: number | null;
  /** Exact source text for the accessible table when the plotted value is a decimal. */
  readonly displayValue?: string;
}

export interface VarendoChartSeries {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly points: readonly VarendoChartPoint[];
}
