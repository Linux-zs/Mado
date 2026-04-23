import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('appearance font panel styles exist for the top toolbar controls', () => {
  assert.match(css, /\.appearance-font-bar\b/);
  assert.match(css, /\.appearance-font-slot-tabs\b/);
  assert.match(css, /\.appearance-font-slot-tab\b/);
  assert.match(css, /\.appearance-font-select\b/);
  assert.match(css, /\.appearance-font-close\b/);
});
