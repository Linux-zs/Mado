import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('code block language controls use a dedicated overlay root instead of appending into pre', () => {
  assert.match(mainSource, /code-block-language-overlay-root/);
  assert.doesNotMatch(mainSource, /pre\.append\(shell\);/);
  assert.match(css, /\.code-block-language-overlay-root\b/);
});

test('code block language editing refreshes highlighting without relying on stale language keys', () => {
  assert.match(mainSource, /resolveCodeBlockHighlightLanguageName/);
  assert.match(mainSource, /codeBlockDecoration:\s*true/);
  assert.doesNotMatch(mainSource, /spec\.codeBlockKey === block\.key/);
});

test('code block language interactions are isolated from milkdown host refresh clicks', () => {
  assert.match(mainSource, /function isCodeBlockLanguageEventTarget/);
  assert.match(mainSource, /createCodeBlockLanguageShell[\s\S]*shell\.addEventListener\('pointerdown'/);
  assert.match(mainSource, /button\.addEventListener\('pointerdown'[\s\S]*startCodeBlockLanguageEdit/);
  assert.match(mainSource, /host\.addEventListener\('click', \(event\) => \{[\s\S]*isCodeBlockLanguageEventTarget\(event\.target\)/);
  assert.match(css, /\.code-block-language-chip\s*\{[\s\S]*cursor:\s*pointer;/);
});
