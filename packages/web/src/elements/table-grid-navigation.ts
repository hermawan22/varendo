export interface GridCellPosition {
  readonly rowIndex: number;
  readonly column: number;
}

export interface GridNavigationContext {
  readonly row: number;
  readonly column: number;
  readonly columns: number;
  readonly rows: readonly number[];
  readonly rowPosition: number;
  readonly rowCount: number;
  readonly pageSize: number;
}

type GridMove = (context: GridNavigationContext, control: boolean) => GridCellPosition;

function nextVisibleRow(context: GridNavigationContext): number {
  const nextPosition = context.rowPosition + 1;
  if (nextPosition < context.rows.length) return context.rows[nextPosition]!;
  const lastVisibleRow = context.rows.at(-1) ?? context.row;
  return Math.min(context.rowCount - 1, lastVisibleRow + 1);
}

function previousVisibleRow(context: GridNavigationContext): number {
  const previousPosition = context.rowPosition - 1;
  if (previousPosition >= 0) return context.rows[previousPosition]!;
  const firstVisibleRow = context.rows[0] ?? context.row;
  return Math.max(0, firstVisibleRow - 1);
}

function moveRight(context: GridNavigationContext): GridCellPosition {
  if (context.column < context.columns - 1) return { rowIndex: context.row, column: context.column + 1 };
  return { rowIndex: nextVisibleRow(context), column: 0 };
}

function moveLeft(context: GridNavigationContext): GridCellPosition {
  if (context.column > 0) return { rowIndex: context.row, column: context.column - 1 };
  return { rowIndex: previousVisibleRow(context), column: context.columns - 1 };
}

function moveDown(context: GridNavigationContext): GridCellPosition {
  return { rowIndex: nextVisibleRow(context), column: context.column };
}

function moveUp(context: GridNavigationContext): GridCellPosition {
  return { rowIndex: previousVisibleRow(context), column: context.column };
}

function moveHome(context: GridNavigationContext, control: boolean): GridCellPosition {
  return { rowIndex: control ? 0 : context.row, column: 0 };
}

function moveEnd(context: GridNavigationContext, control: boolean): GridCellPosition {
  const rowIndex = control ? Math.max(0, context.rowCount - 1) : context.row;
  return { rowIndex, column: context.columns - 1 };
}

function movePageDown(context: GridNavigationContext): GridCellPosition {
  const lastRow = Math.max(0, context.rowCount - 1);
  return { rowIndex: Math.min(lastRow, context.row + context.pageSize), column: context.column };
}

function movePageUp(context: GridNavigationContext): GridCellPosition {
  return { rowIndex: Math.max(0, context.row - context.pageSize), column: context.column };
}

const GRID_MOVES: Readonly<Record<string, GridMove>> = {
  ArrowRight: moveRight,
  ArrowLeft: moveLeft,
  ArrowDown: moveDown,
  ArrowUp: moveUp,
  Home: moveHome,
  End: moveEnd,
  PageDown: movePageDown,
  PageUp: movePageUp,
};

export function gridCellTarget(
  key: string,
  control: boolean,
  context: GridNavigationContext,
): GridCellPosition | undefined {
  return GRID_MOVES[key]?.(context, control);
}
