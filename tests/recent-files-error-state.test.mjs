import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECENT_FILES_MENU_SYNC_ERROR_NOTICE,
  RECENT_FILES_STORAGE_ERROR_NOTICE,
  resolveRecentFilesErrorReport,
  resolveRecentFilesErrorReset
} from '../.test-dist/src/recent-files-error-state.js';

test('recent file error notices stay as the intended Chinese strings', () => {
  assert.equal(
    RECENT_FILES_STORAGE_ERROR_NOTICE,
    '\u6700\u8fd1\u6587\u4ef6\u5217\u8868\u65e0\u6cd5\u5199\u5165\u672c\u5730\u5b58\u50a8\u3002'
  );
  assert.equal(
    RECENT_FILES_MENU_SYNC_ERROR_NOTICE,
    '\u6700\u8fd1\u6587\u4ef6\u83dc\u5355\u540c\u6b65\u5931\u8d25\u3002'
  );
});

test('resolveRecentFilesErrorReport emits the storage notice once', () => {
  assert.deepEqual(resolveRecentFilesErrorReport('storage', false), {
    nextShown: true,
    notice: RECENT_FILES_STORAGE_ERROR_NOTICE
  });
  assert.deepEqual(resolveRecentFilesErrorReport('storage', true), {
    nextShown: true,
    notice: null
  });
});

test('resolveRecentFilesErrorReport emits the menu sync notice once', () => {
  assert.deepEqual(resolveRecentFilesErrorReport('menu-sync', false), {
    nextShown: true,
    notice: RECENT_FILES_MENU_SYNC_ERROR_NOTICE
  });
  assert.deepEqual(resolveRecentFilesErrorReport('menu-sync', true), {
    nextShown: true,
    notice: null
  });
});

test('resolveRecentFilesErrorReset clears the shown flag after a success', () => {
  assert.deepEqual(resolveRecentFilesErrorReset(), {
    nextShown: false
  });
});
