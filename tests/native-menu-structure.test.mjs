import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rustSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('native app menu no longer includes a top-level view menu', () => {
  assert.doesNotMatch(rustSource, /视图\(&V\)/);
  assert.doesNotMatch(rustSource, /&view_menu/);
});
