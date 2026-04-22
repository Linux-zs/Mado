export type TableColumnAlignment = 'left' | 'center' | 'right';

export const TABLE_PROPERTIES_BUTTON_LABEL = '表格属性';
export const TABLE_PROPERTIES_SIZE_LABEL = '表格大小';
export const TABLE_PROPERTIES_APPLY_LABEL = '应用';
export const TABLE_PROPERTIES_ALIGNMENT_LABEL = '对齐方式';
export const TABLE_ALIGNMENT_BUTTON_LABELS: Record<TableColumnAlignment, string> = {
  left: '左对齐',
  center: '居中',
  right: '右对齐'
};

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

export function resolveTablePropertiesDraft(input: {
  previousDraft: { rows: number; cols: number } | null;
  previousTableStart: number | null;
  nextTableStart: number;
  actualRows: number;
  actualCols: number;
  preserveExisting: boolean;
}): { rows: number; cols: number } {
  if (
    input.preserveExisting &&
    input.previousDraft &&
    input.previousTableStart === input.nextTableStart
  ) {
    return {
      rows: Math.max(MIN_TABLE_ROWS, Math.floor(input.previousDraft.rows)),
      cols: Math.max(MIN_TABLE_COLS, Math.floor(input.previousDraft.cols))
    };
  }

  return {
    rows: Math.max(MIN_TABLE_ROWS, Math.floor(input.actualRows)),
    cols: Math.max(MIN_TABLE_COLS, Math.floor(input.actualCols))
  };
}
