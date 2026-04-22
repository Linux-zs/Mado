import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTablePropertiesInteractionRole,
  resolveTablePropertiesDisplaySize,
  resolveTablePropertiesPanelTransition,
  TABLE_ALIGNMENT_BUTTON_LABELS,
  TABLE_PROPERTIES_ALIGNMENT_LABEL,
  TABLE_PROPERTIES_APPLY_LABEL,
  TABLE_PROPERTIES_BUTTON_LABEL,
  TABLE_PROPERTIES_SIZE_LABEL,
  normalizeTableColumnAlignment,
  resolveTablePropertiesDraft,
  resolveTableResizePlan,
  shouldReuseTablePropertiesControls
} from '../.test-dist/src/table-overlay-state.js';

test('resolveTableResizePlan adds rows and columns toward the requested size', () => {
  assert.deepEqual(
    resolveTableResizePlan({
      currentRows: 3,
      currentCols: 4,
      targetRows: 5,
      targetCols: 6
    }),
    {
      nextRows: 5,
      nextCols: 6,
      addRowsAfter: 2,
      removeRowsFromEnd: 0,
      addColsAfter: 2,
      removeColsFromEnd: 0
    }
  );
});

test('resolveTableResizePlan removes rows and columns from the end when shrinking', () => {
  assert.deepEqual(
    resolveTableResizePlan({
      currentRows: 5,
      currentCols: 6,
      targetRows: 3,
      targetCols: 2
    }),
    {
      nextRows: 3,
      nextCols: 2,
      addRowsAfter: 0,
      removeRowsFromEnd: 2,
      addColsAfter: 0,
      removeColsFromEnd: 4
    }
  );
});

test('resolveTableResizePlan clamps to the minimum markdown-safe table size', () => {
  assert.deepEqual(
    resolveTableResizePlan({
      currentRows: 3,
      currentCols: 3,
      targetRows: 1,
      targetCols: 0
    }),
    {
      nextRows: 2,
      nextCols: 1,
      addRowsAfter: 0,
      removeRowsFromEnd: 1,
      addColsAfter: 0,
      removeColsFromEnd: 2
    }
  );
});

test('normalizeTableColumnAlignment accepts only left center and right', () => {
  assert.equal(normalizeTableColumnAlignment('left'), 'left');
  assert.equal(normalizeTableColumnAlignment('center'), 'center');
  assert.equal(normalizeTableColumnAlignment('right'), 'right');
  assert.equal(normalizeTableColumnAlignment(' justify '), null);
});

test('resolveTablePropertiesDraft preserves draft while the same table properties panel stays open', () => {
  assert.deepEqual(
    resolveTablePropertiesDraft({
      previousDraft: { rows: 7, cols: 5 },
      previousTableStart: 24,
      nextTableStart: 24,
      actualRows: 3,
      actualCols: 3,
      preserveExisting: true
    }),
    {
      rows: 7,
      cols: 5
    }
  );
});

test('resolveTablePropertiesDraft resets to actual size when the table changes or preservation is disabled', () => {
  assert.deepEqual(
    resolveTablePropertiesDraft({
      previousDraft: { rows: 7, cols: 5 },
      previousTableStart: 24,
      nextTableStart: 48,
      actualRows: 4,
      actualCols: 6,
      preserveExisting: true
    }),
    {
      rows: 4,
      cols: 6
    }
  );

  assert.deepEqual(
    resolveTablePropertiesDraft({
      previousDraft: { rows: 7, cols: 5 },
      previousTableStart: 24,
      nextTableStart: 24,
      actualRows: 4,
      actualCols: 6,
      preserveExisting: false
    }),
    {
      rows: 4,
      cols: 6
    }
  );
});

test('table property labels stay in Chinese', () => {
  assert.equal(TABLE_PROPERTIES_BUTTON_LABEL, '\u8868\u683c\u5c5e\u6027');
  assert.equal(TABLE_PROPERTIES_SIZE_LABEL, '\u8868\u683c\u5927\u5c0f');
  assert.equal(TABLE_PROPERTIES_APPLY_LABEL, '\u5e94\u7528');
  assert.equal(TABLE_PROPERTIES_ALIGNMENT_LABEL, '\u5bf9\u9f50\u65b9\u5f0f');
  assert.deepEqual(TABLE_ALIGNMENT_BUTTON_LABELS, {
    left: '\u5de6\u5bf9\u9f50',
    center: '\u5c45\u4e2d',
    right: '\u53f3\u5bf9\u9f50'
  });
});

test('table property interaction roles keep pointer events inside the overlay', () => {
  assert.equal(isTablePropertiesInteractionRole('panel'), true);
  assert.equal(isTablePropertiesInteractionRole('grid-cell'), true);
  assert.equal(isTablePropertiesInteractionRole('number-input'), true);
  assert.equal(isTablePropertiesInteractionRole('apply-button'), true);
  assert.equal(isTablePropertiesInteractionRole('align-button'), true);
  assert.equal(isTablePropertiesInteractionRole('caption'), false);
  assert.equal(isTablePropertiesInteractionRole(null), false);
});

test('resolveTablePropertiesPanelTransition only initializes draft when opening from closed state', () => {
  assert.deepEqual(
    resolveTablePropertiesPanelTransition({
      previousOpen: false,
      nextOpen: true,
      hasActiveTable: true
    }),
    {
      isOpen: true,
      initializeDraft: true
    }
  );

  assert.deepEqual(
    resolveTablePropertiesPanelTransition({
      previousOpen: true,
      nextOpen: true,
      hasActiveTable: true
    }),
    {
      isOpen: true,
      initializeDraft: false
    }
  );
});

test('shouldReuseTablePropertiesControls rejects detached cached controls', () => {
  assert.equal(
    shouldReuseTablePropertiesControls({
      hasCachedControls: true,
      controlsConnected: true,
      controlsInsidePanel: true
    }),
    true
  );

  assert.equal(
    shouldReuseTablePropertiesControls({
      hasCachedControls: true,
      controlsConnected: false,
      controlsInsidePanel: false
    }),
    false
  );

  assert.equal(
    shouldReuseTablePropertiesControls({
      hasCachedControls: false,
      controlsConnected: false,
      controlsInsidePanel: false
    }),
    false
  );
});

test('resolveTablePropertiesDisplaySize prefers hover preview over draft and actual size', () => {
  assert.deepEqual(
    resolveTablePropertiesDisplaySize({
      hoverPreview: { rows: 6, cols: 3 },
      draft: { rows: 4, cols: 2 },
      actualRows: 3,
      actualCols: 2
    }),
    {
      rows: 6,
      cols: 3
    }
  );

  assert.deepEqual(
    resolveTablePropertiesDisplaySize({
      hoverPreview: null,
      draft: { rows: 4, cols: 2 },
      actualRows: 3,
      actualCols: 2
    }),
    {
      rows: 4,
      cols: 2
    }
  );

  assert.deepEqual(
    resolveTablePropertiesDisplaySize({
      hoverPreview: null,
      draft: null,
      actualRows: 3,
      actualCols: 2
    }),
    {
      rows: 3,
      cols: 2
    }
  );
});
