export type TableColumnAlignment = 'left' | 'center' | 'right';

export const TABLE_PROPERTIES_BUTTON_LABEL = '\u8868\u683c\u5c5e\u6027';
export const TABLE_PROPERTIES_SIZE_LABEL = '\u8868\u683c\u5927\u5c0f';
export const TABLE_PROPERTIES_APPLY_LABEL = '\u5e94\u7528';
export const TABLE_PROPERTIES_ALIGNMENT_LABEL = '\u5bf9\u9f50\u65b9\u5f0f';
export const TABLE_ALIGNMENT_BUTTON_LABELS: Record<TableColumnAlignment, string> = {
  left: '\u5de6\u5bf9\u9f50',
  center: '\u5c45\u4e2d',
  right: '\u53f3\u5bf9\u9f50'
};

const TABLE_PROPERTIES_INTERACTION_ROLES = new Set([
  'panel',
  'grid-cell',
  'number-input',
  'apply-button',
  'align-button'
]);

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

export function isTablePropertiesInteractionRole(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return TABLE_PROPERTIES_INTERACTION_ROLES.has(value);
}

export function resolveTablePropertiesPanelTransition(input: {
  previousOpen: boolean;
  nextOpen: boolean;
  hasActiveTable: boolean;
}): { isOpen: boolean; initializeDraft: boolean } {
  const isOpen = input.nextOpen && input.hasActiveTable;

  return {
    isOpen,
    initializeDraft: isOpen && !input.previousOpen
  };
}

export function shouldReuseTablePropertiesControls(input: {
  hasCachedControls: boolean;
  controlsConnected: boolean;
  controlsInsidePanel: boolean;
}): boolean {
  return input.hasCachedControls && input.controlsConnected && input.controlsInsidePanel;
}

export function resolveTablePropertiesDisplaySize(input: {
  hoverPreview: { rows: number; cols: number } | null;
  draft: { rows: number; cols: number } | null;
  actualRows: number;
  actualCols: number;
}): { rows: number; cols: number } {
  if (input.hoverPreview) {
    return {
      rows: Math.max(MIN_TABLE_ROWS, Math.floor(input.hoverPreview.rows)),
      cols: Math.max(MIN_TABLE_COLS, Math.floor(input.hoverPreview.cols))
    };
  }

  if (input.draft) {
    return {
      rows: Math.max(MIN_TABLE_ROWS, Math.floor(input.draft.rows)),
      cols: Math.max(MIN_TABLE_COLS, Math.floor(input.draft.cols))
    };
  }

  return {
    rows: Math.max(MIN_TABLE_ROWS, Math.floor(input.actualRows)),
    cols: Math.max(MIN_TABLE_COLS, Math.floor(input.actualCols))
  };
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
