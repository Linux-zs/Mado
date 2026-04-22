export type TableColumnAlignment = 'left' | 'center' | 'right';

export type TableResizePlan = {
  nextRows: number;
  nextCols: number;
  addRowsAfter: number;
  removeRowsFromEnd: number;
  addColsAfter: number;
  removeColsFromEnd: number;
};

const MIN_TABLE_ROWS = 2;
const MIN_TABLE_COLS = 1;

export function normalizeTableColumnAlignment(value: unknown): TableColumnAlignment | null {
  if (value === 'left' || value === 'center' || value === 'right') {
    return value;
  }

  return null;
}

export function resolveTableResizePlan(input: {
  currentRows: number;
  currentCols: number;
  targetRows: number;
  targetCols: number;
}): TableResizePlan {
  const nextRows = Math.max(MIN_TABLE_ROWS, Math.floor(input.targetRows));
  const nextCols = Math.max(MIN_TABLE_COLS, Math.floor(input.targetCols));
  const currentRows = Math.max(MIN_TABLE_ROWS, Math.floor(input.currentRows));
  const currentCols = Math.max(MIN_TABLE_COLS, Math.floor(input.currentCols));

  return {
    nextRows,
    nextCols,
    addRowsAfter: Math.max(0, nextRows - currentRows),
    removeRowsFromEnd: Math.max(0, currentRows - nextRows),
    addColsAfter: Math.max(0, nextCols - currentCols),
    removeColsFromEnd: Math.max(0, currentCols - nextCols)
  };
}
