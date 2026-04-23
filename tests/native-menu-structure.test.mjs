import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rustSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('native app menu does not keep an empty help menu placeholder', () => {
  assert.doesNotMatch(rustSource, /help_menu/);
  assert.doesNotMatch(rustSource, /\\u\{5e2e\}\\u\{52a9\}\(&H\)/);
});

test('native app menu no longer includes a top-level view menu', () => {
  assert.doesNotMatch(rustSource, /视图\(&V\)/);
  assert.doesNotMatch(rustSource, /&view_menu/);
});

test('native app menu includes vscode inspired appearance themes', () => {
  for (const theme of [
    'one-dark-pro',
    'dracula',
    'catppuccin-mocha',
    'night-owl',
    'tokyo-night',
    'github-light'
  ]) {
    assert.match(rustSource, new RegExp(`appearance-theme:${theme}`));
    assert.match(rustSource, new RegExp(`theme: "${theme}"\\.to_string\\(\\)`));
  }
});
