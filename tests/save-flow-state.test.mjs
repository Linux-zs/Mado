import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getErrorMessage,
  resolveSaveFlowDecision
} from '../.test-dist/src/save-flow-state.js';

test('resolveSaveFlowDecision keeps existing document on save as but syncs current directory entries', () => {
  const decision = resolveSaveFlowDecision({
    operation: 'saveAs',
    isUntitled: false,
    activeFilePath: 'C:/docs/old.md',
    currentDirectoryPath: 'C:/docs',
    savedDirectoryPath: 'C:/docs'
  });

  assert.deepEqual(decision, {
    adoptsSavedDocument: false,
    syncsSavedFileIntoCurrentDirectory: true
  });
});

test('resolveSaveFlowDecision adopts untitled documents on first save', () => {
  const decision = resolveSaveFlowDecision({
    operation: 'saveAs',
    isUntitled: true,
    activeFilePath: null,
    currentDirectoryPath: 'C:/docs',
    savedDirectoryPath: 'C:/docs'
  });

  assert.deepEqual(decision, {
    adoptsSavedDocument: true,
    syncsSavedFileIntoCurrentDirectory: true
  });
});

test('getErrorMessage preserves backend error strings', () => {
  assert.equal(getErrorMessage('Encoding is not supported.', 'save failed'), 'Encoding is not supported.');
  assert.equal(getErrorMessage(new Error('boom'), 'save failed'), 'save failed');
});
