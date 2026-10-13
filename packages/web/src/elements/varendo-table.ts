import { varendoTableStyles } from './varendo-table-styles.js';
import { html, LitElement, nothing } from 'lit';
import { VarendoTableSelectionEvent } from '../events.js';
import { VarendoTablePageEvent, VarendoTableSortEvent, VarendoTableWindowEvent } from '../data/events.js';
import { dataValueText } from '../data/shared.js';
import type { ResultRef } from '@varendo/core';
import type { VarendoDataScope, VarendoDataStatus, VarendoSortState } from '../data/types.js';
import type { VarendoTableColumn, VarendoTableRow, VarendoTableSelectionMode } from '../types.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import { stableTableRowKey, tableIdentityLabel } from './table-identity.js';
import { gridCellTarget } from './table-grid-navigation.js';
import type { GridNavigationContext } from './table-grid-navigation.js';
import { createTableWindow, visibleTableRows } from './table-window.js';
import type { TableWindow } from './table-window.js';
import {
  sortDescription,
  sortIndicator,
  tablePaginationSection,
  tableScopeSection,
  tableStatusSection,
} from './table-rendering.js';

export { stableTableRowKey } from './table-identity.js';
export { VARENDO_TABLE_MAX_VIRTUAL_ROWS } from './table-window.js';

export type VarendoTableMode = 'table' | 'grid';

interface GridFocus {
  readonly rowIndex: number;
  readonly rowKey?: string;
  readonly column: number;
}

/** Native table-first collection; grid mode is an explicit opt-in. */
export class VarendoTableElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    columns: { attribute: false },
    rows: { attribute: false },
    caption: { type: String },
    emptyLabel: { attribute: 'empty-label', type: String },
    entity: { type: String },
    identity: { attribute: false },
    selection: { type: String },
    selectedKeys: { attribute: false },
    result: { attribute: false },
    mode: { type: String },
    sort: { attribute: false },
    page: { type: Number },
    pageSize: { attribute: 'page-size', type: Number },
    totalRows: { attribute: 'total-rows', type: Number },
    virtualized: { type: Boolean },
    virtualStart: { attribute: 'virtual-start', type: Number },
    virtualCount: { attribute: 'virtual-count', type: Number },
    overscan: { type: Number },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  columns: readonly VarendoTableColumn[] = [];
  rows: readonly VarendoTableRow[] = [];
  caption = '';
  emptyLabel = 'No rows to display.';
  entity = 'row';
  identity: readonly string[] = [];
  selection: VarendoTableSelectionMode = 'none';
  selectedKeys: readonly string[] = [];
  result: ResultRef | undefined = undefined;
  mode: VarendoTableMode = 'table';
  sort: VarendoSortState | undefined = undefined;
  page = 1;
  pageSize = 0;
  totalRows: number | undefined = undefined;
  virtualized = false;
  virtualStart = 0;
  virtualCount = 40;
  overscan = 4;
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';

  protected override render() {
    const mode = this.mode === 'grid' ? 'grid' : 'table';
    const selectable = this.selection !== 'none';
    const status = this.rows.length === 0 && this.status === 'ready' ? 'empty' : this.status;
    const visible = this.visibleRows();
    const rowCount = this.totalRows ?? this.scope?.filteredTotal ?? this.scope?.populationTotal ?? this.rows.length;
    const scopeView = {
      scope: this.scope,
      totalRows: this.totalRows,
      rowCount,
      loadedRows: this.rows.length,
      renderedCount: visible.length,
      virtualized: this.virtualized,
      entity: this.entity,
    };
    return html`
      <div part="scroll" tabindex=${mode === 'grid' ? nothing : '0'}>
        ${
          mode === 'table'
            ? this.renderTable(visible, selectable, status)
            : this.renderGrid(visible, selectable, rowCount)
        }
      </div>
      ${tableScopeSection(scopeView)} ${tableStatusSection(status, this.message)}
      ${tablePaginationSection(this.page, this.pageSize, this.totalRows, this.requestPage)}
    `;
  }

  private renderTable(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
    selectable: boolean,
    status: VarendoDataStatus,
  ) {
    return html`<table part="table" data-virtualized=${this.virtualized ? 'true' : 'false'}>
      ${this.renderCaption()} ${this.renderTableHead(selectable)}
      <tbody>
        ${this.renderTableRows(rows, selectable, status)}
      </tbody>
    </table>`;
  }

  private renderCaption() {
    if (!this.caption) return nothing;
    return html`<caption>
      ${this.caption}
    </caption>`;
  }

  private renderTableHead(selectable: boolean) {
    return html`<thead>
      <tr>
        ${selectable ? html`<th scope="col" part="selection-heading"><span class="visually-hidden">Select</span></th>` : nothing}
        ${this.columns.map((column) => this.renderHeader(column))}
      </tr>
    </thead>`;
  }

  private renderTableRows(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
    selectable: boolean,
    status: VarendoDataStatus,
  ) {
    if (rows.length === 0) return this.renderEmptyRow(selectable, status);
    return rows.map((entry) => this.renderTableRow(entry.row, entry.index, selectable));
  }

  private renderEmptyRow(selectable: boolean, status: VarendoDataStatus) {
    const columnCount = Math.max(this.columns.length + (selectable ? 1 : 0), 1);
    const label = status === 'empty' ? this.emptyLabel : '';
    return html`<tr>
      <td colspan=${columnCount}>${label}</td>
    </tr>`;
  }

  private renderHeader(column: VarendoTableColumn) {
    const sortable = column.sortable === true;
    const active = this.sort?.field === column.key;
    const indicator = sortIndicator(active, this.sort?.direction);
    const ariaSort = sortDescription(active, this.sort?.direction, sortable);
    return html`<th
      scope="col"
      part="heading"
      data-key=${column.key}
      aria-sort=${ariaSort}
      style=${column.align ? `text-align:${column.align}` : nothing}
    >
      ${sortable ? html`<button part="sort" type="button" aria-label=${`Sort by ${column.label}`} aria-pressed=${active ? 'true' : 'false'} @click=${() => this.requestSort(column)}>${column.label}${indicator}</button>` : html`${column.label}`}
    </th>`;
  }

  private renderTableRow(row: VarendoTableRow, rowIndex: number, selectable: boolean) {
    const key = stableTableRowKey(row, this.identity);
    const selected = key !== undefined && this.selectedKeys.includes(key);
    return html`<tr
      data-row-index=${rowIndex}
      ?data-selected=${selected}
      aria-selected=${selectable ? String(selected) : nothing}
    >
      ${selectable ? this.renderSelectionCell(key, selected) : nothing}
      ${this.columns.map((column) => html`<td data-label=${column.label} style=${column.align ? `text-align:${column.align}` : nothing}>${dataValueText(row[column.key])}</td>`)}
    </tr>`;
  }

  private renderGrid(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
    selectable: boolean,
    rowCount: number | undefined,
  ) {
    const gridRowCount = rowCount === undefined ? undefined : rowCount + 1;
    const focus = this.resolveGridFocus(rows, this.gridColumnCount(selectable));
    return html`<div
      part="grid"
      role="grid"
      aria-label=${this.caption || 'Data grid'}
      aria-rowcount=${gridRowCount === undefined ? nothing : String(gridRowCount)}
      aria-colcount=${String(this.columns.length + (selectable ? 1 : 0))}
    >
      <div role="rowgroup" part="grid-head">
        <div role="row" part="grid-row" aria-rowindex="1" style=${this.gridTemplate(selectable)}>
          ${selectable ? html`<div role="columnheader" aria-colindex="1" part="selection-heading"><span class="visually-hidden">Select</span></div>` : nothing}
          ${this.columns.map((column, index) => this.renderGridHeader(column, selectable ? index + 2 : index + 1))}
        </div>
      </div>
      <div role="rowgroup" part="grid-body">
        ${rows.length === 0 ? html`<div role="row" aria-rowindex="2"><div role="gridcell" part="empty" aria-colspan=${Math.max(this.columns.length + (selectable ? 1 : 0), 1)}>${this.emptyLabel}</div></div>` : rows.map(({ row, index }) => this.renderGridRow(row, index, selectable, focus))}
      </div>
    </div>`;
  }

  private renderGridRow(row: VarendoTableRow, rowIndex: number, selectable: boolean, focus: GridFocus) {
    const key = stableTableRowKey(row, this.identity);
    const selected = key !== undefined && this.selectedKeys.includes(key);
    return html`<div
      role="row"
      part="grid-row"
      style=${this.gridTemplate(selectable)}
      data-row-index=${rowIndex}
      ?data-selected=${selected}
      aria-selected=${selectable ? String(selected) : nothing}
      aria-rowindex=${rowIndex + 2}
    >
      ${selectable ? this.renderGridCell(0, rowIndex, focus, this.renderSelectionCell(key, selected, true)) : nothing}
      ${this.columns.map((column, index) => this.renderGridCell(selectable ? index + 1 : index, rowIndex, focus, html`${dataValueText(row[column.key])}`, column.align))}
    </div>`;
  }

  private renderGridCell(
    columnIndex: number,
    rowIndex: number,
    focus: GridFocus,
    content: unknown,
    align?: VarendoTableColumn['align'],
  ) {
    return html`<div
      role="gridcell"
      part="${columnIndex === 0 && this.selection !== 'none' ? 'selection-cell' : 'cell'}"
      data-row-index=${rowIndex}
      data-col-index=${columnIndex}
      aria-colindex=${columnIndex + 1}
      tabindex=${focus.rowIndex === rowIndex && focus.column === columnIndex ? '0' : '-1'}
      style=${align ? `text-align:${align}` : nothing}
      @focus=${() => this.rememberGridFocus(rowIndex, columnIndex)}
      @keydown=${this.handleGridCellKeyDown}
    >
      ${content}
    </div>`;
  }

  private renderGridHeader(column: VarendoTableColumn, columnIndex: number) {
    const active = this.sort?.field === column.key;
    const indicator = sortIndicator(active, this.sort?.direction);
    const ariaSort = sortDescription(active, this.sort?.direction, column.sortable === true);
    return html`<div
      role="columnheader"
      part="heading"
      data-key=${column.key}
      aria-colindex=${columnIndex}
      aria-sort=${ariaSort}
    >
      ${column.sortable === true ? html`<button part="sort" type="button" aria-label=${`Sort by ${column.label}`} aria-pressed=${active ? 'true' : 'false'} @click=${() => this.requestSort(column)}>${column.label}${indicator}</button>` : html`${column.label}`}
    </div>`;
  }

  private gridTemplate(selectable: boolean): string {
    const count = this.columns.length + (selectable ? 1 : 0);
    return `grid-template-columns: ${selectable ? '3.25rem ' : ''}${'minmax(9rem, 1fr) '.repeat(Math.max(0, count - (selectable ? 1 : 0))).trim()}`;
  }

  private renderSelectionCell(key: string | undefined, selected: boolean, grid = false) {
    const action = selected && this.selection !== 'single' ? 'Deselect' : 'Select';
    const label =
      key === undefined ? 'Row cannot be selected' : `${action} ${this.entity} ${this.selectionLabelForKey(key)}`;
    const cell = html`<input
      type=${this.selection === 'single' ? 'radio' : 'checkbox'}
      name=${this.selection === 'single' ? 'varendo-single-selection' : nothing}
      .checked=${selected}
      ?disabled=${key === undefined}
      aria-label=${label}
      @change=${(event: Event) => this.handleSelection(event, key)}
    />`;
    return grid ? cell : html`<td part="selection-cell" data-label="Select">${cell}</td>`;
  }

  private selectionLabelForKey(key: string): string {
    const row = this.rows.find((candidate) => stableTableRowKey(candidate, this.identity) === key);
    return row === undefined ? key : tableIdentityLabel(row, this.identity);
  }

  private gridColumnCount(selectable = this.selection !== 'none'): number {
    return this.columns.length + (selectable ? 1 : 0);
  }

  private virtualWindow(): TableWindow {
    return createTableWindow(this.rows.length, this.virtualStart, this.virtualCount, this.overscan);
  }

  private visibleRows(): readonly { readonly row: VarendoTableRow; readonly index: number }[] {
    return visibleTableRows(this.rows, this.virtualized, this.virtualWindow());
  }

  private readonly requestSort = (column: VarendoTableColumn): void => {
    if (column.sortable !== true) return;
    let sort: VarendoSortState | undefined;
    if (this.sort?.field !== column.key) sort = { field: column.key, direction: 'asc' };
    else if (this.sort.direction === 'asc') sort = { field: column.key, direction: 'desc' };
    this.dispatchEvent(new VarendoTableSortEvent({ sort }));
  };

  private readonly requestPage = (page: number): void => {
    const pages =
      this.totalRows === undefined || this.pageSize <= 0
        ? page
        : Math.max(1, Math.ceil(this.totalRows / this.pageSize));
    const next = Math.min(pages, Math.max(1, Math.trunc(page)));
    this.dispatchEvent(
      new VarendoTablePageEvent({
        page: next,
        pageSize: this.pageSize,
        ...(this.result === undefined ? {} : { result: this.result }),
      }),
    );
  };

  private readonly handleSelection = (event: Event, key: string | undefined): void => {
    if (key === undefined || !(event.target instanceof HTMLInputElement)) return;
    const next = new Set(this.selectedKeys);
    if (this.selection === 'single') {
      next.clear();
      if (event.target.checked) next.add(key);
    } else if (event.target.checked) next.add(key);
    else next.delete(key);
    const keys = [...next];
    const detail =
      keys.length === 0
        ? { mode: 'clear' as const, entity: this.entity, keys: [] as readonly string[] }
        : {
            mode: 'ids' as const,
            entity: this.entity,
            keys,
            ...(this.result === undefined ? {} : { result: this.result }),
          };
    this.dispatchEvent(new VarendoTableSelectionEvent(detail));
  };

  private gridFocus: GridFocus | undefined;
  private pendingGridFocus: GridFocus | undefined;

  protected override updated(): void {
    if (this.mode !== 'grid') return;
    const rows = this.visibleRows();
    if (rows.length > 0) {
      const focus = this.resolveGridFocus(rows, this.gridColumnCount());
      this.gridFocus = focus;
      if (this.pendingGridFocus !== undefined) {
        const target = this.findGridCell(this.pendingGridFocus);
        if (target !== undefined) {
          this.pendingGridFocus = undefined;
          target.focus();
        }
      }
    }
  }

  private resolveGridFocus(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
    columnCount: number,
  ): GridFocus {
    const column = Math.min(Math.max(0, this.gridFocus?.column ?? 0), Math.max(0, columnCount - 1));
    const entry = this.keyedGridRow(rows) ?? this.fallbackGridRow(rows);
    const rowIndex = entry?.index ?? 0;
    if (entry === undefined) return { rowIndex, column };
    const rowKey = stableTableRowKey(entry.row, this.identity);
    return rowKey === undefined ? { rowIndex, column } : { rowIndex, rowKey, column };
  }

  private keyedGridRow(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
  ): { readonly row: VarendoTableRow; readonly index: number } | undefined {
    const key = this.gridFocus?.rowKey;
    if (key === undefined) return undefined;
    return rows.find((entry) => stableTableRowKey(entry.row, this.identity) === key);
  }

  private fallbackGridRow(
    rows: readonly { readonly row: VarendoTableRow; readonly index: number }[],
  ): { readonly row: VarendoTableRow; readonly index: number } | undefined {
    const index = this.gridFocus?.rowIndex ?? rows[0]?.index ?? 0;
    return rows.find((entry) => entry.index >= index) ?? rows.at(-1);
  }

  private rememberGridFocus(rowIndex: number, column: number): void {
    this.gridFocus = this.gridFocusAt(rowIndex, column);
    this.pendingGridFocus = undefined;
  }

  private rowKeyAt(rowIndex: number): string | undefined {
    const row = this.rows[rowIndex];
    return row === undefined ? undefined : stableTableRowKey(row, this.identity);
  }

  private gridFocusAt(rowIndex: number, column: number): GridFocus {
    const rowKey = this.rowKeyAt(rowIndex);
    return rowKey === undefined ? { rowIndex, column } : { rowIndex, rowKey, column };
  }

  private findGridCell(focus: GridFocus): HTMLElement | undefined {
    const cells = [...(this.shadowRoot?.querySelectorAll<HTMLElement>("[role='gridcell'][data-row-index]") ?? [])];
    return cells.find((entry) => {
      const rowIndex = Number(entry.dataset.rowIndex);
      if (Number(entry.dataset.colIndex) !== focus.column) return false;
      if (focus.rowKey !== undefined) return this.rowKeyAt(rowIndex) === focus.rowKey;
      return rowIndex === focus.rowIndex;
    });
  }

  private availableRowCount(): number {
    const total = this.totalRows ?? this.scope?.filteredTotal ?? this.scope?.populationTotal;
    return Math.max(this.rows.length, Number.isFinite(total) ? Math.trunc(total!) : this.rows.length);
  }

  private gridNavigationContext(cell: HTMLElement): GridNavigationContext | undefined {
    const row = Number(cell.dataset.rowIndex);
    const column = Number(cell.dataset.colIndex);
    const cells = [...(this.shadowRoot?.querySelectorAll<HTMLElement>("[role='gridcell'][data-row-index]") ?? [])];
    const rows = [...new Set(cells.map((entry) => Number(entry.dataset.rowIndex)))].sort((left, right) => left - right);
    const columns = this.gridColumnCount();
    const rowPosition = rows.indexOf(row);
    if (rowPosition < 0 || columns < 1) return undefined;
    return {
      row,
      column,
      columns,
      rows,
      rowPosition,
      rowCount: this.availableRowCount(),
      pageSize: this.virtualWindow().count,
    };
  }

  private requestGridWindow(row: number, column: number): void {
    const { count, overscan } = this.virtualWindow();
    const focus = this.gridFocusAt(row, column);
    this.gridFocus = focus;
    this.pendingGridFocus = focus;
    this.dispatchEvent(
      new VarendoTableWindowEvent({
        start: Math.max(0, row),
        count,
        overscan,
        row,
        column,
        reason: 'keyboard',
        ...(this.result === undefined ? {} : { result: this.result }),
      }),
    );
  }

  private readonly handleGridCellKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    const cell = event.currentTarget;
    if (!(cell instanceof HTMLElement)) return;
    const context = this.gridNavigationContext(cell);
    if (context === undefined) return;
    const destination = gridCellTarget(event.key, event.ctrlKey, context);
    if (destination === undefined) return;
    const target = this.findGridCell(destination);
    if (target === undefined) {
      this.requestVirtualGridFocus(event, context.row, destination);
      return;
    }
    this.gridFocus = this.gridFocusAt(destination.rowIndex, destination.column);
    target.focus();
    event.preventDefault();
  };

  private requestVirtualGridFocus(event: KeyboardEvent, currentRow: number, destination: GridFocus): void {
    if (!this.virtualized || destination.rowIndex === currentRow) return;
    this.requestGridWindow(destination.rowIndex, destination.column);
    event.preventDefault();
  }

  static readonly styles = varendoTableStyles;
}
