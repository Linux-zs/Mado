import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appearanceStateSource = readFileSync(new URL('../src/appearance-state.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const rustSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('appearance settings keep typora theme identifiers', () => {
  assert.match(appearanceStateSource, /typoraThemeId:\s*string \| null/);
  assert.match(appearanceStateSource, /typoraThemeId:\s*null/);
});

test('rust exposes typora theme import commands and appearance menu entries', () => {
  assert.match(rustSource, /ImportTyporaTheme/);
  assert.match(rustSource, /OpenTyporaThemePanel/);
  assert.match(rustSource, /fn list_imported_typora_themes/);
  assert.match(rustSource, /fn import_typora_theme/);
  assert.match(rustSource, /Typora/);
});

test('frontend loads imported typora themes through a stylesheet and binds #write to prose mirror', () => {
  assert.match(mainSource, /convertFileSrc/);
  assert.match(mainSource, /function applyActiveTyporaThemeStylesheet/);
  assert.match(mainSource, /invoke<ImportedTyporaTheme\[]>\('list_imported_typora_themes'\)/);
  assert.match(mainSource, /invoke<ImportedTyporaTheme>\('import_typora_theme'/);
  assert.match(mainSource, /proseMirror\.id = 'write'/);
});

test('style layer exposes typora theme variables and theme panel styles', () => {
  assert.match(css, /--bg-color:/);
  assert.match(css, /--side-bar-bg-color:/);
  assert.match(css, /\.appearance-theme-bar\b/);
  assert.match(css, /\.appearance-theme-select\b/);
});
