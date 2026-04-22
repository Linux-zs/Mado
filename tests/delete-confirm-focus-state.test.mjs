import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeleteConfirmDialogResult,
  createDeleteConfirmRestoreTargetFromContext,
  getDeleteConfirmRestoreCandidateKinds
} from '../.test-dist/src/delete-confirm-focus-state.js';

test('createDeleteConfirmRestoreTargetFromContext keeps file row identity fields', () => {
  assert.deepEqual(
    createDeleteConfirmRestoreTargetFromContext({
      kind: 'files-row',
      documentId: 'doc-1',
      filePath: 'C:/docs/note.md',
      relativePath: 'note.md'
    }),
    {
      kind: 'files-row',
      documentId: 'doc-1',
      filePath: 'C:/docs/note.md',
      relativePath: 'note.md'
    }
  );
});

test('createDeleteConfirmRestoreTargetFromContext falls back for unknown contexts', () => {
  assert.deepEqual(createDeleteConfirmRestoreTargetFromContext({ kind: 'unknown' }), {
    kind: 'fallback-editor'
  });
});

test('getDeleteConfirmRestoreCandidateKinds returns sidebar fallback order', () => {
  assert.deepEqual(
    getDeleteConfirmRestoreCandidateKinds({
      kind: 'files-row',
      documentId: null,
      filePath: null,
      relativePath: null
    }),
    ['files-row', 'files-view', 'fallback-editor']
  );
  assert.deepEqual(getDeleteConfirmRestoreCandidateKinds({ kind: 'files-search' }), [
    'files-search',
    'files-view',
    'fallback-editor'
  ]);
  assert.deepEqual(getDeleteConfirmRestoreCandidateKinds({ kind: 'outline-item', pos: 12 }), [
    'outline-item',
    'outline-view',
    'fallback-editor'
  ]);
});

test('createDeleteConfirmDialogResult keeps confirmation state with restore target', () => {
  assert.deepEqual(createDeleteConfirmDialogResult(false, { kind: 'files-view' }), {
    confirmed: false,
    restoreTarget: { kind: 'files-view' }
  });
});
