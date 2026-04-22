import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldBlockGlobalShortcutTarget } from '../.test-dist/src/shortcut-guards.js';

test('shouldBlockGlobalShortcutTarget blocks all shortcuts while rename dialog is open', () => {
  assert.equal(
    shouldBlockGlobalShortcutTarget({
      renameDialogOpen: true,
      targetKind: 'source'
    }),
    true
  );
});

test('shouldBlockGlobalShortcutTarget allows source and milkdown targets', () => {
  assert.equal(
    shouldBlockGlobalShortcutTarget({
      renameDialogOpen: false,
      targetKind: 'source'
    }),
    false
  );
  assert.equal(
    shouldBlockGlobalShortcutTarget({
      renameDialogOpen: false,
      targetKind: 'milkdown'
    }),
    false
  );
});

test('shouldBlockGlobalShortcutTarget blocks interactive form targets', () => {
  for (const targetKind of ['input', 'textarea', 'select', 'contentEditable']) {
    assert.equal(
      shouldBlockGlobalShortcutTarget({
        renameDialogOpen: false,
        targetKind
      }),
      true
    );
  }
});
