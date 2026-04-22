import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSourceHistorySnapshot,
  stepSourceHistoryState
} from '../.test-dist/src/source-history-state.js';

test('recordSourceHistorySnapshot pushes the previous snapshot and clears redo', () => {
  const previous = {
    content: 'alpha',
    selectionStart: 1,
    selectionEnd: 1,
    scrollTop: 3
  };
  const next = {
    content: 'beta',
    selectionStart: 2,
    selectionEnd: 4,
    scrollTop: 8
  };

  const state = {
    snapshot: previous,
    undoStack: [],
    redoStack: [previous]
  };

  const result = recordSourceHistorySnapshot(state, next, 5);

  assert.deepEqual(result.snapshot, next);
  assert.deepEqual(result.undoStack, [previous]);
  assert.deepEqual(result.redoStack, []);
});

test('stepSourceHistoryState undo restores the previous snapshot and records redo', () => {
  const current = {
    content: 'beta',
    selectionStart: 2,
    selectionEnd: 4,
    scrollTop: 8
  };
  const previous = {
    content: 'alpha',
    selectionStart: 1,
    selectionEnd: 1,
    scrollTop: 3
  };

  const result = stepSourceHistoryState(
    {
      snapshot: current,
      undoStack: [previous],
      redoStack: []
    },
    'undo',
    5
  );

  assert.deepEqual(result.snapshot, previous);
  assert.deepEqual(result.state.snapshot, previous);
  assert.deepEqual(result.state.undoStack, []);
  assert.deepEqual(result.state.redoStack, [current]);
});

test('stepSourceHistoryState redo restores the next snapshot and appends undo', () => {
  const current = {
    content: 'alpha',
    selectionStart: 1,
    selectionEnd: 1,
    scrollTop: 3
  };
  const next = {
    content: 'beta',
    selectionStart: 2,
    selectionEnd: 4,
    scrollTop: 8
  };

  const result = stepSourceHistoryState(
    {
      snapshot: current,
      undoStack: [],
      redoStack: [next]
    },
    'redo',
    5
  );

  assert.deepEqual(result.snapshot, next);
  assert.deepEqual(result.state.snapshot, next);
  assert.deepEqual(result.state.undoStack, [current]);
  assert.deepEqual(result.state.redoStack, []);
});
