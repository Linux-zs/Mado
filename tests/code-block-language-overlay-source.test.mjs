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
