import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTableColumnAlignment,
  resolveTableResizePlan
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
