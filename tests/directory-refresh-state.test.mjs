import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDirectoryRefreshCommit } from '../.test-dist/src/directory-refresh-state.js';

test('resolveDirectoryRefreshCommit commits cleared directory state', () => {
  assert.deepEqual(
    resolveDirectoryRefreshCommit({
      previousCurrentDirectoryPath: 'C:/docs',
      nextDirectoryPath: null,
      outcome: 'clear'
    }),
    {
      nextCurrentDirectoryPath: null,
      shouldPersistCurrentDirectoryPath: true
    }
  );
});

test('resolveDirectoryRefreshCommit commits successful directory refresh', () => {
  assert.deepEqual(
    resolveDirectoryRefreshCommit({
      previousCurrentDirectoryPath: 'C:/docs',
      nextDirectoryPath: 'D:/notes',
      outcome: 'success'
    }),
    {
      nextCurrentDirectoryPath: 'D:/notes',
      shouldPersistCurrentDirectoryPath: true
    }
  );
});

test('resolveDirectoryRefreshCommit preserves previous directory on failure', () => {
  assert.deepEqual(
    resolveDirectoryRefreshCommit({
      previousCurrentDirectoryPath: 'C:/docs',
      nextDirectoryPath: 'E:/missing',
      outcome: 'failure'
    }),
    {
      nextCurrentDirectoryPath: 'C:/docs',
      shouldPersistCurrentDirectoryPath: false
    }
  );
});
